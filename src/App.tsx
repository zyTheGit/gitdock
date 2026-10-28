import { useCallback, useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { GraphPane } from "./features/graph/GraphPane";
import { useGraph } from "./features/graph/useGraph";
import { errorText } from "./shared/error";
import { ipc } from "./shared/ipc";
import type { AppInfoDto, GraphScope, RepoStateDto, SettingsDto } from "./shared/types";

export default function App() {
  const [info, setInfo] = useState<AppInfoDto | null>(null);
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [repo, setRepo] = useState<RepoStateDto | null>(null);
  const [scope, setScope] = useState<GraphScope>({ kind: "head" });
  const [selectedOid, setSelectedOid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restored = useRef(false);
  const graph = useGraph(repo?.path ?? null, scope);

  const openRepository = useCallback(async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      const state = await ipc.openRepository(path);
      setScope({ kind: "head" });
      setSelectedOid(null);
      setRepo(state);
      setSettings(await ipc.rememberRepository(state.path));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [appInfo, loaded] = await Promise.all([ipc.appInfo(), ipc.loadSettings()]);
        setInfo(appInfo);
        setSettings(loaded);
        if (!restored.current && loaded.restore_last_repository) {
          restored.current = true;
          const last = loaded.recent_repositories[0];
          if (last) {
            await openRepository(last.path);
          }
        }
      } catch (err) {
        setError(errorText(err));
      }
    })();
  }, [openRepository]);

  const pickRepository = useCallback(async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false, title: "选择 Git 仓库" });
      if (typeof selected === "string") {
        await openRepository(selected);
      }
    } catch (err) {
      setError(errorText(err));
    }
  }, [openRepository]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setRepo(await ipc.repositoryState());
      await graph.reload({ keepRows: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }, [graph]);

  const headLabel = repo
    ? repo.head.kind === "branch"
      ? repo.head.branch ?? "分支"
      : repo.head.kind === "detached"
        ? "detached HEAD"
        : "未出生分支"
    : "";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">⎇</span>
          <span>Git Graph</span>
        </div>
        <div className="topbar-actions">
          <button className="primary" onClick={pickRepository} disabled={busy}>
            打开仓库
          </button>
          <button onClick={refresh} disabled={busy || !repo}>
            {busy ? "刷新中…" : "刷新"}
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <h2>最近仓库</h2>
          {settings && settings.recent_repositories.length > 0 ? (
            <ul className="recent">
              {settings.recent_repositories.map((entry) => (
                <li key={entry.path}>
                  <button
                    className={repo?.path === entry.path ? "recent-item active" : "recent-item"}
                    title={entry.path}
                    onClick={() => openRepository(entry.path)}
                    disabled={busy}
                  >
                    {entry.path.split(/[\\/]/).filter(Boolean).pop() ?? entry.path}
                  </button>
                  <span className="recent-path">{entry.path}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">尚未打开过仓库</p>
          )}
          {repo && (
            <div className="repo-facts">
              <h2>仓库信息</h2>
              <dl>
                <dt>对象格式</dt>
                <dd>{repo.object_format.toUpperCase()}</dd>
                <dt>HEAD</dt>
                <dd>{headLabel}</dd>
                <dt>OID</dt>
                <dd className="mono">{repo.head.oid ?? "—"}</dd>
                <dt>generation</dt>
                <dd className="mono">{repo.generation}</dd>
                <dt>引用</dt>
                <dd>{repo.refs.length} 个</dd>
                {repo.is_bare && <dd className="tag">bare（只读）</dd>}
                {repo.is_linked_worktree && <dd className="tag">linked worktree</dd>}
                {repo.is_shallow && <dd className="tag">shallow</dd>}
              </dl>
            </div>
          )}
        </aside>

        <main className="main">
          {repo?.interruption.kinds.length ? (
            <div className="banner warning">
              <strong>{repo.interruption.message}</strong>
              {repo.interruption.files.length > 0 && (
                <span>未完成文件：{repo.interruption.files.join("、")}</span>
              )}
              {repo.interruption.terminal_hint && <code>{repo.interruption.terminal_hint}</code>}
            </div>
          ) : null}

          {repo?.warnings.map((warning) => (
            <div className="banner info" key={warning.code}>
              {warning.message}
            </div>
          ))}

          {info && !info.git_version_supported && (
            <div className="banner danger">
              系统 Git 版本 {info.git_version ?? "未知"} 低于最低要求 {info.minimum_git_version}，写操作将不可用。
            </div>
          )}

          {error && <div className="banner danger">{error}</div>}

          {repo ? (
            <GraphPane
              repo={repo}
              scope={scope}
              onScopeChange={(next) => {
                setScope(next);
                setSelectedOid(null);
              }}
              graph={graph}
              selectedOid={selectedOid}
              onSelect={setSelectedOid}
            />
          ) : (
            <section className="welcome">
              <h1>打开一个本地 Git 仓库</h1>
              <p>支持普通仓库、linked worktree 与 bare 仓库（只读）。MVP 单窗口单仓库。</p>
              <button className="primary large" onClick={pickRepository} disabled={busy}>
                选择仓库目录
              </button>
            </section>
          )}
        </main>
      </div>

      <footer className="statusbar">
        <span>{busy ? "处理中…" : repo ? "就绪" : "未打开仓库"}</span>
        <span className="mono">
          {info ? `git ${info.git_version ?? "未知"} · ${info.platform}` : ""}
        </span>
      </footer>
    </div>
  );
}
