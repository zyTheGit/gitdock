import { useState } from "react";
import { errorText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import type { GraphScope, RepoStateDto, SearchField, SearchMatchDto } from "../../shared/types";
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

interface SearchViewProps {
  repo: RepoStateDto;
  scope: GraphScope;
  search: SearchLoader;
  onOpenCommit: (oid: string) => void;
  onClose: () => void;
}

interface Located {
  view: GraphView;
  oid: string;
}

export function SearchView({ repo, scope, search, onOpenCommit, onClose }: SearchViewProps) {
  const [input, setInput] = useState(search.text);
  const [located, setLocated] = useState<Located | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

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

  if (located) {
    return (
      <section className="search-view">
        <div className="search-located-bar">
          <button onClick={() => setLocated(null)}>← 返回结果列表</button>
          <span className="muted">
            已定位 <span className="mono">{located.oid.slice(0, 8)}</span> · 共{" "}
            {located.view.rows.length} 条
          </span>
          <button className="link" onClick={onClose}>
            关闭搜索
          </button>
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
      </section>
    );
  }

  return (
    <section className="search-view">
      <div className="search-toolbar">
        <input
          autoFocus
          value={input}
          placeholder="搜索信息 / 至少 7 位 hash / 作者 / 路径"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            // 输入法组合中的回车用于上屏，不触发搜索。
            if (event.key === "Enter" && !event.nativeEvent.isComposing && !search.loading) {
              event.preventDefault();
              search.start(input);
            }
          }}
        />
        <button className="primary" onClick={() => search.start(input)} disabled={search.loading}>
          {search.loading ? "搜索中…" : "搜索"}
        </button>
        {(search.loading || search.hasMore) && (
          <button onClick={search.cancel} disabled={search.canceled}>
            取消
          </button>
        )}
        <button className="link" onClick={onClose}>
          关闭
        </button>
      </div>
      <p className="muted search-scope">
        搜索范围：{repo.path.split(/[\\/]/).filter(Boolean).pop()} · 当前视图 ref 范围 · 文件路径按“改动中出现”匹配
      </p>

      {search.error && <div className="banner danger">{search.error}</div>}
      {search.canceled && (
        <div className="banner info">搜索已取消；已有结果保留，不再继续追加。</div>
      )}
      {locateError && <div className="banner danger">{locateError}</div>}
      {locating && <p className="muted">正在加载目标页…</p>}

      {search.results.length === 0 && !search.loading && search.text && !search.canceled && (
        <p className="muted">没有匹配的提交。hash 前缀至少 7 位。</p>
      )}
      {search.results.length > 0 && (
        <ul className="search-results">
          {search.results.map((match) => (
            <li key={match.commit.oid}>
              <button onClick={() => void locate(match)} title={match.commit.oid}>
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
    </section>
  );
}
