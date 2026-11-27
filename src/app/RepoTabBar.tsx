import { useEffect, useRef, type MouseEvent } from "react";
import { useI18n } from "../i18n";
import type { RepoId, RepoTabDto } from "../shared/types";

interface RepoTabBarProps {
  tabs: RepoTabDto[];
  activeId: RepoId | null;
  dirtyIds: readonly RepoId[];
  /** 标签操作进行中：关闭/打开按钮置灰，避免重复入队。 */
  busy: boolean;
  /** 新增仓库的导入进行中：标签条末尾显示占位提示，避免用户以为点击没生效。 */
  opening: boolean;
  onActivate: (repoId: RepoId) => void;
  onClose: (repoId: RepoId) => void;
}

/**
 * 多仓库标签条（ADR-0032）：仓库名 + 活动态 + 非活动标签脏点 + 关闭按钮。
 * 不监听任何按键：Esc 分层仍由 window 层统一处理，标签条不吞按键。
 */
export function RepoTabBar({
  tabs,
  activeId,
  dirtyIds,
  busy,
  opening,
  onActivate,
  onClose,
}: RepoTabBarProps) {
  const { t } = useI18n();
  const listRef = useRef<HTMLDivElement | null>(null);

  // 标签溢出时把竖向滚轮转成横向滚动：React 的 onWheel 是 passive 监听，
  // 无法 preventDefault，只能用原生监听；触控板横向滑动与 Shift+滚轮保持默认行为。
  useEffect(() => {
    const el = listRef.current;
    if (!el) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) {
        return;
      }
      if (event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) {
        return;
      }
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientWidth : 1;
      el.scrollLeft += event.deltaY * unit;
      event.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // 中键关闭：只在标签本体上生效，避免误触选中的标签被拖动式操作。
  const onAuxClick = (event: MouseEvent<HTMLElement>, repoId: RepoId) => {
    if (event.button !== 1 || busy) {
      return;
    }
    event.preventDefault();
    onClose(repoId);
  };

  return (
    <div className="repo-tabs">
      <div
        ref={listRef}
        className="repo-tabs-scroll"
        role="tablist"
        aria-label={t("repository.tabBarAria")}
      >
        {tabs.map((tab) => {
          const active = tab.repo_id === activeId;
          const dirty = !active && dirtyIds.includes(tab.repo_id);
          return (
            <div
              key={tab.repo_id}
              className={active ? "repo-tab active" : "repo-tab"}
              onAuxClick={(event) => onAuxClick(event, tab.repo_id)}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className="repo-tab-main"
                title={tab.path}
                disabled={busy}
                onClick={() => onActivate(tab.repo_id)}
              >
                {dirty && (
                  <span
                    className="repo-tab-dirty"
                    title={t("repository.tabDirtyTitle", { name: tab.name })}
                    aria-label={t("repository.tabDirtyAria", { name: tab.name })}
                  />
                )}
                <span className="repo-tab-name">{tab.name}</span>
              </button>
              <button
                type="button"
                className="repo-tab-close"
                title={t("repository.tabCloseTitle", { name: tab.name })}
                aria-label={t("repository.tabCloseAria", { name: tab.name })}
                disabled={busy}
                onClick={() => onClose(tab.repo_id)}
              >
                ×
              </button>
            </div>
          );
        })}
        {opening && (
          <span className="repo-tab-opening" aria-hidden="true">
            <span className="repo-tab-dirty" />
            {t("repository.tabOpening")}
          </span>
        )}
      </div>
    </div>
  );
}
