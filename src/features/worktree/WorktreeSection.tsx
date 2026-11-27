import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../assets/icons";
import { useI18n } from "../../i18n";
import type { RepoStateDto, WorktreeDto } from "../../shared/types";
import { useWorktrees } from "./useWorktrees";
import { WorktreeCreateDialog } from "./WorktreeCreateDialog";
import { WorktreeRemoveDialog } from "./WorktreeRemoveDialog";
import { WorktreeRow } from "./WorktreeRow";

interface WorktreeSectionProps {
  repo: RepoStateDto;
  writeDisabled: boolean;
  /** 与引用分组共用折叠状态：`section:worktree`。 */
  isCollapsed: (id: string) => boolean;
  onToggleCollapse: (id: string) => void;
  /** 在标签页中打开 worktree 路径（由 App 经 session.open 落地）。 */
  onOpen: (path: string) => void;
}

const SECTION_ID = "section:worktree";

interface WorktreeToggleProps {
  collapsed: boolean;
  count: number;
  compact?: boolean;
  onToggle: () => void;
}

function WorktreeToggle({ collapsed, count, compact = false, onToggle }: WorktreeToggleProps) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className={compact ? "ref-toggle worktree-compact-toggle" : "ref-toggle ref-section-toggle"}
      aria-expanded={!collapsed}
      aria-label={compact ? t("worktree.title") : undefined}
      title={compact ? t("worktree.title") : undefined}
      onClick={onToggle}
    >
      <span className="ref-caret" aria-hidden="true">
        {collapsed ? "▶" : "▼"}
      </span>
      {!compact && (
        <>
          <Icon name="treeView" className="ref-section-icon" />
          <span className="ref-section-title">{t("worktree.title")}</span>
          <span className="ref-count muted">{count}</span>
        </>
      )}
    </button>
  );
}

interface WorktreeActionsProps {
  writeDisabled: boolean;
  loading: boolean;
  compact?: boolean;
  onCreate: () => void;
  onReload: () => void;
}

function WorktreeActions({
  writeDisabled,
  loading,
  compact = false,
  onCreate,
  onReload,
}: WorktreeActionsProps) {
  const { t } = useI18n();
  return (
    <div className={compact ? "worktree-compact-actions" : "ref-section-actions"}>
      <button type="button" className="link" disabled={writeDisabled} onClick={onCreate}>
        {t("worktree.create")}
      </button>
      <button
        type="button"
        className={compact ? "link worktree-refresh" : "link"}
        disabled={loading}
        title={t("worktree.refreshTitle")}
        aria-label={t("worktree.refreshTitle")}
        onClick={onReload}
      >
        ↻
      </button>
    </div>
  );
}

/**
 * 侧栏 Worktree 分区（ADR-0034）：只读列表 + 创建 / 移除入口。
 * 列表随仓库 generation 重读，写操作成功后显式 reload；不轮询。
 */
export function WorktreeSection({
  repo,
  writeDisabled,
  isCollapsed,
  onToggleCollapse,
  onOpen,
}: WorktreeSectionProps) {
  const { t } = useI18n();
  // bare 仓库没有 linked worktree 的概念：不发起读取，整段隐藏。
  const { worktrees, loading, error, reload } = useWorktrees(
    repo.is_bare ? null : repo.path,
    repo.generation,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [removing, setRemoving] = useState<WorktreeDto | null>(null);
  const [notice, setNotice] = useState<{ repoPath: string; message: string } | null>(null);
  const repoPathRef = useRef(repo.path);
  repoPathRef.current = repo.path;
  const collapsed = isCollapsed(SECTION_ID);

  // 切换仓库后上一条结果文案不再适用。
  useEffect(() => {
    setNotice(null);
  }, [repo.path]);

  const finish = useCallback(
    async (message: string) => {
      if (repoPathRef.current !== repo.path) {
        return;
      }
      setNotice({ repoPath: repo.path, message });
      await reload();
    },
    [reload, repo.path],
  );
  const visibleNotice = notice?.repoPath === repo.path ? notice.message : null;

  if (repo.is_bare) {
    return null;
  }

  const compact = !collapsed && !error && worktrees !== null && worktrees.length === 1;
  const toggle = () => onToggleCollapse(SECTION_ID);
  const openCreate = () => {
    setNotice(null);
    setCreateOpen(true);
  };

  return (
    <section
      className={
        compact
          ? "ref-section worktree-section worktree-section-compact"
          : "ref-section worktree-section"
      }
    >
      {compact ? (
        <>
          <div className="worktree-compact-row">
            <WorktreeToggle collapsed={false} count={1} compact onToggle={toggle} />
            <ul className="worktree-list worktree-list-compact">
              <WorktreeRow
                entry={worktrees[0]}
                compact
                writeDisabled={writeDisabled}
                onOpen={onOpen}
                onRemove={setRemoving}
              />
            </ul>
            <WorktreeActions
              writeDisabled={writeDisabled}
              loading={loading}
              compact
              onCreate={openCreate}
              onReload={() => void reload()}
            />
          </div>
          {visibleNotice && (
            <p className="muted worktree-notice worktree-compact-notice">{visibleNotice}</p>
          )}
        </>
      ) : (
        <>
          <div className="ref-section-head">
            <WorktreeToggle
              collapsed={collapsed}
              count={worktrees?.length ?? 0}
              onToggle={toggle}
            />
          </div>
          <WorktreeActions
            writeDisabled={writeDisabled}
            loading={loading}
            onCreate={openCreate}
            onReload={() => void reload()}
          />

          {!collapsed && (
            <>
              {visibleNotice && <p className="muted worktree-notice">{visibleNotice}</p>}
              {error && <p className="danger-text worktree-error">{error}</p>}
              {!error && worktrees === null && loading && (
                <p className="muted ref-empty">{t("worktree.loading")}</p>
              )}
              {!error && worktrees !== null && worktrees.length === 0 && (
                <p className="muted ref-empty">{t("worktree.empty")}</p>
              )}
              {!error && worktrees !== null && worktrees.length > 1 && (
                <ul className="worktree-list">
                  {worktrees.map((entry) => (
                    <WorktreeRow
                      key={entry.path}
                      entry={entry}
                      writeDisabled={writeDisabled}
                      onOpen={onOpen}
                      onRemove={setRemoving}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}

      {createOpen && (
        <WorktreeCreateDialog
          repo={repo}
          onClose={() => setCreateOpen(false)}
          onCreated={finish}
        />
      )}
      {removing && (
        <WorktreeRemoveDialog
          entry={removing}
          onClose={() => setRemoving(null)}
          onRemoved={finish}
        />
      )}
    </section>
  );
}
