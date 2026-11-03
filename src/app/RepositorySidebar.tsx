import type { MouseEvent } from "react";
import { useI18n } from "../i18n";
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
  const { t } = useI18n();
  return (
    <aside className="sidebar" style={{ width }}>
      {!repo && <p className="muted">{t("shell.sidebarNoRepo")}</p>}
      {repo && (
        <div className="repo-facts">
          <h2>{t("shell.repoInfo")}</h2>
          <dl>
            <dt>{t("shell.objectFormat")}</dt>
            <dd>{repo.object_format.toUpperCase()}</dd>
            <dt>HEAD</dt>
            <dd>{headLabel}</dd>
            <dt>OID</dt>
            <dd className="mono">{repo.head.oid ?? "—"}</dd>
            <dt>generation</dt>
            <dd className="mono">{repo.generation}</dd>
            <dt>{t("shell.refsLabel")}</dt>
            <dd>{t("shell.refCount", { n: repo.refs.length })}</dd>
            {repo.is_bare && <dd className="tag">{t("shell.bareRepoTag")}</dd>}
            {repo.is_linked_worktree && <dd className="tag">linked worktree</dd>}
            {repo.is_shallow && <dd className="tag">shallow</dd>}
          </dl>
        </div>
      )}
      {repo && (
        <div className="branch-list branch-panel">
          <div className="branch-panel-head">
            <h2>{t("shell.localBranches")}</h2>
            <button
              className="link"
              disabled={localBranches.length < 2}
              onClick={onCompareBranches}
              title={t("shell.compareBranchesTitle")}
            >
              {t("shell.compareBranches")}
            </button>
          </div>
          {localBranches.length === 0 ? (
            <p className="muted">{t("shell.noLocalBranches")}</p>
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
                    {branch.is_head && <span className="tag">{t("shell.currentTag")}</span>}
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
