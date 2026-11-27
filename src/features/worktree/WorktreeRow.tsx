import { Icon } from "../../assets/icons";
import { useI18n } from "../../i18n";
import { shortOid } from "../../shared/format";
import type { WorktreeDto } from "../../shared/types";

interface WorktreeRowProps {
  entry: WorktreeDto;
  writeDisabled: boolean;
  /** 单条分区复用同一行能力，仅收紧布局并保留禁用态移除入口。 */
  compact?: boolean;
  /** 在标签页中打开该 worktree 路径（复用既有标签机制）。 */
  onOpen: (path: string) => void;
  onRemove: (entry: WorktreeDto) => void;
}

/** 一行 worktree：分支 / 短 OID、路径、状态徽标；完整列表不提供主 worktree 移除。 */
export function WorktreeRow({
  entry,
  writeDisabled,
  compact = false,
  onOpen,
  onRemove,
}: WorktreeRowProps) {
  const { t } = useI18n();
  const label =
    entry.branch ?? (entry.head_oid ? shortOid(entry.head_oid) : t("worktree.detached"));
  const openTitle = t("worktree.openTitle", { path: entry.path });

  return (
    <li className={compact ? "worktree-item worktree-item-compact" : "worktree-item"}>
      <div className={compact ? "worktree-row worktree-row-compact" : "worktree-row"}>
        <button
          type="button"
          className={compact ? "worktree-open worktree-open-compact" : "worktree-open"}
          title={openTitle}
          aria-label={openTitle}
          onClick={() => onOpen(entry.path)}
        >
          <span className="worktree-label">
            <span className="worktree-name">{label}</span>
            {entry.is_main && (
              <span className="tag worktree-badge">{t("worktree.mainBadge")}</span>
            )}
            {compact && !entry.is_main && (
              <span className="tag worktree-badge">{t("worktree.linkedBadge")}</span>
            )}
            {entry.locked && (
              <span
                className="tag worktree-badge worktree-badge-locked"
                title={
                  entry.lock_reason
                    ? t("worktree.lockedTitle", { reason: entry.lock_reason })
                    : t("worktree.lockedNoReason")
                }
              >
                {t("worktree.lockedBadge")}
              </span>
            )}
            {entry.prunable && (
              <span
                className="tag worktree-badge worktree-badge-prunable"
                title={t("worktree.prunableTitle")}
              >
                {t("worktree.prunableBadge")}
              </span>
            )}
            {entry.detached && (
              <span className="tag worktree-badge" title={t("worktree.detachedTitle")}>
                {t("worktree.detachedBadge")}
              </span>
            )}
          </span>
          <span className="worktree-path mono" title={entry.path}>
            {entry.path}
          </span>
        </button>
        {(!entry.is_main || compact) && (
          <button
            type="button"
            className="worktree-remove"
            disabled={writeDisabled || entry.is_main}
            title={entry.is_main ? t("worktree.mainRemoveTitle") : t("worktree.remove")}
            aria-label={
              entry.is_main
                ? t("worktree.mainRemoveTitle")
                : `${t("worktree.remove")}: ${label}`
            }
            onClick={() => onRemove(entry)}
          >
            <Icon name="trash" className="worktree-remove-icon" />
          </button>
        )}
      </div>
    </li>
  );
}
