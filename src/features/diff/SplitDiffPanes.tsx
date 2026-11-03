import { useMemo, useRef, type ReactNode } from "react";
import type { HunkData, HunkTokens, TokenNode } from "react-diff-view";

// 并排 diff：左右两栏等宽，纵向与横向滚动均互相同步。
// react-diff-view 的表格只能整体横向滚动，长行会把另一侧一起推出视野。

interface SplitDiffPanesProps {
  hunks: HunkData[];
  tokens: HunkTokens | null;
}

type LineKind = "normal" | "insert" | "delete" | "empty";

interface SideLine {
  kind: LineKind;
  line?: number;
  nodes?: TokenNode[];
}

type SideRow = { header: string } | { line: SideLine };

interface Rows {
  left: SideRow[];
  right: SideRow[];
}

function lineRow(kind: LineKind, line: number | undefined, tokens: TokenNode[] | undefined): SideRow {
  return { line: { kind, line, nodes: tokens } };
}

function emptyRow(): SideRow {
  return { line: { kind: "empty" } };
}

export function buildRows(hunks: HunkData[], tokens: HunkTokens | null): Rows {
  const left: SideRow[] = [];
  const right: SideRow[] = [];
  for (const hunk of hunks) {
    left.push({ header: hunk.content });
    right.push({ header: hunk.content });
    const changes = hunk.changes;
    let index = 0;
    while (index < changes.length) {
      const change = changes[index];
      if (change.type === "normal") {
        left.push(lineRow("normal", change.oldLineNumber, tokens?.old[change.oldLineNumber - 1]));
        right.push(lineRow("normal", change.newLineNumber, tokens?.new[change.newLineNumber - 1]));
        index += 1;
        continue;
      }
      const deletes: number[] = [];
      const inserts: number[] = [];
      let cursor = changes[index];
      while (cursor?.type === "delete") {
        deletes.push(cursor.lineNumber);
        index += 1;
        cursor = changes[index];
      }
      while (cursor?.type === "insert") {
        inserts.push(cursor.lineNumber);
        index += 1;
        cursor = changes[index];
      }
      const paired = Math.min(deletes.length, inserts.length);
      for (let i = 0; i < paired; i += 1) {
        const oldLine = deletes[i];
        const newLine = inserts[i];
        left.push(lineRow("delete", oldLine, tokens?.old[oldLine - 1]));
        right.push(lineRow("insert", newLine, tokens?.new[newLine - 1]));
      }
      for (let i = paired; i < deletes.length; i += 1) {
        const oldLine = deletes[i];
        left.push(lineRow("delete", oldLine, tokens?.old[oldLine - 1]));
        right.push(emptyRow());
      }
      for (let i = paired; i < inserts.length; i += 1) {
        const newLine = inserts[i];
        left.push(emptyRow());
        right.push(lineRow("insert", newLine, tokens?.new[newLine - 1]));
      }
    }
  }
  return { left, right };
}

function renderNodes(nodes: TokenNode[] | undefined): ReactNode {
  if (!nodes || nodes.length === 0) {
    return null;
  }
  return nodes.map((node, index) => {
    if (node.type === "text") {
      return <span key={index}>{String(node.value ?? "")}</span>;
    }
    if (node.type === "code") {
      return (
        <span key={index} className={String(node.className ?? "")}>
          {String(node.value ?? "")}
        </span>
      );
    }
    if (node.type === "edit") {
      return (
        <span key={index} className="diff-code-edit">
          {renderNodes(node.children)}
        </span>
      );
    }
    return null;
  });
}

function paneRows(rows: SideRow[]) {
  return rows.map((row, index) =>
    "header" in row ? (
      <div key={index} className="split-hunk">
        {row.header}
      </div>
    ) : (
      <div key={index} className={`split-line ${row.line.kind}`}>
        <span className={`split-gutter ${row.line.kind}`}>{row.line.line ?? ""}</span>
        <span className="split-code">{renderNodes(row.line.nodes)}</span>
      </div>
    ),
  );
}

export function SplitDiffPanes({ hunks, tokens }: SplitDiffPanesProps) {
  const rows = useMemo(() => buildRows(hunks, tokens), [hunks, tokens]);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  // 记录最近一次同步写入的值，用于识别由此触发的滚动事件，避免两栏回弹。
  const written = useRef<{ pane: "left" | "right"; top: number; left: number; at: number } | null>(
    null,
  );

  const onScroll = (source: "left" | "right") => {
    const from = source === "left" ? leftRef.current : rightRef.current;
    const to = source === "left" ? rightRef.current : leftRef.current;
    if (!from || !to) {
      return;
    }
    const pending = written.current;
    const echo =
      pending !== null &&
      pending.pane === source &&
      pending.top === from.scrollTop &&
      pending.left === from.scrollLeft &&
      performance.now() - pending.at < 250;
    if (echo) {
      written.current = null;
      return;
    }
    to.scrollTop = from.scrollTop;
    // 两侧内容宽度不同时，超出目标栏滚动范围的值会被浏览器截断；
    // 滚动较宽的一栏时保持原值，不被较窄一栏截断后的回传事件拽回。
    to.scrollLeft = from.scrollLeft;
    written.current = {
      pane: to === rightRef.current ? "right" : "left",
      top: to.scrollTop,
      left: to.scrollLeft,
      at: performance.now(),
    };
  };

  return (
    <div className="split-panes">
      <div className="split-pane" ref={leftRef} onScroll={() => onScroll("left")}>
        {paneRows(rows.left)}
      </div>
      {/* 分隔线独立成列：行号槽位是不透明的 sticky 元素，画在内阴影上会被逐行盖掉。 */}
      <div className="split-divider" aria-hidden="true" />
      <div className="split-pane" ref={rightRef} onScroll={() => onScroll("right")}>
        {paneRows(rows.right)}
      </div>
    </div>
  );
}
