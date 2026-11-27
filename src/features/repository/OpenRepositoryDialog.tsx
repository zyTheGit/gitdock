import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "../../i18n";
import { Modal } from "../../shared/Modal";
import { useEscClose } from "../../shared/useEscClose";
import type { RecentRepository } from "../../shared/types";
import {
  buildRepositoryGroups,
  moveRepositorySelection,
  type RepositoryEntry,
} from "./repositoryEntries";

interface OpenRepositoryDialogProps {
  currentPath: string | null;
  recent: RecentRepository[];
  busy: boolean;
  onOpen: (path: string) => void;
  onForget: (path: string) => void | Promise<void>;
  onPick: () => void;
  onClose: () => void;
}

/**
 * 统一打开仓库弹层：最近仓库搜索/移除与本地目录选择共用同一入口。
 * 由 AppShell 单例挂载，顶栏和欢迎页只是打开它的不同触发器。
 */
export function OpenRepositoryDialog({
  currentPath,
  recent,
  busy,
  onOpen,
  onForget,
  onPick,
  onClose,
}: OpenRepositoryDialogProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [forgettingPath, setForgettingPath] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const forgettingRef = useRef(false);
  const actingRef = useRef(false);

  const groups = useMemo(
    () => buildRepositoryGroups(currentPath, recent, query),
    [currentPath, recent, query],
  );
  const entries = useMemo(() => groups.flatMap((group) => group.entries), [groups]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(entries.length - 1, 0)));
  }, [entries.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-repo-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // 弹层加入既有 Esc 层栈：只关闭本层，不改变 useGlobalEsc 的优先级。
  useEscClose(onClose);

  const choose = (path: string) => {
    if (busy || actingRef.current) {
      return;
    }
    actingRef.current = true;
    onClose();
    onOpen(path);
  };

  const forget = (entry: RepositoryEntry) => {
    if (busy || forgettingRef.current) {
      return;
    }
    forgettingRef.current = true;
    setForgettingPath(entry.path);
    // 删除后高亮停在同一位置，由下一条仓库接替，避免跳到列表末尾。
    setActiveIndex((index) => (entries.indexOf(entry) < index ? index - 1 : index));
    void Promise.resolve()
      .then(() => onForget(entry.path))
      .catch(() => undefined)
      .finally(() => {
        forgettingRef.current = false;
        setForgettingPath(null);
      });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // 中文输入法组合态只负责上屏，不参与仓库选择或确认。
    if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) {
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) =>
        moveRepositorySelection(index, event.key === "ArrowDown" ? 1 : -1, entries.length),
      );
      return;
    }
    if (event.key === "Enter" && !busy && entries[activeIndex]) {
      event.preventDefault();
      choose(entries[activeIndex].path);
    }
  };

  return (
    <Modal
      className="open-repository-dialog"
      labelledBy="open-repository-dialog-title"
      onBackdropClick={onClose}
    >
      <div className="open-repository-dialog-body">
        <header>
          <h2 id="open-repository-dialog-title">{t("repository.openDialogTitle")}</h2>
          <button
            type="button"
            className="detail-close"
            onClick={onClose}
            aria-label={t("repository.closeDialog")}
          >
            ×
          </button>
        </header>

        <input
          className="repo-search"
          autoFocus
          type="search"
          value={query}
          placeholder={t("repository.searchPlaceholder")}
          aria-label={t("repository.searchPlaceholder")}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
        />

        <div className="repo-menu-list" ref={listRef}>
          {groups.length === 0 ? (
            <p className="repo-menu-empty">
              {query.trim()
                ? t("repository.noMatches")
                : currentPath
                  ? t("repository.recentCleared")
                  : t("repository.neverOpened")}
            </p>
          ) : (
            groups.map((group) => {
              const titleKey = group.kind === "current" ? "repository.groupCurrent" : "repository.groupRecent";
              return (
                <div key={group.kind} role="group" aria-label={t(titleKey)}>
                  <p className="repo-menu-section">{t(titleKey)}</p>
                  {group.entries.map((entry) => {
                    const index = entries.indexOf(entry);
                    const removing = forgettingPath === entry.path;
                    return (
                      <div
                        key={entry.key}
                        className={index === activeIndex ? "repo-menu-item active" : "repo-menu-item"}
                        onMouseEnter={() => setActiveIndex(index)}
                      >
                        <button
                          type="button"
                          className="repo-menu-main"
                          data-repo-index={index}
                          disabled={busy}
                          title={entry.path}
                          aria-current={entry.current ? "true" : undefined}
                          onClick={() => choose(entry.path)}
                        >
                          <span className="repo-menu-name">
                            {entry.name}
                            {entry.current && <span className="repo-menu-check" aria-hidden="true">✓</span>}
                          </span>
                          <span className="repo-menu-path">{entry.path}</span>
                        </button>
                        {!entry.current && (
                          <button
                            type="button"
                            className="repo-menu-remove"
                            title={t("repository.removeRecentTitle")}
                            aria-label={t("repository.removeRecentAria", { name: entry.name })}
                            aria-busy={removing}
                            disabled={busy || forgettingPath !== null}
                            // 保持输入框焦点，移除后仍可继续用 ↑↓ / Enter 选择。
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => forget(entry)}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="repo-menu-footer">
          <button
            type="button"
            className="link"
            disabled={busy}
            onClick={() => {
              if (!busy && !actingRef.current) {
                actingRef.current = true;
                onClose();
                onPick();
              }
            }}
          >
            {t("repository.openLocalRepo")}
          </button>
          {entries.length > 0 && <p className="repo-menu-hint">{t("repository.menuHint")}</p>}
        </div>
      </div>
    </Modal>
  );
}
