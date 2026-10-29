import { useEffect, useState } from "react";
import { ContextMenu, type MenuItem } from "../../shared/ContextMenu";
import { STATUS_LETTER } from "../../shared/fileStatus";
import { formatDate, shortOid } from "../../shared/format";
import type {
  CommitSummaryDto,
  ExternalToolConfig,
  FileDiffDto,
  RepoStateDto,
} from "../../shared/types";
import { FileDiffView } from "./FileDiffView";
import { useBranchesContaining, useCommitDetail, useFileDiff } from "./useCommitDetail";

function RefBadges({ commit }: { commit: CommitSummaryDto }) {
  if (commit.refs.length === 0) {
    return null;
  }
  return (
    <span className="detail-refs">
      {commit.refs.map((badge) => (
        <span
          key={`${badge.kind}:${badge.name}`}
          className={[
            "ref-badge",
            `ref-${badge.kind}`,
            badge.is_head ? "ref-head" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          title={`${badge.kind} · ${badge.name}`}
        >
          {badge.is_head ? "HEAD → " : ""}
          {badge.name}
        </span>
      ))}
    </span>
  );
}

interface CommitDetailPaneProps {
  repo: RepoStateDto;
  oid: string;
  tools: ExternalToolConfig[];
  width: number;
  onClose: () => void;
  onBranchJump: (branch: string) => void;
  onExternalDiff: (toolIndex: number, path: string, left: string | null) => void;
}

export function CommitDetailPane({
  repo,
  oid,
  tools,
  width,
  onClose,
  onBranchJump,
  onExternalDiff,
}: CommitDetailPaneProps) {
  const detail = useCommitDetail(oid, repo.generation);
  const branches = useBranchesContaining(oid, repo.generation);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [expandedDiff, setExpandedDiff] = useState(false);
  // 放大视图内切换文件时保留上一份内容，等新 diff 到达再替换，避免遮罩闪退。
  const [lastDiff, setLastDiff] = useState<FileDiffDto | null>(null);
  const fileDiff = useFileDiff(oid, filePath, repo.generation);

  useEffect(() => {
    if (fileDiff.data) {
      setLastDiff(fileDiff.data);
    }
  }, [fileDiff.data]);

  useEffect(() => {
    setExpandedDiff(false);
  }, [oid]);

  useEffect(() => {
    if (fileDiff.error) {
      setExpandedDiff(false);
    }
  }, [fileDiff.error]);

  useEffect(() => {
    const files = detail.data?.files ?? [];
    setFilePath((current) => {
      if (current && files.some((file) => file.path === current)) {
        return current;
      }
      return files[0]?.path ?? null;
    });
  }, [detail.data]);

  const commit = detail.data?.commit;
  const files = detail.data?.files ?? [];
  const shownDiff = fileDiff.data ?? (expandedDiff ? lastDiff : null);
  const baseOid = detail.data?.parents[0] ?? null;
  const menuItems: MenuItem[] =
    tools.length === 0
      ? [{ label: "尚未配置外部工具", disabled: true, onSelect: () => undefined }]
      : tools.map((tool, index) => ({
          label: `用 ${tool.name} 打开`,
          onSelect: () => {
            if (menu) {
              onExternalDiff(index, menu.path, baseOid);
            }
          },
        }));

  return (
    <aside className="detail-pane" aria-label="提交详情" style={{ width }}>
      <header className="detail-header">
        <div className="detail-title-row">
          <div>
            <h2 className="detail-summary">{commit?.summary || "提交详情"}</h2>
            {commit && (
              <div className="detail-sub mono" title={commit.oid}>
                {commit.oid}
              </div>
            )}
          </div>
          <button className="detail-close" onClick={onClose} aria-label="关闭详情">
            ×
          </button>
        </div>
        {commit && (
          <div className="detail-meta">
            <span>{commit.author_name}</span>
            <span className="muted">{commit.author_email}</span>
            <span className="muted">{formatDate(commit.authored_at)}</span>
            <RefBadges commit={commit} />
          </div>
        )}
      </header>

      <div className="detail-scroll">
        {detail.loading && <p className="muted">正在读取提交详情…</p>}
        {detail.error && <div className="banner danger">{detail.error}</div>}

        {detail.data && (
          <>
            <details className="commit-message-block" open>
              <summary>提交说明</summary>
              <pre className="commit-message">{detail.data.message.trimEnd()}</pre>
            </details>

            <div className="detail-facts">
              <span className="muted">父提交</span>
              {detail.data.parents.length === 0 ? (
                <span>（根提交）</span>
              ) : (
                <span className="parent-list">
                  {detail.data.parents.map((parent) => (
                    <code key={parent} title={parent}>
                      {shortOid(parent)}
                    </code>
                  ))}
                </span>
              )}
            </div>

            <div className="detail-facts">
              <span className="muted">所在分支</span>
              {branches.length === 0 ? (
                <span className="muted">（无本地分支包含此提交）</span>
              ) : (
                <span className="branch-list">
                  {branches.map((branch) => (
                    <button
                      key={branch}
                      className="branch-chip"
                      onClick={() => onBranchJump(branch)}
                      title={`切换到 ${branch} 的图谱视图`}
                    >
                      {branch}
                    </button>
                  ))}
                </span>
              )}
            </div>

            <div
              className={
                detail.data.baseline === "merge_first_parent"
                  ? "baseline-note merge"
                  : "baseline-note muted"
              }
            >
              {detail.data.baseline_note}
            </div>

            {detail.data.warnings.map((warning) => (
              <div className="banner warning compact" key={warning.code}>
                {warning.message}
              </div>
            ))}

            <div className="detail-columns">
              <div className="detail-files">
                <h3>变更文件（{files.length}）</h3>
                {files.length === 0 ? (
                  <p className="muted">此提交没有文件变更。</p>
                ) : (
                  <ul className="file-list">
                    {files.map((file) => (
                      <li key={file.path}>
                        <button
                          className={
                            filePath === file.path ? "file-row active" : "file-row"
                          }
                          onClick={() => setFilePath(file.path)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setFilePath(file.path);
                            setMenu({ x: event.clientX, y: event.clientY, path: file.path });
                          }}
                          title={`${file.path}（右键可用外部工具对比）`}
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

              <div className="detail-diff">
                {fileDiff.loading && !expandedDiff && (
                  <p className="muted">正在读取文件 diff…</p>
                )}
                {fileDiff.error && <div className="banner danger">{fileDiff.error}</div>}
                {shownDiff && (
                  <FileDiffView
                    key={oid}
                    diff={shownDiff}
                    files={files}
                    activePath={filePath ?? undefined}
                    onSelectFile={setFilePath}
                    expanded={expandedDiff}
                    onExpandedChange={setExpandedDiff}
                    loading={fileDiff.loading}
                  />
                )}
                {!fileDiff.loading && !shownDiff && !fileDiff.error && files.length > 0 && (
                  <p className="muted">选择左侧文件查看 diff。</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </aside>
  );
}
