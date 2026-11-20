// Worktree 列表与提交模板 DTO 镜像（ADR-0034）；从 types.ts re-export，调用方仍从那里导入。

/**
 * `git worktree list --porcelain` 的一条记录；顺序与命令输出一致，首条为主 worktree。
 * 只读展示数据：不是可写句柄，写操作只经 create_worktree / remove_worktree。
 */
export interface WorktreeDto {
  /** 绝对路径。 */
  path: string;
  /** worktree 的 HEAD 提交；尚无提交时缺失。 */
  head_oid?: string;
  /** 本地分支名（去掉 `refs/heads/`）；detached 时缺失。 */
  branch?: string;
  detached: boolean;
  bare: boolean;
  /** porcelain 的第一条即主 worktree。 */
  is_main: boolean;
  locked: boolean;
  lock_reason?: string;
  prunable: boolean;
}

/** 仓库配置的 `commit.template` 内容；仅供前端在提交消息为空时预填。 */
export interface CommitTemplateDto {
  /** 解析后的绝对路径。 */
  path: string;
  /** 文件内容（非法 UTF-8 已按 lossy 转换）。 */
  content: string;
}
