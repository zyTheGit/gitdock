//! 搜索：在指定图谱视图内按信息、作者、OID 与路径匹配，并支持取消。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use git_core::{
    decode_cursor, encode_cursor, ErrorCode, Oid, Result, SearchField, SearchMatchDto,
    SearchPageDto, SearchRequest, UserVisibleError,
};

use crate::diff::collect_changes;
use crate::read::{commit_summary, read_head, read_refs, GitReadModule, DEFAULT_PAGE_LIMIT};

const MAX_SCAN: usize = 20_000;
/// 路径搜索需要逐提交 diff，单独限制扫描量，避免拖垮交互。
const MAX_PATH_SCAN: usize = 2_000;

impl GitReadModule {
    pub fn search(&self, request: &SearchRequest, cursor: Option<&str>) -> Result<SearchPageDto> {
        let text = request.text.trim().to_lowercase();
        if text.is_empty() {
            return Ok(SearchPageDto {
                generation: self.current_generation()?,
                search_id: request.search_id.clone(),
                results: Vec::new(),
                next_cursor: None,
                has_more: false,
                canceled: false,
            });
        }
        let cancel = Arc::new(AtomicBool::new(false));
        self.searches
            .lock()
            .insert(request.search_id.clone(), cancel.clone());

        let outcome = self.search_inner(request, cursor, &text, &cancel);

        self.searches.lock().remove(&request.search_id);
        outcome
    }

    pub fn cancel_search(&self, search_id: &str) {
        if let Some(flag) = self.searches.lock().get(search_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }

    fn search_inner(
        &self,
        request: &SearchRequest,
        cursor: Option<&str>,
        text: &str,
        cancel: &AtomicBool,
    ) -> Result<SearchPageDto> {
        let repo = self.repo()?;
        let generation = self.fingerprint(&repo)?;
        let view_key = format!("search|{}", request.scope.view_key());
        let index = self.build_index(&repo, &request.scope, &view_key, generation)?;
        let start = match cursor {
            Some(token) => {
                let data = decode_cursor(token)?;
                if data.generation != generation {
                    return Err(UserVisibleError::new(
                        ErrorCode::CursorStale,
                        "仓库状态已变化，请重新搜索",
                    ));
                }
                let after = Oid::new(data.after).map_err(|e| {
                    UserVisibleError::new(ErrorCode::CursorInvalid, "搜索游标无效")
                        .with_detail(e.to_string())
                })?;
                index.position(&after).map(|p| p + 1).unwrap_or(index.order.len())
            }
            None => 0,
        };
        let badges = read_refs(&repo, &read_head(&repo)?)?.1;
        let mut results = Vec::new();
        let mut canceled = false;
        let mut scanned = 0usize;
        let mut next_cursor = None;
        let end_of_scan = (start + MAX_SCAN).min(index.order.len());
        for oid in &index.order[start..end_of_scan] {
            if cancel.load(Ordering::SeqCst) {
                canceled = true;
                break;
            }
            scanned += 1;
            if results.len() >= DEFAULT_PAGE_LIMIT {
                break;
            }
            let commit = crate::util::find_commit(&repo, oid)?;
            let message = crate::util::lossy(
                commit
                    .message_raw()
                    .map_err(|e| {
                        UserVisibleError::new(ErrorCode::Internal, "读取提交信息失败")
                            .with_detail(e.to_string())
                    })?
                    .as_ref(),
            );
            let author = commit.author().map_err(|e| {
                UserVisibleError::new(ErrorCode::Internal, "读取提交作者失败")
                    .with_detail(e.to_string())
            })?;
            let mut fields = Vec::new();
            if message.to_lowercase().contains(text) {
                fields.push(SearchField::Message);
            }
            if oid.as_str().starts_with(text) {
                fields.push(SearchField::Hash);
            }
            let author_name = crate::util::lossy(author.name).to_lowercase();
            let author_email = crate::util::lossy(author.email).to_lowercase();
            if author_name.contains(text) || author_email.contains(text) {
                fields.push(SearchField::Author);
            }
            let mut matched_path = None;
            if scanned <= MAX_PATH_SCAN {
                if let Some(path) = self.match_path(&repo, oid, text)? {
                    fields.push(SearchField::Path);
                    matched_path = Some(path);
                }
            }
            if fields.is_empty() {
                continue;
            }
            results.push(SearchMatchDto {
                commit: commit_summary(&repo, oid, &badges)?,
                fields,
                matched_path,
            });
        }
        let last_scanned = start + scanned;
        let has_more = !canceled && last_scanned < index.order.len();
        if has_more {
            if let Some(last) = index.order.get(last_scanned.saturating_sub(1)) {
                next_cursor = Some(encode_cursor(&view_key, generation, last));
            }
        }
        Ok(SearchPageDto {
            generation,
            search_id: request.search_id.clone(),
            results,
            next_cursor,
            has_more,
            canceled,
        })
    }

    fn match_path(&self, repo: &gix::Repository, oid: &Oid, text: &str) -> Result<Option<String>> {
        let commit = crate::util::find_commit(repo, oid)?;
        let parent = commit
            .parent_ids()
            .next()
            .map(|id| crate::util::oid_from_id(&id));
        let old_tree = match &parent {
            Some(parent) => Some(crate::read::tree_oid_of_commit(repo, parent)?),
            None => None,
        };
        let new_tree = {
            let id = commit.tree_id().map_err(|e| {
                UserVisibleError::new(ErrorCode::Internal, "读取提交树失败")
                    .with_detail(e.to_string())
            })?;
            Some(crate::util::oid_from_id(&id))
        };
        let changes = collect_changes(repo, old_tree.as_ref(), new_tree.as_ref(), None)?;
        Ok(changes
            .files
            .iter()
            .map(|change| change.path().to_owned())
            .find(|path| path.to_lowercase().contains(text)))
    }
}
