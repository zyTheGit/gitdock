import { useMemo, useRef, type ReactNode } from "react";
import type { HunkData, HunkTokens, TokenNode } from "react-diff-view";

// 放大视图的并排 diff：左右两栏各自横向滚动，纵向滚动互相同步。
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
  const syncing = useRef<"left" | "right" | null>(null);

  const onScroll = (source: "left" | "right") => {
    if (syncing.current !== null && syncing.current !== source) {
      return;
    }
    const from = source === "left" ? leftRef.current : rightRef.current;
    const to = source === "left" ? rightRef.current : leftRef.current;
    if (!from || !to) {
      return;
    }
    syncing.current = source;
    to.scrollTop = from.scrollTop;
    requestAnimationFrame(() => {
      syncing.current = null;
    });
  };

  return (
    <div className="split-panes">
      <div className="split-pane" ref={leftRef} onScroll={() => onScroll("left")}>
        {paneRows(rows.left)}
      </div>
      <div className="split-pane right" ref={rightRef} onScroll={() => onScroll("right")}>
        {paneRows(rows.right)}
      </div>
    </div>
  );
}
