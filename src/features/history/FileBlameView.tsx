import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ThemedToken } from "shiki";
import { useI18n } from "../../i18n";
import { formatDate } from "../../shared/format";
import { useResolvedTheme } from "../../shared/theme";
import { useIpcResource } from "../../shared/useIpcResource";
import { styleClass } from "../diff/highlightShiki";
import { blameTones, buildBlameTokens } from "./blameTokens";
import { useFileBlame } from "./useFileHistory";

// 固定行高：代码行不换行（超长行横向滚动），行数上万时也只挂载可视行。
const ROW_HEIGHT = 24;
const OVERSCAN = 16;

function codeSpans(tokens: ThemedToken[] | undefined, text: string) {
  if (!tokens || tokens.length === 0) {
    return text;
  }
  return tokens.map((token, index) => {
    const className = styleClass(token);
    return className ? (
      <span key={index} className={className}>
        {token.content}
      </span>
    ) : (
      <span key={index}>{token.content}</span>
    );
  });
}

interface FileBlameViewProps {
  path: string;
  oid: string;
  generation: number;
  /** 点击短哈希：关闭对话框并在图谱中定位该提交。 */
  onLocate: (oid: string) => void;
}

/** 行级追溯：左侧分组色 + 作者/日期/短哈希，右侧 Shiki 高亮代码。 */
export function FileBlameView({ path, oid, generation, onLocate }: FileBlameViewProps) {
  const { t } = useI18n();
  const theme = useResolvedTheme();
  const blame = useFileBlame(path, oid, generation);
  const data = blame.data;
  const lines = useMemo(() => data?.lines ?? [], [data]);
  const contents = useMemo(() => lines.map((line) => line.content), [lines]);
  const tones = useMemo(() => blameTones(lines), [lines]);
  const tokens = useIpcResource(
    [contents, data?.language, theme],
    () => buildBlameTokens(contents, data!.language, theme),
    { enabled: lines.length > 0 },
  ).data;

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    getItemKey: (index) => `${lines[index]?.line_no ?? index}`,
  });

  if (blame.loading) {
    return <p className="muted history-placeholder">{t("history.loadingBlame")}</p>;
  }
  if (blame.error) {
    return <div className="banner danger compact">{blame.error}</div>;
  }
  if (!data) {
    return null;
  }
  if (data.binary) {
    return <p className="muted history-placeholder">{t("history.blameBinary")}</p>;
  }
  if (data.too_large) {
    return <p className="muted history-placeholder">{t("history.blameTooLarge")}</p>;
  }
  if (lines.length === 0) {
    return <p className="muted history-placeholder">{t("history.blameEmpty")}</p>;
  }

  return (
    <div className="file-blame">
      {data.encoding_fallback && (
        <div className="banner info compact">{t("history.blameEncoding")}</div>
      )}
      <div className="file-blame-scroll" ref={scrollRef}>
        <div className="file-blame-inner" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const line = lines[item.index];
            if (!line) {
              return null;
            }
            const groupStart = item.index === 0 || lines[item.index - 1].oid !== line.oid;
            return (
              <div
                key={item.key}
                className={[
                  "history-blame-row",
                  `blame-tone-${tones[item.index]}`,
                  groupStart ? "group-start" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
              >
                <span className="history-blame-gutter">
                  {groupStart && (
                    <>
                      <button
                        type="button"
                        className="history-blame-hash mono"
                        title={t("history.blameJumpTitle", { oid: line.oid })}
                        onClick={() => onLocate(line.oid)}
                      >
                        {line.short_oid}
                      </button>
                      <span className="history-blame-author" title={line.author_name}>
                        {line.author_name}
                      </span>
                      <span className="history-blame-date muted mono">
                        {formatDate(line.authored_at)}
                      </span>
                    </>
                  )}
                </span>
                <span className="history-blame-no mono muted">{line.line_no}</span>
                <span className="history-blame-code mono">
                  {codeSpans(tokens?.[item.index], line.content)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
