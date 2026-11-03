export interface DiffChangeLike {
  type: string;
  content: string;
  /** normal 变更使用 oldLineNumber/newLineNumber；insert/delete 使用 lineNumber。 */
  lineNumber?: number;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffHunkLike {
  changes: DiffChangeLike[];
}

export type MarkRange = [start: number, end: number];

export interface SideLine {
  line: number;
  text: string;
}

function oldLineOf(change: DiffChangeLike): number | undefined {
  if (change.type === "normal") {
    return change.oldLineNumber;
  }
  return change.type === "delete" ? change.lineNumber : undefined;
}

function newLineOf(change: DiffChangeLike): number | undefined {
  if (change.type === "normal") {
    return change.newLineNumber;
  }
  return change.type === "insert" ? change.lineNumber : undefined;
}

function addMark(map: Map<number, MarkRange[]>, line: number | undefined, range: MarkRange) {
  if (!line) {
    return;
  }
  const list = map.get(line);
  if (list) {
    list.push(range);
  } else {
    map.set(line, [range]);
  }
}

/** 对相邻的删除/新增行做字符级公共前后缀裁剪，得到行内 diff 标记。 */
export function collectMarks(hunks: DiffHunkLike[]): { old: Map<number, MarkRange[]>; new: Map<number, MarkRange[]> } {
  const marks = { old: new Map<number, MarkRange[]>(), new: new Map<number, MarkRange[]>() };
  for (const hunk of hunks) {
    const changes = hunk.changes;
    let index = 0;
    while (index < changes.length) {
      if (changes[index].type !== "delete") {
        index += 1;
        continue;
      }
      const deletes: DiffChangeLike[] = [];
      while (index < changes.length && changes[index].type === "delete") {
        deletes.push(changes[index]);
        index += 1;
      }
      const inserts: DiffChangeLike[] = [];
      while (index < changes.length && changes[index].type === "insert") {
        inserts.push(changes[index]);
        index += 1;
      }
      const pairs = Math.min(deletes.length, inserts.length);
      for (let i = 0; i < pairs; i += 1) {
        const oldText = deletes[i].content;
        const newText = inserts[i].content;
        const max = Math.min(oldText.length, newText.length);
        let prefix = 0;
        while (prefix < max && oldText[prefix] === newText[prefix]) {
          prefix += 1;
        }
        let suffix = 0;
        while (
          suffix < max - prefix &&
          oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
        ) {
          suffix += 1;
        }
        if (oldText.length - prefix - suffix > 0) {
          addMark(marks.old, oldLineOf(deletes[i]), [prefix, oldText.length - suffix]);
        }
        if (newText.length - prefix - suffix > 0) {
          addMark(marks.new, newLineOf(inserts[i]), [prefix, newText.length - suffix]);
        }
      }
    }
  }
  return marks;
}

/** 按 side 收集参与高亮的行（上下文行两侧都有）。 */
export function collectSide(hunks: DiffHunkLike[], side: "old" | "new"): SideLine[] {
  const lines: SideLine[] = [];
  for (const hunk of hunks) {
    for (const change of hunk.changes) {
      const isContext = change.type === "normal";
      if (side === "old" && (isContext || change.type === "delete")) {
        const line = oldLineOf(change);
        if (line) {
          lines.push({ line, text: change.content });
        }
      }
      if (side === "new" && (isContext || change.type === "insert")) {
        const line = newLineOf(change);
        if (line) {
          lines.push({ line, text: change.content });
        }
      }
    }
  }
  return lines;
}
