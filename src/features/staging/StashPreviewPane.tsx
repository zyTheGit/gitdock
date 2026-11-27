import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import { STATUS_LETTER } from "../../shared/fileStatus";
import { ipc } from "../../shared/ipc";
import { useIpcResource } from "../../shared/useIpcResource";
import { FileDiffView } from "../diff/FileDiffView";
import { useIgnoreWhitespace } from "../diff/diffOptions";

/** 单条 stash 的只读预览：文件清单 + 选中文件的 diff（ADR-0030）。 */
export function StashPreviewPane({ oid }: { oid: string | null }) {
  const { t } = useI18n();
  const [filePath, setFilePath] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [ignoreWhitespace] = useIgnoreWhitespace();

  const detail = useIpcResource([oid], () => ipc.readStashDetail(oid!), {
    enabled: oid !== null,
  });
  const files = useMemo(() => detail.data?.files ?? [], [detail.data]);

  // 切换 stash 后回到第一条文件；清单变化（如刷新）时同样校正选择。
  useEffect(() => {
    setFilePath(files[0]?.path ?? null);
    setExpanded(false);
  }, [files]);

  const diff = useIpcResource(
    [oid, filePath, ignoreWhitespace],
    () => ipc.readStashFileDiff(oid!, filePath!, ignoreWhitespace),
    { enabled: oid !== null && filePath !== null },
  );

  if (!oid) {
    return <p className="muted stash-preview-placeholder">{t("staging.stashPreviewSelect")}</p>;
  }

  return (
    <div className="stash-preview" aria-label={t("staging.stashPreviewLabel")}>
      {detail.loading && <p className="muted">{t("staging.stashPreviewLoading")}</p>}
      {detail.error && <div className="banner danger compact">{detail.error}</div>}
      {detail.data && (
        <>
          <div className="stash-preview-hints">
            <span className="muted">
              {t("staging.stashFileCount", { n: detail.data.files.length })}
            </span>
            {detail.data.includes_untracked && (
              <span className="tag">{t("staging.stashIncludesUntracked")}</span>
            )}
            {detail.data.truncated && (
              <span className="tag warn">{t("staging.stashTruncated")}</span>
            )}
          </div>

          {detail.data.files.length === 0 ? (
            <p className="muted">{t("staging.stashPreviewEmpty")}</p>
          ) : (
            <ul className="stash-preview-files" aria-label={t("staging.stashFileListLabel")}>
              {detail.data.files.map((file) => {
                const label =
                  file.old_path && file.old_path !== file.path
                    ? `${file.old_path} → ${file.path}`
                    : file.path;
                return (
                  <li key={file.path}>
                    <button
                      className={file.path === filePath ? "stash-file-row active" : "stash-file-row"}
                      onClick={() => setFilePath(file.path)}
                      title={label}
                      aria-current={file.path === filePath ? "true" : undefined}
                    >
                      <span className={`file-status file-status-${file.status}`}>
                        {STATUS_LETTER[file.status]}
                      </span>
                      <span className="file-path">{label}</span>
                      <span className="file-stats">
                        {file.binary ? (
                          <span className="muted">{t("staging.binary")}</span>
                        ) : (
                          <>
                            <span className="diff-add">+{file.additions}</span>
                            <span className="diff-del">-{file.deletions}</span>
                          </>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="stash-preview-diff">
            {diff.loading && <p className="muted">{t("staging.readingDiff")}</p>}
            {diff.error && <div className="banner danger compact">{diff.error}</div>}
            {diff.data && (
              <FileDiffView
                diff={diff.data}
                files={detail.data.files}
                activePath={filePath ?? undefined}
                onSelectFile={setFilePath}
                expanded={expanded}
                onExpandedChange={setExpanded}
                loading={diff.loading}
                sideLabels={
                  oid
                    ? {
                        left: t("diff.sideBaseline"),
                        right: t("diff.sideStash", { oid: oid.slice(0, 7) }),
                      }
                    : undefined
                }
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
