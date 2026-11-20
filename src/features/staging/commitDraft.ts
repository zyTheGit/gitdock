/**
 * 提交消息草稿：按仓库路径存 sessionStorage，同一仓库会话内切到图谱再回来不丢失；
 * 提交成功与切换仓库时清空（由 CommitComposer 负责调用）。
 */
const DRAFT_PREFIX = "gitdock.commit-draft:";

function draftKey(repoPath: string): string {
  return `${DRAFT_PREFIX}${repoPath}`;
}

export function readCommitDraft(repoPath: string): string {
  try {
    return sessionStorage.getItem(draftKey(repoPath)) ?? "";
  } catch {
    return "";
  }
}

export function storeCommitDraft(repoPath: string, text: string): void {
  try {
    if (text === "") {
      sessionStorage.removeItem(draftKey(repoPath));
    } else {
      sessionStorage.setItem(draftKey(repoPath), text);
    }
  } catch {
    // 存储不可用（隐私模式等）时草稿只保留在内存里。
  }
}
