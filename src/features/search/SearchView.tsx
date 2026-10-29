import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { errorText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import type {
  CommitSummaryDto,
  GraphScope,
  RepoStateDto,
  SearchField,
  SearchMatchDto,
} from "../../shared/types";
import { GraphList } from "../graph/GraphList";
import { startView, type GraphView } from "../graph/model";
import type { SearchLoader } from "./useSearch";

const FIELD_LABEL: Record<SearchField, string> = {
  message: "信息",
  hash: "哈希",
  author: "作者",
  path: "路径",
};

const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const SUGGESTION_LIMIT = 8;

/** 候选词只来自已加载的图谱页；输入为空时不给候选。 */
function buildSuggestions(input: string, commits: CommitSummaryDto[]): string[] {
  const needle = input.trim().toLowerCase();
  if (!needle) {
    return [];
  }
  const authors = new Map<string, number>();
  for (const commit of commits) {
    authors.set(commit.author_name, (authors.get(commit.author_name) ?? 0) + 1);
  }
  const authorHits = [...authors.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .filter((name) => name.toLowerCase().includes(needle));

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (text: string) => {
    const key = text.toLowerCase();
    if (!text || seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(text);
  };

  for (const name of authorHits.slice(0, 2)) {
    push(name);
  }
  for (const commit of commits) {
    if (out.length >= SUGGESTION_LIMIT) {
      break;
    }
    if (commit.summary.toLowerCase().includes(needle)) {
      push(commit.summary);
    }
  }
  return out;
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
  scope: GraphScope;
  search: SearchLoader;
  commits: CommitSummaryDto[];
  onOpenCommit: (oid: string) => void;
  onClose: () => void;
}

interface Located {
  view: GraphView;
  oid: string;
}

export function SearchView({ repo, scope, search, commits, onOpenCommit, onClose }: SearchViewProps) {
  const [input, setInput] = useState(search.text);
  const [active, setActive] = useState(-1);
  const [suggestOpen, setSuggestOpen] = useState(true);
  const [located, setLocated] = useState<Located | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  const suggestions = useMemo(() => buildSuggestions(input, commits), [input, commits]);

  useEffect(() => {
    setActive(-1);
  }, [input]);

  // F4-1：结果可能落在当前页之外，按需加载目标页并居中高亮，且可返回结果列表。
  const locate = async (match: SearchMatchDto) => {
    setLocating(true);
    setLocateError(null);
    try {
      const page = await ipc.readGraphPageAround(scope, match.commit.oid, 200);
      if (page.generation !== repo.generation) {
        setLocateError("仓库状态已变化，请重新搜索后再定位");
        return;
      }
      setLocated({ view: startView(page), oid: match.commit.oid });
    } catch (err) {
      setLocateError(errorText(err));
    } finally {
      setLocating(false);
    }
  };

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
      runSearch(suggestOpen && active >= 0 ? suggestions[active] : input);
    }
  };

  const repoName = repo.path.split(/[\\/]/).filter(Boolean).pop();

  if (located) {
    return (
      <div className="modal-backdrop search-backdrop" role="dialog" aria-modal="true">
        <div className="search-dialog search-dialog-located">
          <header>
            <h2>搜索提交</h2>
            <button className="detail-close" onClick={onClose} aria-label="关闭搜索">
              ×
            </button>
          </header>
          <div className="search-located-bar">
            <button onClick={() => setLocated(null)}>← 返回结果列表</button>
            <span className="muted">
              已定位 <span className="mono">{located.oid.slice(0, 8)}</span> · 共{" "}
              {located.view.rows.length} 条
            </span>
          </div>
          <div className="graph-scroll search-located-list">
            <GraphList
              view={located.view}
              loading={false}
              loadingMore={false}
              selectedOid={located.oid}
              focusedOid={located.oid}
              onSelect={onOpenCommit}
              onLoadMore={() => undefined}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop search-backdrop" role="dialog" aria-modal="true">
      <div className="search-dialog">
        <header>
          <h2>搜索提交</h2>
          <button className="detail-close" onClick={onClose} aria-label="关闭搜索">
            ×
          </button>
        </header>

        <div className="search-toolbar">
          <div className="search-input-wrap">
            <input
              autoFocus
              value={input}
              placeholder="搜索信息 / 至少 7 位 hash / 作者 / 路径"
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
                  <li key={suggestion}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      // 按下鼠标时保持输入框焦点，否则 blur 会先收起候选、点击落空。
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => runSearch(suggestion)}
                    >
                      <span className="suggestion-text">{highlight(suggestion, input)}</span>
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
            {search.loading ? "搜索中…" : "搜索"}
          </button>
          {(search.loading || search.hasMore) && (
            <button onClick={search.cancel} disabled={search.canceled}>
              取消
            </button>
          )}
        </div>

        <p className="muted search-scope">
          搜索范围：{repoName} · 当前视图 ref 范围 · 文件路径按“改动中出现”匹配
          {search.results.length > 0 ? ` · 已返回 ${search.results.length} 条` : ""}
        </p>

        {search.error && <div className="banner danger">{search.error}</div>}
        {search.canceled && (
          <div className="banner info">搜索已取消；已有结果保留，不再继续追加。</div>
        )}
        {locateError && <div className="banner danger">{locateError}</div>}
        {locating && <p className="muted">正在加载目标页…</p>}

        {!search.text && !search.loading && (
          <p className="muted">输入关键词后回车搜索；候选来自当前已加载提交的作者与说明。</p>
        )}
        {search.results.length === 0 && !search.loading && search.text && !search.canceled && (
          <p className="muted">没有匹配的提交。hash 前缀至少 7 位。</p>
        )}

        {search.results.length > 0 && (
          <ul className="search-results">
            {search.results.map((match) => (
              <li key={match.commit.oid}>
                <button
                  onClick={() => void locate(match)}
                  title={`${match.commit.oid} · 加载目标页并定位`}
                >
                  <span className="search-summary">{match.commit.summary || "（无提交说明）"}</span>
                  <span className="search-fields">
                    {match.fields.map((field) => (
                      <span className="tag" key={field}>
                        {FIELD_LABEL[field]}
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
                    {dateFormat.format(new Date(match.commit.authored_at * 1000))}
                  </span>
                  <span className="mono muted">{match.commit.short_oid}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {search.hasMore && (
          <div className="search-more">
            <button onClick={search.loadMore} disabled={search.loadingMore}>
              {search.loadingMore ? "加载中…" : "加载更多结果"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
