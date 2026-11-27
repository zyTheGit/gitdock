import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "../../i18n";
import type { RecentRepository, RepoId, RepoTabDto } from "../../shared/types";

interface RepositorySwitcherProps {
  currentPath: string | null;
  tabs: RepoTabDto[];
  activeRepoId: RepoId | null;
  recent: RecentRepository[];
  busy: boolean;
  onActivate: (repoId: RepoId) => void;
  onOpen: (path: string) => void;
  onForget: (path: string) => void;
  onPick: () => void;
}

interface Entry {
  key: string;
  path: string;
  name: string;
  current: boolean;
  repoId?: RepoId;
  removable: boolean;
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

function repoName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function RepositorySwitcher({
  currentPath,
  tabs,
  activeRepoId,
  recent,
  busy,
  onActivate,
  onOpen,
  onForget,
  onPick,
}: RepositorySwitcherProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    const needle = normalize(query.trim());
    const matches = (path: string) =>
      !needle || normalize(path).includes(needle) || repoName(path).toLowerCase().includes(needle);
    const current =
      currentPath && matches(currentPath)
        ? [
            {
              key: "current",
              path: currentPath,
              name: repoName(currentPath),
              current: true,
              repoId: activeRepoId ?? undefined,
              removable: false,
            },
          ]
        : [];
    const seen = new Set(current.map((entry) => normalize(entry.path)));
    const openEntries: Entry[] = tabs
      .filter((tab) => !seen.has(normalize(tab.path)) && matches(tab.path))
      .map((tab) => {
        seen.add(normalize(tab.path));
        return {
          key: `tab:${tab.repo_id}`,
          path: tab.path,
          name: tab.name,
          current: false,
          repoId: tab.repo_id,
          removable: false,
        };
      });
    const recentEntries: Entry[] = recent
      .filter((entry) => !seen.has(normalize(entry.path)) && matches(entry.path))
      .map((entry) => {
        seen.add(normalize(entry.path));
        return {
          key: `recent:${normalize(entry.path)}`,
          path: entry.path,
          name: repoName(entry.path),
          current: false,
          removable: true,
        };
      });
    return [
      { title: t("repository.groupCurrent"), entries: current },
      { title: t("repository.groupRecent"), entries: [...openEntries, ...recentEntries] },
    ].filter((group) => group.entries.length > 0);
  }, [activeRepoId, currentPath, query, recent, tabs, t]);

  const entries = useMemo(() => groups.flatMap((group) => group.entries), [groups]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(entries.length - 1, 0)));
  }, [entries.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-repo-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  };

  const choose = (entry: Entry) => {
    close();
    if (entry.current) return;
    if (entry.repoId !== undefined) onActivate(entry.repoId);
    else onOpen(entry.path);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (entries.length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => (index + delta + entries.length) % entries.length);
      return;
    }
    if (event.key === "Enter" && entries[activeIndex]) {
      event.preventDefault();
      choose(entries[activeIndex]);
    }
  };

  return (
    <div className="repo-switcher" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        className="repo-switch-button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={currentPath ?? t("repository.switchRepoTitle")}
        disabled={busy}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="brand-mark">⎇</span>
        <span className="repo-switch-name">{currentPath ? repoName(currentPath) : "GitDock"}</span>
        <span className="repo-switch-caret">▾</span>
      </button>
      {open && (
        <div className="repo-menu" role="menu" aria-label={t("repository.switchRepoMenu")}>
          <input
            className="repo-search"
            autoFocus
            placeholder={t("repository.searchPlaceholder")}
            value={query}
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
              groups.map((group) => (
                <div key={group.title}>
                  <p className="repo-menu-section">{group.title}</p>
                  {group.entries.map((entry) => {
                    const index = entries.indexOf(entry);
                    return (
                      <div
                        key={entry.key}
                        className={index === activeIndex ? "repo-menu-item active" : "repo-menu-item"}
                        onMouseEnter={() => setActiveIndex(index)}
                      >
                        <button
                          type="button"
                          className="repo-menu-main"
                          role="menuitem"
                          data-repo-index={index}
                          disabled={busy || entry.current}
                          title={entry.path}
                          onClick={() => choose(entry)}
                        >
                          <span className="repo-menu-name">
                            {entry.name}
                            {entry.current && <span className="repo-menu-check">✓</span>}
                          </span>
                          <span className="repo-menu-path">{entry.path}</span>
                        </button>
                        {entry.removable && (
                          <button
                            type="button"
                            className="repo-menu-remove"
                            title={t("repository.removeRecentTitle")}
                            aria-label={t("repository.removeRecentAria", { name: entry.name })}
                            disabled={busy}
                            onClick={() => {
                              setActiveIndex((current) => (index < current ? current - 1 : current));
                              onForget(entry.path);
                            }}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
          <div className="repo-menu-footer">
            <button type="button" className="link" disabled={busy} onClick={() => { close(); onPick(); }}>
              {t("repository.openLocalRepo")}
            </button>
            {entries.length > 0 && <p className="repo-menu-hint">{t("repository.menuHint")}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
