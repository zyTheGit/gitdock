//! Worktree 列表与提交模板契约（ADR-0034）。
//!
//! 两者都是只读展示数据：Worktree 条目不是可写句柄，写操作只经白名单
//! `create_worktree` / `remove_worktree`；提交模板只用于预填提交消息。

use serde::{Deserialize, Serialize};

use crate::oid::Oid;

/// `git worktree list --porcelain` 的一条记录；顺序与命令输出一致，首条为主 worktree。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeDto {
    /// 绝对路径。
    pub path: String,
    /// worktree 的 HEAD 提交；尚无提交或字段缺失时为 None。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head_oid: Option<Oid>,
    /// `refs/heads/` 去掉前缀的本地分支名；detached 时为 None。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    pub detached: bool,
    pub bare: bool,
    /// porcelain 的第一条即主 worktree。
    pub is_main: bool,
    pub locked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lock_reason: Option<String>,
    pub prunable: bool,
}

/// 仓库配置的 `commit.template` 内容；仅供前端在消息为空时预填。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitTemplateDto {
    /// 解析后的绝对路径。
    pub path: String,
    /// 文件内容（非法 UTF-8 已按 lossy 转换）；不写日志、不入命令日志。
    pub content: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worktree_dto_skips_absent_optional_fields() {
        let entry = WorktreeDto {
            path: "C:/repo/.worktrees/feat".to_owned(),
            head_oid: None,
            branch: Some("feat".to_owned()),
            detached: false,
            bare: false,
            is_main: false,
            locked: false,
            lock_reason: None,
            prunable: false,
        };
        let json = serde_json::to_string(&entry).expect("序列化");
        assert!(
            json.contains(r#""path":"C:/repo/.worktrees/feat""#),
            "{json}"
        );
        assert!(json.contains(r#""branch":"feat""#), "{json}");
        assert!(!json.contains("head_oid"), "{json}");
        assert!(!json.contains("lock_reason"), "{json}");

        let decoded: WorktreeDto = serde_json::from_str(&json).expect("反序列化");
        assert!(!decoded.is_main);
        assert!(decoded.head_oid.is_none());
    }
}
