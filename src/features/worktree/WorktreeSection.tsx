import { useCallback, useEffect, useState } from "react";
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
  const [notice, setNotice] = useState<string | null>(null);
  const collapsed = isCollapsed(SECTION_ID);

  // 切换仓库后上一条结果文案不再适用。
  useEffect(() => {
    setNotice(null);
  }, [repo.path]);

  const finish = useCallback(
    async (message: string) => {
      setNotice(message);
      await reload();
    },
    [reload],
  );

  if (repo.is_bare) {
    return null;
  }

  return (
    <section className="ref-section worktree-section">
      <div className="ref-section-head">
        <button
          className="ref-toggle ref-section-toggle"
          aria-expanded={!collapsed}
          onClick={() => onToggleCollapse(SECTION_ID)}
        >
          <span className="ref-caret" aria-hidden="true">
            {collapsed ? "▶" : "▼"}
          </span>
          <Icon name="treeView" className="ref-section-icon" />
          <span className="ref-section-title">{t("worktree.title")}</span>
          <span className="ref-count muted">{worktrees?.length ?? 0}</span>
        </button>
      </div>
      <div className="ref-section-actions">
        <button
          className="link"
          disabled={writeDisabled}
          onClick={() => {
            setNotice(null);
            setCreateOpen(true);
          }}
        >
          {t("worktree.create")}
        </button>
        <button
          className="link"
          disabled={loading}
          title={t("worktree.refreshTitle")}
          aria-label={t("worktree.refreshTitle")}
          onClick={() => void reload()}
        >
          ↻
        </button>
      </div>

      {!collapsed && (
        <>
          {notice && <p className="muted worktree-notice">{notice}</p>}
          {error && <p className="danger-text worktree-error">{error}</p>}
          {!error && worktrees === null && loading && (
            <p className="muted ref-empty">{t("worktree.loading")}</p>
          )}
          {!error && worktrees !== null && worktrees.length === 0 && (
            <p className="muted ref-empty">{t("worktree.empty")}</p>
          )}
          {!error && worktrees !== null && worktrees.length > 0 && (
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
