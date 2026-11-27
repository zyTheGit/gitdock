import { useMemo, useState, type MouseEvent, type RefObject } from "react";
import { useI18n } from "../i18n";
import type { RepoStateDto, RefDto } from "../shared/types";
import { RefTreeSection } from "../features/repository/RefTreeSection";
import { filterRefs } from "../features/repository/refTree";
import { latestTagsFirst } from "../features/repository/tagOrder";
import { useRefTreeCollapse } from "../features/repository/useRefTreeCollapse";
import { WorktreeSection } from "../features/worktree/WorktreeSection";

export interface RepositorySidebarProps {
  id?: string;
  className?: string;
  width: number | string;
  repo: RepoStateDto | null;
  headLabel: string;
  /** 全部可导航引用：本地分支、远程分支与标签，由侧栏按 kind 分组。 */
  refs: RefDto[];
  writeDisabled: boolean;
  onCompareBranches: () => void;
  onSwitchBranch: (branch: RefDto) => void;
  /** 单击引用：在图谱中定位并选中其提交（不切换分支）。 */
  onNavigateRef: (ref: RefDto) => void;
  /** 浮层中完成引用导航后关闭；普通侧栏不传，保持原行为。 */
  onNavigated?: () => void;
  filterInputRef?: RefObject<HTMLInputElement>;
  onCopyOid: (oid: string) => void;
  onBranchMenu: (event: MouseEvent, ref: RefDto) => void;
  onCreateBranch: () => void;
  onTagMenu: (event: MouseEvent, tag: RefDto) => void;
  /** 在标签页中打开 worktree 路径（复用多仓库标签机制，ADR-0034）。 */
  onOpenWorktree: (path: string) => void;
}

function filterKind(refs: RefDto[], kind: RefDto["kind"]): RefDto[] {
  return refs.filter((ref) => ref.kind === kind);
}

