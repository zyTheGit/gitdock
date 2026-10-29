import type { MouseEvent } from "react";
import type { RepoStateDto, RefDto } from "../shared/types";

interface RepositorySidebarProps {
  width: number;
  repo: RepoStateDto | null;
  headLabel: string;
  localBranches: RefDto[];
  writeDisabled: boolean;
  onCompareBranches: () => void;
  onSwitchBranch: (branch: RefDto) => void;
  onBranchMenu: (event: MouseEvent, branch: RefDto) => void;
}

export function RepositorySidebar({
  width,
  repo,
  headLabel,
  localBranches,
  writeDisabled,
  onCompareBranches,
  onSwitchBranch,
  onBranchMenu,
}: RepositorySidebarProps) {
  return (
    <aside className="sidebar" style={{ width }}>
      {!repo && <p className="muted">尚未打开仓库，可从左上角仓库菜单打开。</p>}
      {repo && (
        <div className="repo-facts">
          <h2>仓库信息</h2>
          <dl>
            <dt>对象格式</dt>
            <dd>{repo.object_format.toUpperCase()}</dd>
            <dt>HEAD</dt>
            <dd>{headLabel}</dd>
            <dt>OID</dt>
            <dd className="mono">{repo.head.oid ?? "—"}</dd>
            <dt>generation</dt>
            <dd className="mono">{repo.generation}</dd>
            <dt>引用</dt>
            <dd>{repo.refs.length} 个</dd>
            {repo.is_bare && <dd className="tag">bare（只读）</dd>}
            {repo.is_linked_worktree && <dd className="tag">linked worktree</dd>}
            {repo.is_shallow && <dd className="tag">shallow</dd>}
          </dl>
        </div>
      )}
      {repo && (
        <div className="branch-list branch-panel">
          <div className="branch-panel-head">
            <h2>本地分支</h2>
            <button
              className="link"
              disabled={localBranches.length < 2}
              onClick={onCompareBranches}
              title="选择两个本地分支进行对比"
            >
              对比分支…
            </button>
          </div>
          {localBranches.length === 0 ? (
            <p className="muted">没有本地分支</p>
          ) : (
            <ul>
              {localBranches.map((branch) => (
                <li key={branch.full_name}>
                  <button
                    className={branch.is_head ? "branch-item active" : "branch-item"}
                    title={
                      branch.description
                        ? `${branch.short_name} — ${branch.description}`
                        : branch.short_name
                    }
                    onClick={() => {
                      if (!branch.is_head && !writeDisabled) {
                        onSwitchBranch(branch);
                      }
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onBranchMenu(event, branch);
                    }}
                  >
                    <span className="branch-text">
                      <span className="branch-name">{branch.short_name}</span>
                      {branch.description && (
                        <span className="branch-desc">{branch.description}</span>
                      )}
                    </span>
                    {branch.is_head && <span className="tag">当前</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
