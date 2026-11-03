import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { currentLocale, useI18n } from "../../i18n";
import type { CommitSummaryDto, RepoStateDto, SearchField } from "../../shared/types";
import { buildSuggestions, type Suggestion } from "./suggestions";
import type { SearchLoader } from "./useSearch";

// 提交搜索命中域 → 文案 key；渲染处用 t(FIELD_LABEL_KEY[field])。
const FIELD_LABEL_KEY = {
  message: "search.fieldMessage",
  hash: "search.fieldHash",
  author: "search.fieldAuthor",
  path: "search.fieldPath",
} as const satisfies Record<SearchField, string>;

// 结果行高度初值（12px 文本 + 上下 padding）；文本行高随字体而定，
// 首帧后由 measureElement 按实际渲染高度修正。
const RESULT_ROW_ESTIMATE = 32;
const RESULT_LIST_OVERSCAN = 12;

// 结果行日期只含年月日（区别于 format.ts 的日期时间），按当前语言缓存 formatter。
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function resultDateFormatter(): Intl.DateTimeFormat {
  const locale = currentLocale();
  let cached = dateFormatters.get(locale);
  if (!cached) {
    cached = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateFormatters.set(locale, cached);
  }
  return cached;
}

function highlight(text: string, needle: string) {
  const trimmed = needle.trim();
  const index = trimmed ? text.toLowerCase().indexOf(trimmed.toLowerCase()) : -1;
  if (index < 0) {
    return text;
  }
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + trimmed.length)}</mark>
      {text.slice(index + trimmed.length)}
    </>
  );
}

interface SearchViewProps {
  repo: RepoStateDto;
  search: SearchLoader;
  commits: CommitSummaryDto[];
  /** F4-1：命中项可能不在当前页，交由主视图载入目标页并居中高亮。 */
  onLocateCommit: (oid: string) => void;
  onClose: () => void;
}

