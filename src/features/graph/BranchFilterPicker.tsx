import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { useEscClose } from "../../shared/useEscClose";
import type { GraphScope, RefDto } from "../../shared/types";

interface BranchFilterPickerProps {
  scope: GraphScope;
  localBranches: RefDto[];
  remoteBranches: RefDto[];
  tags: RefDto[];
  onScopeChange: (scope: GraphScope) => void;
}

/** 可搜索分支/标签范围选择器：替代原生 `<select>`，长分支列表下可输入过滤。 */
export function BranchFilterPicker({
  scope,
  localBranches,
  remoteBranches,
  tags,
  onScopeChange,
}: BranchFilterPickerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEscClose(() => setOpen(false), !open);

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    const timer = window.requestAnimationFrame(() => inputRef.current?.focus());
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.cancelAnimationFrame(timer);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  const normalized = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      [
        { label: t("shell.localBranches"), refs: localBranches },
        { label: t("shell.remoteBranches"), refs: remoteBranches },
        { label: t("repository.tags"), refs: tags },
      ]
        .map((group) => ({
          label: group.label,
          refs: normalized
            ? group.refs.filter((ref) => ref.short_name.toLowerCase().includes(normalized))
            : group.refs,
        }))
        .filter((group) => group.refs.length > 0),
    [localBranches, remoteBranches, tags, normalized, t],
  );

  const activeBranch = scope.kind === "branch" ? scope.value : null;

  return (
    <div className="branch-filter-picker" ref={rootRef}>
      <button
        type="button"
        className={activeBranch ? "branch-filter-trigger active" : "branch-filter-trigger"}
        aria-label={t("graph.branchFilterAria")}
        aria-expanded={open}
        title={activeBranch ?? t("graph.branchFilterPlaceholder")}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="branch-filter-value">
          {activeBranch ?? t("graph.branchFilterPlaceholder")}
        </span>
        <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <div
          className="branch-filter-popover"
          role="dialog"
          aria-label={t("graph.branchFilterAria")}
        >
          <input
            ref={inputRef}
            className="branch-filter-search"
            type="text"
            value={query}
            placeholder={t("graph.branchFilterSearchPlaceholder")}
            aria-label={t("graph.branchFilterSearchPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
          />
          {activeBranch && (
            <button
              type="button"
              className="branch-filter-clear"
              onClick={() => {
                onScopeChange({ kind: "head" });
                setOpen(false);
              }}
            >
              {t("graph.branchFilterClear")}
            </button>
          )}
          <div className="branch-filter-list">
            {groups.length === 0 ? (
              <p className="branch-filter-empty muted">{t("graph.branchFilterEmpty")}</p>
            ) : (
              groups.map((group) => (
                <div key={group.label} className="branch-filter-group">
                  <div className="branch-filter-group-label">{group.label}</div>
                  {group.refs.map((ref) => (
                    <button
                      key={`${group.label}:${ref.short_name}`}
                      type="button"
                      className={
                        activeBranch === ref.short_name
                          ? "branch-filter-option active"
                          : "branch-filter-option"
                      }
                      title={ref.short_name}
                      onClick={() => {
                        // 后端 GraphScope::Branch 依次解析 refs/heads、refs/remotes、refs/tags。
                        onScopeChange({ kind: "branch", value: ref.short_name });
                        setOpen(false);
                      }}
                    >
                      {ref.short_name}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
