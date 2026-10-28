import { useEffect, useState } from "react";
import type { CommitSummaryDto, FileStatus, RepoStateDto } from "../../shared/types";
import { FileDiffView } from "./FileDiffView";
import { useCommitDetail, useFileDiff } from "./useCommitDetail";

const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const STATUS_LETTER: Record<FileStatus, string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  type_changed: "T",
};

function formatDate(seconds: number): string {
  return seconds ? dateFormat.format(new Date(seconds * 1000)) : "—";
}

function shortOid(oid: string): string {
  return oid.slice(0, 8);
}

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
  onClose: () => void;
}

export function CommitDetailPane({ repo, oid, onClose }: CommitDetailPaneProps) {
  const detail = useCommitDetail(oid, repo.generation);
  const [filePath, setFilePath] = useState<string | null>(null);
  const fileDiff = useFileDiff(oid, filePath, repo.generation);

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

  return (
    <aside className="detail-pane" aria-label="提交详情">
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

              <div className="detail-diff">
                {fileDiff.loading && <p className="muted">正在读取文件 diff…</p>}
                {fileDiff.error && <div className="banner danger">{fileDiff.error}</div>}
                {fileDiff.data && (
                  <FileDiffView key={`${oid}:${fileDiff.data.path}`} diff={fileDiff.data} />
                )}
                {!fileDiff.loading && !fileDiff.data && !fileDiff.error && files.length > 0 && (
                  <p className="muted">选择左侧文件查看 diff。</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
