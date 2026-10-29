import { useEffect, useState } from "react";
import { FileDiffView } from "../detail/FileDiffView";
import type { CommitSummaryDto, ExternalToolConfig, FileStatus } from "../../shared/types";
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
  twoDot: boolean;
  onTwoDotChange: (value: boolean) => void;
  tools: ExternalToolConfig[];
  commitMenu: (commit: CommitSummaryDto) => MenuItem[];
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
  twoDot,
  onTwoDotChange,
  tools,
  commitMenu,
  onOpenCommit,
  onExternalDiff,
  onBack,
}: CompareViewProps) {
  const result = loader.result;
  const files = result?.files ?? [];
  const [filePath, setFilePath] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [commitMenuPos, setCommitMenuPos] = useState<{
    x: number;
    y: number;
    commit: CommitSummaryDto;
  } | null>(null);
  const [toolIndex, setToolIndex] = useState(0);
  const diff = useCompareFileDiff(base, compare, filePath, repoGeneration, twoDot);
  const safeToolIndex = Math.min(toolIndex, Math.max(0, tools.length - 1));
  const activeTool = tools[safeToolIndex];
  // Base 与 Compare 指向同一提交时优先给出明确提示，避免被误认为功能失效。
  const sameTip = Boolean(result && result.files.length === 0 && base.oid === compare.oid);
  // 三点 diff 为空（祖先关系或两端工作树一致）时解释原因并提供两点快照入口。
  const emptyHint = Boolean(result && !twoDot && !sameTip && result.files.length === 0);

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
          <h2>{twoDot ? "Compare 与 Base 的完整快照差异" : "Compare 相对 Base 共同祖先的改动"}</h2>
          <div className="compare-sub mono" title={`${base.oid} → ${compare.oid}`}>
            {base.label} ({base.oid.slice(0, 8)}) → {compare.label} ({compare.oid.slice(0, 8)})
          </div>
        </div>
        <div className="compare-meta">
          <div className="diff-mode" role="group" aria-label="对比模式">
            <button
              className={twoDot ? "" : "active"}
              onClick={() => onTwoDotChange(false)}
              title="git diff base...compare：只显示 Compare 相对共同祖先的改动"
            >
              三点 diff
            </button>
            <button
              className={twoDot ? "active" : ""}
              onClick={() => onTwoDotChange(true)}
              title="git diff base compare：显示两个提交的完整快照差异"
            >
              两点快照
            </button>
          </div>
          <span className={result?.mode === "two_dot_fallback" ? "tag warn" : "tag"}>
            {result?.mode === "two_dot_fallback"
              ? "两点快照降级"
              : result?.mode === "two_dot"
                ? "两点快照"
                : "三点 diff"}
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
      {sameTip && (
        <div className="banner info compact">
          Base 与 Compare 指向同一提交（<span className="mono">{base.oid.slice(0, 8)}</span>
          ），没有可显示的差异。
        </div>
      )}
      {emptyHint && (
        <div className="banner info compact">
          三点 diff 为空：Compare 相对共同祖先没有引入文件改动（例如 Compare 是 Base 的祖先，
          或两端工作树内容一致）。
          <button className="link" onClick={() => onTwoDotChange(true)}>
            切换到两点快照查看两端完整差异
          </button>
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
            {tools.length > 0 && (
              <span className="compare-tools">
                <select
                  value={safeToolIndex}
                  onChange={(event) => setToolIndex(Number(event.target.value))}
                  aria-label="选择外部对比工具"
                >
                  {tools.map((tool, index) => (
                    <option key={`${tool.name}:${index}`} value={index}>
                      {tool.name}
                    </option>
                  ))}
                </select>
                <button
                  disabled={!filePath}
                  onClick={() => {
                    if (filePath) {
                      onExternalDiff(safeToolIndex, filePath);
                    }
                  }}
                >
                  用 {activeTool?.name ?? "外部工具"} 打开当前文件
                </button>
              </span>
            )}
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
                        <button
                          onClick={() => onOpenCommit(commit.oid)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setCommitMenuPos({
                              x: event.clientX,
                              y: event.clientY,
                              commit,
                            });
                          }}
                          title={commit.oid}
                        >
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

      {commitMenuPos && (
        <ContextMenu
          x={commitMenuPos.x}
          y={commitMenuPos.y}
          items={commitMenu(commitMenuPos.commit)}
          onClose={() => setCommitMenuPos(null)}
        />
      )}
    </section>
  );
}