export function SearchView({ repo, search, commits, onLocateCommit, onClose }: SearchViewProps) {
  const { t } = useI18n();
  const [input, setInput] = useState(search.text);
  const [active, setActive] = useState(-1);
  const [suggestOpen, setSuggestOpen] = useState(true);

  const suggestions = useMemo(() => buildSuggestions(input, commits), [input, commits]);

  const resultsScrollRef = useRef<HTMLDivElement>(null);
  // 搜索结果虚拟化：无限追加数千条命中时只渲染可视行；「加载更多」按钮在列表外，不受影响。
  const resultsVirtualizer = useVirtualizer({
    count: search.results.length,
    getScrollElement: () => resultsScrollRef.current,
    estimateSize: () => RESULT_ROW_ESTIMATE,
    overscan: RESULT_LIST_OVERSCAN,
    getItemKey: (index) => search.results[index]?.commit.oid ?? index,
  });

  useEffect(() => {
    setActive(-1);
  }, [input]);

  const runSearch = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || search.loading) {
      return;
    }
    setInput(trimmed);
    setSuggestOpen(false);
    setActive(-1);
    search.start(trimmed);
  };

  // 说明候选已经指向具体提交，选中即回主视图定位，不再退回结果列表二次确认。
  const pick = (suggestion: Suggestion) => {
    if (suggestion.oid) {
      setSuggestOpen(false);
      onLocateCommit(suggestion.oid);
      return;
    }
    runSearch(suggestion.text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // 输入法组合中的按键用于上屏，不参与候选与提交。
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "ArrowDown" && suggestions.length > 0) {
      event.preventDefault();
      setSuggestOpen(true);
      setActive((current) => Math.min(current + 1, suggestions.length - 1));
      return;
    }
    if (event.key === "ArrowUp" && suggestions.length > 0) {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, -1));
      return;
    }
    if (event.key === "Enter" && !search.loading) {
      event.preventDefault();
      const picked = suggestOpen && active >= 0 ? suggestions[active] : undefined;
      if (picked) {
        pick(picked);
      } else {
        runSearch(input);
      }
    }
  };

  const repoName = repo.path.split(/[\\/]/).filter(Boolean).pop() ?? "";

  return (
    <div className="modal-backdrop search-backdrop" role="dialog" aria-modal="true">
      <div className="search-dialog">
        <header>
          <h2>{t("search.dialogTitle")}</h2>
          <button className="detail-close" onClick={onClose} aria-label={t("search.closeSearch")}>
            ×
          </button>
        </header>

        <div className="search-toolbar">
          <div className="search-input-wrap">
            <input
              autoFocus
              value={input}
              placeholder={t("search.placeholder")}
              role="combobox"
              aria-expanded={suggestOpen && suggestions.length > 0}
              aria-autocomplete="list"
              onChange={(event) => {
                setInput(event.target.value);
                setSuggestOpen(true);
              }}
              onFocus={() => setSuggestOpen(true)}
              onBlur={() => setSuggestOpen(false)}
              onKeyDown={onKeyDown}
            />
            {suggestOpen && suggestions.length > 0 && (
              <ul className="search-suggestions" role="listbox">
                {suggestions.map((suggestion, index) => (
                  <li key={suggestion.oid ?? suggestion.text}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      // 按下鼠标时保持输入框焦点，否则 blur 会先收起候选、点击落空。
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => pick(suggestion)}
                    >
                      <span className="suggestion-text">
                        {highlight(suggestion.text, input)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            className="primary"
            onClick={() => runSearch(input)}
            disabled={search.loading || !input.trim()}
          >
            {search.loading ? t("search.searching") : t("search.searchButton")}
          </button>
          {(search.loading || search.hasMore) && (
            <button onClick={search.cancel} disabled={search.canceled}>
              {t("search.cancel")}
            </button>
          )}
        </div>

        <p className="muted search-scope">
          {search.results.length > 0
            ? t("search.scopeWithResults", { repo: repoName, n: search.results.length })
            : t("search.scopeHint", { repo: repoName })}
        </p>

        {search.error && <div className="banner danger">{search.error}</div>}
        {search.canceled && (
          <div className="banner info">{t("search.canceled")}</div>
        )}

        {!search.text && !search.loading && (
          <p className="muted">
            {t("search.hintEnter")}
            <kbd>↑</kbd> <kbd>↓</kbd>
            {t("search.hintPick")}
            <kbd>Esc</kbd>
            {t("search.hintClose")}
            {t("search.hintSource")}
          </p>
        )}
        {search.results.length === 0 && !search.loading && search.text && !search.canceled && (
          <p className="muted">{t("search.noResults")}</p>
        )}

        {search.results.length > 0 && (
          <div className="search-results" ref={resultsScrollRef}>
            <ul
              className="search-results-inner"
              style={{ height: resultsVirtualizer.getTotalSize() }}
            >
              {resultsVirtualizer.getVirtualItems().map((item) => {
                const match = search.results[item.index];
                if (!match) {
                  return null;
                }
                return (
                  <li
                    key={item.key}
                    data-index={item.index}
                    ref={(node) => resultsVirtualizer.measureElement(node)}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${item.start}px)`,
                    }}
                  >
                    <button
                      onClick={() => onLocateCommit(match.commit.oid)}
                      title={t("search.locateInGraph", { oid: match.commit.oid })}
                    >
                      <span className="search-summary">
                        {match.commit.summary || t("search.noSummary")}
                      </span>
                      <span className="search-fields">
                        {match.fields.map((field) => (
                          <span className="tag" key={field}>
                            {t(FIELD_LABEL_KEY[field])}
                          </span>
                        ))}
                      </span>
                      {match.matched_path && (
                        <span className="search-path mono" title={match.matched_path}>
                          {match.matched_path}
                        </span>
                      )}
                      <span className="search-author">{match.commit.author_name}</span>
                      <span className="search-date muted">
                        {resultDateFormatter().format(new Date(match.commit.authored_at * 1000))}
                      </span>
                      <span className="mono muted">{match.commit.short_oid}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {search.hasMore && (
          <div className="search-more">
            <button onClick={search.loadMore} disabled={search.loadingMore}>
              {search.loadingMore ? t("search.loadingMore") : t("search.loadMore")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
