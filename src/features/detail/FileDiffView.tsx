import { useEffect, useMemo, useState } from "react";
import { Diff, Hunk, parseDiff } from "react-diff-view";
import "react-diff-view/style/index.css";
import type { FileDiffDto, FileStatus } from "../../shared/types";
import { buildDiffTokens } from "./highlight";

const STATUS_LABEL: Record<FileStatus, string> = {
  added: "新增",
  deleted: "删除",
  modified: "修改",
  type_changed: "类型变更",
};

interface FileDiffViewProps {
  diff: FileDiffDto;
}

export function FileDiffView({ diff }: FileDiffViewProps) {
  const [viewType, setViewType] = useState<"split" | "unified">("split");
  const [tokens, setTokens] = useState<Awaited<ReturnType<typeof buildDiffTokens>> | null>(null);

  const parsed = useMemo(() => {
    if (!diff.patch) {
      return null;
    }
    const files = parseDiff(diff.patch);
    return files.find((file) => file.hunks.length > 0) ?? null;
  }, [diff.patch]);

  useEffect(() => {
    setTokens(null);
    if (!parsed) {
      return;
    }
    let cancelled = false;
    void buildDiffTokens(parsed.hunks, diff.language).then((result) => {
      if (!cancelled) {
        setTokens(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [parsed, diff.language]);

  const pathLabel = diff.old_path && diff.old_path !== diff.path
    ? `${diff.old_path} → ${diff.path}`
    : diff.path;

  return (
    <section className="file-diff">
      <header className="file-diff-header">
        <div className="file-diff-title">
          <span className={`file-status file-status-${diff.status}`}>{STATUS_LABEL[diff.status]}</span>
          <span className="file-diff-path mono" title={pathLabel}>
            {pathLabel}
          </span>
        </div>
        <div className="file-diff-meta">
          <span className="diff-add">+{diff.additions}</span>
          <span className="diff-del">-{diff.deletions}</span>
          {diff.language && <span className="muted">{diff.language}</span>}
          {parsed && (
            <div className="view-toggle">
              <button
                className={viewType === "split" ? "active" : ""}
                onClick={() => setViewType("split")}
              >
                并排
              </button>
              <button
                className={viewType === "unified" ? "active" : ""}
                onClick={() => setViewType("unified")}
              >
                统一
              </button>
            </div>
          )}
        </div>
      </header>

      {diff.note &&
        !(
          diff.binary ||
          diff.too_large ||
          diff.truncated ||
          diff.gitlink ||
          diff.encoding_fallback
        ) && <div className="banner info compact">{diff.note}</div>}
      {diff.binary && (
        <div className="banner info compact">二进制文件，不显示文本 diff。</div>
      )}
      {diff.too_large && (
        <div className="banner warning compact">文件过大，仅显示变更统计，不加载内容。</div>
      )}
      {diff.truncated && (
        <div className="banner warning compact">diff 过长，已截断为前若干行。</div>
      )}
      {diff.encoding_fallback && (
        <div className="banner info compact">文件包含非 UTF-8 字节，已按替换字符显示。</div>
      )}
      {diff.gitlink && (
        <div className="banner info compact">
          子模块指针变更：
          <code>{(diff.gitlink_old ?? "（空）").slice(0, 12)}</code> →{" "}
          <code>{(diff.gitlink_new ?? "（空）").slice(0, 12)}</code>
          （不展开子模块内部 diff）
        </div>
      )}

      {parsed ? (
        <>
          <div className="diff-view">
            <Diff
              viewType={viewType}
              diffType={parsed.type}
              hunks={parsed.hunks}
              tokens={tokens?.tokens}
            >
              {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
            </Diff>
          </div>
          {parsed.hunks.length > 0 && !tokens?.highlighted && diff.language && (
            <p className="diff-note muted">
              未启用语法高亮（语言不在支持列表或变更行数过多），已保留行内差异标记。
            </p>
          )}
        </>
      ) : (
        !diff.binary && !diff.gitlink && !diff.too_large && (
          <p className="muted">该文件没有可显示的文本差异。</p>
        )
      )}
    </section>
  );
}
