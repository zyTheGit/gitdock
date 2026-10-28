import { useEffect, useState } from "react";
import { FileDiffView } from "../detail/FileDiffView";
import type { ExternalToolConfig, FileStatus } from "../../shared/types";
import { ContextMenu, type MenuItem } from "../../shared/ContextMenu";
import type { CompareLoader, CompareSlot } from "./useCompare";
import { useCompareFileDiff } from "./useCompare";

const STATUS_LETTER: Record<FileStatus, string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  type_changed: "T",
};

const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

interface CompareViewProps {
  repoGeneration: number;
  base: CompareSlot;
  compare: CompareSlot;
  loader: CompareLoader;
  pathFilter: string;
  onPathFilterChange: (value: string) => void;
  tools: ExternalToolConfig[];
  onOpenCommit: (oid: string) => void;
  onExternalDiff: (toolIndex: number, path: string) => void;
  onBack: () => void;
}

export function CompareView({
  repoGeneration,
  base,
  compare,
  loader,
  pathFilter,
  onPathFilterChange,
  tools,
  onOpenCommit,
  onExternalDiff,
  onBack,
}: CompareViewProps) {
  const result = loader.result;
  const files = result?.files ?? [];
  const [filePath, setFilePath] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const diff = useCompareFileDiff(base, compare, filePath, repoGeneration);

  useEffect(() => {
    setFilePath((current) => {
      if (current && files.some((file) => file.path === current)) {
        return current;
      }
      return files[0]?.path ?? null;
    });
  }, [result]);

  const totalAdd = files.reduce((sum, file) => sum + file.additions, 0);
  const totalDel = files.reduce((sum, file) => sum + file.deletions, 0);

  const menuItems: MenuItem[] =
    tools.length === 0
      ? [{ label: "尚未配置外部工具", disabled: true, onSelect: () => undefined }]
      : tools.map((tool, index) => ({
          label: `用 ${tool.name} 打开`,
          onSelect: () => {
            if (menu) {
              onExternalDiff(index, menu.path);
            }
          },
        }));

  return (
    <section className="compare-view">
      <header className="compare-header">
        <div>
          <h2>Compare 相对 Base 共同祖先的改动</h2>
          <div className="compare-sub mono" title={`${base.oid} → ${compare.oid}`}>
            {base.label} ({base.oid.slice(0, 8)}) → {compare.label} ({compare.oid.slice(0, 8)})
          </div>
        </div>
        <div className="compare-meta">
          <span className={result?.mode === "two_dot_fallback" ? "tag warn" : "tag"}>
            {result?.mode === "two_dot_fallback" ? "两点快照降级" : "三点 diff"}
          </span>
          {result && (
            <>
              <span className="muted">
                左侧 Base 独有 <strong>{result.base_only}</strong> · 右侧 Compare 独有{" "}
                <strong>{result.compare_only}</strong>
              </span>
              <span className="diff-add">+{totalAdd}</span>
              <span className="diff-del">-{totalDel}</span>
            </>
          )}
          <button onClick={onBack}>查看图谱</button>
        </div>
      </header>

      {loader.loading && <p className="muted">正在计算三点对比…</p>}
      {loader.error && <div className="banner danger">{loader.error}</div>}
      {result?.mode === "two_dot_fallback" && (
        <div className="banner warning">
          两个引用没有共同祖先（shallow / orphan 仓库），已降级为两端快照对比。
        </div>
      )}
      {result?.warnings.map((warning) => (
        <div className="banner info compact" key={warning.code}>
          {warning.message}
        </div>
      ))}

      {result && (
        <>
          <div className="compare-filter">
            <label>
              路径过滤
              <input
                value={pathFilter}
                placeholder="例如 src/ 或 README.md"
                onChange={(event) => onPathFilterChange(event.target.value)}
              />
            </label>
            {pathFilter && (
              <button className="link" onClick={() => onPathFilterChange("")}>
                清除
              </button>
            )}
            <span className="muted">变更文件 {files.length} 个</span>
          </div>

          <div className="detail-columns compare-columns">
            <div className="compare-side">
              <div className="detail-files">
                <h3>变更文件（{files.length}）</h3>
                {files.length === 0 ? (
                  <p className="muted">此范围没有文件变更。</p>
                ) : (
                  <ul className="file-list compare-file-list">
                    {files.map((file) => (
                      <li key={file.path}>
                        <button
                          className={filePath === file.path ? "file-row active" : "file-row"}
                          onClick={() => setFilePath(file.path)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setFilePath(file.path);
                            setMenu({ x: event.clientX, y: event.clientY, path: file.path });
                          }}
                          title={file.path}
                        >
                          <span className={`file-status file-status-${file.status}`}>
                            {STATUS_LETTER[file.status]}
                          </span>
                          <span className="file-path">{file.path}</span>
                          <span className="file-stats">
                            {file.gitlink ? (
                              <span className="muted">gitlink</span>
                            ) : file.binary ? (
                              <span className="muted">bin</span>
                            ) : (
                              <>
                                <span className="diff-add">+{file.additions}</span>
                                <span className="diff-del">-{file.deletions}</span>
                              </>
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="compare-commits">
                <h3>
                  Compare 引入的提交（{result.commits.length}
                  {result.commits_truncated ? "+" : ""}）
                </h3>
                {result.commits.length === 0 ? (
                  <p className="muted">Compare 没有相对共同祖先的新提交。</p>
                ) : (
                  <ul className="compare-commit-list">
                    {result.commits.map((commit) => (
                      <li key={commit.oid}>
                        <button onClick={() => onOpenCommit(commit.oid)} title={commit.oid}>
                          <span className="compare-commit-summary">{commit.summary}</span>
                          <span className="mono muted">{commit.short_oid}</span>
                          <span className="muted">
                            {dateFormat.format(new Date(commit.authored_at * 1000))}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="detail-diff">
              {diff.loading && <p className="muted">正在读取文件 diff…</p>}
              {diff.error && <div className="banner danger">{diff.error}</div>}
              {diff.data && (
                <FileDiffView
                  key={`compare:${diff.data.path}:${base.oid}:${compare.oid}`}
                  diff={diff.data}
                />
              )}
              {!diff.loading && !diff.data && !diff.error && files.length > 0 && (
                <p className="muted">选择左侧文件查看 diff。</p>
              )}
            </div>
          </div>
        </>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </section>
  );
}