export function RepositorySidebar({
  id = "repository-sidebar",
  className,
  width,
  repo,
  headLabel,
  refs,
  writeDisabled,
  onCompareBranches,
  onSwitchBranch,
  onNavigateRef,
  onNavigated,
  filterInputRef,
  onCopyOid,
  onBranchMenu,
  onCreateBranch,
  onTagMenu,
  onOpenWorktree,
}: RepositorySidebarProps) {
  const { t } = useI18n();
  const [keyword, setKeyword] = useState("");
  const collapse = useRefTreeCollapse();

  const filtered = useMemo(
    () => ({
      local: filterRefs(filterKind(refs, "local_branch"), keyword),
      remote: filterRefs(filterKind(refs, "remote_branch"), keyword),
      tags: filterRefs(latestTagsFirst(filterKind(refs, "tag")), keyword),
    }),
    [refs, keyword],
  );

  const filtering = keyword.trim().length > 0;
  const emptyText = filtering ? t("shell.noMatchingRefs") : "";
  const headOid = repo?.head.oid ?? null;
  const selectableCount = refs.length;
  const navigateRef = (ref: RefDto) => {
    onNavigateRef(ref);
    onNavigated?.();
  };

  // 本地分支相对上游的紧凑计数（ADR-0028）：0 与 undefined 都不显示，避免噪音。
  const upstreamMeta = (ref: RefDto) => {
    const ahead = ref.ahead ?? 0;
    const behind = ref.behind ?? 0;
    if (ahead === 0 && behind === 0) {
      return null;
    }
    const text = [ahead > 0 ? `↑${ahead}` : "", behind > 0 ? `↓${behind}` : ""]
      .filter(Boolean)
      .join(" ");
    const titles: string[] = [];
    if (ahead > 0) {
      titles.push(
        ref.upstream
          ? t("repository.syncAheadWithUpstream", { n: ahead, upstream: ref.upstream })
          : t("repository.syncAhead", { n: ahead }),
      );
    }
    if (behind > 0) {
      titles.push(
        ref.upstream
          ? t("repository.syncBehindWithUpstream", { n: behind, upstream: ref.upstream })
          : t("repository.syncBehind", { n: behind }),
      );
    }
    return { text, title: titles.join(t("shell.fileListSeparator")) };
  };

  return (
    <aside id={id} className={`sidebar${className ? ` ${className}` : ""}`} style={{ width }}>
      {!repo && <p className="muted">{t("shell.sidebarNoRepo")}</p>}
      {repo && (
        <>
          <div className="repo-summary">
            <div className="repo-summary-row">
              <span className="head-badge" title={headLabel}>{headLabel}</span>
              {repo.is_bare && <span className="tag">{t("shell.bareRepoTag")}</span>}
              {repo.is_linked_worktree && <span className="tag">{t("shell.linkedWorktreeTag")}</span>}
              {repo.is_shallow && <span className="tag">{t("shell.shallowRepoTag")}</span>}
            </div>
            <button
              className="repo-oid mono"
              disabled={!headOid}
              title={headOid ? `${t("shell.copyOidTitle")} ${headOid}` : t("shell.noHeadOid")}
              onClick={() => headOid && onCopyOid(headOid)}
            >
              {headOid ? headOid.slice(0, 8) : "—"}
            </button>
            <details className="repo-details">
              <summary>{t("shell.repoDetails")}</summary>
              <dl>
                <dt>{t("shell.objectFormat")}</dt>
                <dd>{repo.object_format.toUpperCase()}</dd>
                <dt>{t("shell.refsLabel")}</dt>
                <dd>{t("shell.refCount", { n: repo.refs.length })}</dd>
              </dl>
            </details>
          </div>

          <div className="ref-filter">
            <input
              ref={filterInputRef}
              value={keyword}
              placeholder={t("shell.refFilterPlaceholder")}
              aria-label={t("shell.refFilterAria")}
              onChange={(event) => setKeyword(event.target.value)}
            />
            {keyword && (
              <button
                className="link ref-filter-clear"
                aria-label={t("shell.refFilterClear")}
                title={t("shell.refFilterClear")}
                onClick={() => setKeyword("")}
              >
                ×
              </button>
            )}
          </div>

          <RefTreeSection
            sectionKey="local"
            title={t("shell.localBranches")}
            icon="branch"
            refs={filtered.local}
            emptyText={emptyText || t("shell.noLocalBranches")}
            actions={
              <>
                <button className="link" disabled={writeDisabled} onClick={onCreateBranch}>
                  {t("repository.createBranch")}
                </button>
                <button
                  className="link"
                  disabled={selectableCount < 2}
                  onClick={onCompareBranches}
                  title={t("shell.compareBranchesTitle")}
                >
                  {t("shell.compareBranches")}
                </button>
              </>
            }
            isCollapsed={collapse.isCollapsed}
            onToggleCollapse={collapse.toggle}
            onActivate={navigateRef}
            onActivateDouble={
              writeDisabled
                ? undefined
                : (ref) => {
                    // 双击只对非当前分支发起 switch_branch；当前分支上双击仍是定位。
                    if (!ref.is_head) {
                      onSwitchBranch(ref);
                      onNavigated?.();
                    }
                  }
            }
            onMenu={onBranchMenu}
            badge={(ref) => (ref.is_head ? t("shell.currentTag") : null)}
            meta={upstreamMeta}
          />

          <RefTreeSection
            sectionKey="remote"
            title={t("shell.remoteBranches")}
            icon="remote"
            refs={filtered.remote}
            emptyText={emptyText || t("shell.noRemoteBranches")}
            isCollapsed={collapse.isCollapsed}
            onToggleCollapse={collapse.toggle}
            onActivate={navigateRef}
            onMenu={onBranchMenu}
          />

          <RefTreeSection
            sectionKey="tags"
            title={t("repository.tags")}
            icon="tag"
            refs={filtered.tags}
            emptyText={emptyText || t("repository.noTags")}
            isCollapsed={collapse.isCollapsed}
            onToggleCollapse={collapse.toggle}
            onActivate={navigateRef}
            onMenu={onTagMenu}
          />

          {/* Worktree 分区（ADR-0034）：只读列表，点击行在标签页中打开该路径。 */}
          <WorktreeSection
            repo={repo}
            writeDisabled={writeDisabled}
            isCollapsed={collapse.isCollapsed}
            onToggleCollapse={collapse.toggle}
            onOpen={onOpenWorktree}
          />
        </>
      )}
    </aside>
  );
}
