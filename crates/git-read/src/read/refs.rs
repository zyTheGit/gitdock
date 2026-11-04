use std::collections::HashMap;

use git_core::{CommitSummaryDto, HeadDto, HeadKind, Oid, RefBadgeDto, RefDto, RefKind, Result};

use super::gix_error;
use crate::util::{find_commit, lossy, oid_from_gix, oid_from_id, raw_time_seconds};

pub(crate) fn read_head(repo: &gix::Repository) -> Result<HeadDto> {
    let head = repo.head().map_err(gix_error)?;
    let branch = head
        .referent_name()
        .map(|name| strip_local_branch_prefix(&lossy(name.as_bstr())));
    let oid = repo.head_id().ok().map(|id| oid_from_id(&id));
    let kind = if head.is_unborn() {
        HeadKind::Unborn
    } else if head.is_detached() {
        HeadKind::Detached
    } else {
        HeadKind::Branch
    };
    Ok(HeadDto { kind, branch, oid })
}

pub(crate) type RefBadges = HashMap<Oid, Vec<RefBadgeDto>>;

pub(crate) fn read_refs(
    repo: &gix::Repository,
    head: &HeadDto,
) -> Result<(Vec<RefDto>, RefBadges)> {
    let head_ref = head
        .branch
        .as_ref()
        .map(|branch| format!("refs/heads/{branch}"));
    let descriptions = local_branch_descriptions(repo);
    let mut refs = Vec::new();
    for reference in repo
        .references()
        .map_err(gix_error)?
        .all()
        .map_err(gix_error)?
    {
        let mut reference = reference.map_err(gix_error)?;
        let full_name = lossy(reference.name().as_bstr());
        let (kind, short_name) = classify_ref(&full_name);
        let Some(kind) = kind else { continue };
        let target_oid = match reference.target() {
            gix::refs::TargetRef::Object(id) => oid_from_gix(id),
            gix::refs::TargetRef::Symbolic(_) => continue,
        };
        let commit_oid = reference.peel_to_id().ok().map(|id| oid_from_id(&id));
        let description = if kind == RefKind::LocalBranch {
            descriptions.get(&short_name).cloned()
        } else {
            None
        };
        let created_at = if kind == RefKind::Tag {
            tag_created_at(repo, &target_oid)
        } else {
            None
        };
        refs.push(RefDto {
            is_head: head_ref.as_deref() == Some(full_name.as_str()),
            full_name,
            short_name,
            kind,
            target_oid,
            commit_oid,
            created_at,
            description,
        });
    }
    refs.sort_by(|a, b| {
        ref_rank(a.kind)
            .cmp(&ref_rank(b.kind))
            .then_with(|| a.short_name.cmp(&b.short_name))
    });
    let mut badges: RefBadges = HashMap::new();
    for reference in &refs {
        if let Some(commit) = &reference.commit_oid {
            badges.entry(commit.clone()).or_default().push(RefBadgeDto {
                name: reference.short_name.clone(),
                kind: reference.kind,
                is_head: reference.is_head,
                description: reference.description.clone(),
            });
        }
    }
    Ok((refs, badges))
}

/// tag 的创建时间；lightweight tag 没有真实创建时间，按 `git for-each-ref`
/// 的 creatordate 语义回退到指向提交的 committer 时间。
fn tag_created_at(repo: &gix::Repository, target: &Oid) -> Option<i64> {
    let id = crate::util::gix_oid(target).ok()?;
    let object = repo.find_object(id).ok()?;
    match object.kind {
        gix::object::Kind::Tag => object
            .into_tag()
            .tagger()
            .ok()
            .flatten()
            .map(|signature| raw_time_seconds(signature.time)),
        gix::object::Kind::Commit => object
            .try_into_commit()
            .ok()?
            .time()
            .ok()
            .map(|time| time.seconds),
        _ => None,
    }
}

/// 读取 local config 中的 branch.<name>.description；空值按“未设置”处理。
fn local_branch_descriptions(repo: &gix::Repository) -> HashMap<String, String> {
    let snapshot = repo.config_snapshot();
    let Some(sections) = snapshot.plumbing().sections_by_name("branch") else {
        return HashMap::new();
    };
    sections
        .filter_map(|section| {
            let name = section.header().subsection_name()?;
            let value = section.value("description")?;
            let text = lossy(value.as_ref());
            if text.trim().is_empty() {
                return None;
            }
            Some((lossy(AsRef::<[u8]>::as_ref(name)), text))
        })
        .collect()
}

fn classify_ref(full_name: &str) -> (Option<RefKind>, String) {
    if let Some(name) = full_name.strip_prefix("refs/heads/") {
        (Some(RefKind::LocalBranch), name.to_owned())
    } else if let Some(name) = full_name.strip_prefix("refs/remotes/") {
        (Some(RefKind::RemoteBranch), name.to_owned())
    } else if let Some(name) = full_name.strip_prefix("refs/tags/") {
        (Some(RefKind::Tag), name.to_owned())
    } else if full_name == "HEAD" {
        (Some(RefKind::Head), "HEAD".to_owned())
    } else {
        (None, full_name.to_owned())
    }
}

fn ref_rank(kind: RefKind) -> u8 {
    match kind {
        RefKind::Head => 0,
        RefKind::LocalBranch => 1,
        RefKind::RemoteBranch => 2,
        RefKind::Tag => 3,
        RefKind::Other => 4,
    }
}

fn strip_local_branch_prefix(full_name: &str) -> String {
    full_name
        .strip_prefix("refs/heads/")
        .unwrap_or(full_name)
        .to_owned()
}

pub(crate) fn commit_summary(
    repo: &gix::Repository,
    oid: &Oid,
    badges: &RefBadges,
) -> Result<CommitSummaryDto> {
    let commit = find_commit(repo, oid)?;
    let author = commit.author().map_err(gix_error)?;
    let parents: Vec<Oid> = commit.parent_ids().map(|id| oid_from_id(&id)).collect();
    let message = lossy(commit.message_raw().map_err(gix_error)?.as_ref());
    let summary = message
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .chars()
        .take(200)
        .collect::<String>();
    Ok(CommitSummaryDto {
        oid: oid.clone(),
        short_oid: oid.short(7).to_owned(),
        parents,
        summary,
        author_name: lossy(author.name),
        author_email: lossy(author.email),
        authored_at: raw_time_seconds(author.time),
        committed_at: commit.time().map(|t| t.seconds).unwrap_or(0),
        refs: badges.get(oid).cloned().unwrap_or_default(),
    })
}
