/**
 * 文件树构造：纯函数，不访问 DOM / 文件系统。输入任意带 `path` 的条目，
 * 输出目录树与「可视扁平行」，后者携带 depth 缩进层级，直接喂给
 * @tanstack/react-virtual 渲染，避免递归生成大量嵌套 DOM。
 */

export interface FileTreeItem {
  path: string;
}

export interface FileTreeFile<T extends FileTreeItem> {
  kind: "file";
  /** 完整路径，作为稳定 key。 */
  path: string;
  /** 文件名（basename），树模式下只展示这一段。 */
  name: string;
  item: T;
}

export interface FileTreeDir<T extends FileTreeItem> {
  kind: "dir";
  /** 压缩后目录的完整路径（单子目录已并入，如 `src/features/compare`）。 */
  path: string;
  /** 展示名，压缩链用 `/` 连接。 */
  name: string;
  /** 该目录下（含全部子目录）的文件总数。 */
  fileCount: number;
  children: FileTreeNode<T>[];
}

export type FileTreeNode<T extends FileTreeItem> = FileTreeDir<T> | FileTreeFile<T>;

export interface DirRow {
  kind: "dir";
  key: string;
  path: string;
  name: string;
  depth: number;
  fileCount: number;
}

export interface FileRow<T extends FileTreeItem> {
  kind: "file";
  key: string;
  path: string;
  name: string;
  depth: number;
  item: T;
  /** 直接父目录路径；暂存区据此做目录级勾选。 */
  dirPath: string;
}

export type FileTreeRow<T extends FileTreeItem> = DirRow | FileRow<T>;

interface RawDir<T extends FileTreeItem> {
  dirs: Map<string, RawDir<T>>;
  files: { item: T; name: string }[];
}

function emptyRaw<T extends FileTreeItem>(): RawDir<T> {
  return { dirs: new Map(), files: [] };
}

const compareNames = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

/**
 * 构造目录树：目录优先、同层字典序；单子目录链压缩为一行（VS Code compact
 * folders 风格，例如 `src/features/compare`）。
 */
export function buildFileTree<T extends FileTreeItem>(items: readonly T[]): FileTreeDir<T>[] {
  const root = emptyRaw<T>();
  for (const item of items) {
    const segments = item.path.split("/").filter(Boolean);
    const name = segments.pop();
    if (!name) {
      continue;
    }
    let cursor = root;
    for (const segment of segments) {
      let next = cursor.dirs.get(segment);
      if (!next) {
        next = emptyRaw<T>();
        cursor.dirs.set(segment, next);
      }
      cursor = next;
    }
    cursor.files.push({ item, name });
  }

  const toNodes = (raw: RawDir<T>, parentPath: string): FileTreeNode<T>[] => {
    const dirNodes = [...raw.dirs.entries()]
      .sort(([a], [b]) => compareNames(a, b))
      .map(([name, child]) => makeDir(joinPath(parentPath, name), name, child));
    const fileNodes: FileTreeFile<T>[] = raw.files
      .slice()
      .sort((a, b) => compareNames(a.name, b.name))
      .map((file) => ({
        kind: "file",
        path: joinPath(parentPath, file.name),
        name: file.name,
        item: file.item,
      }));
    return [...dirNodes, ...fileNodes];
  };

  const makeDir = (path: string, name: string, raw: RawDir<T>): FileTreeDir<T> => {
    const node: FileTreeDir<T> = {
      kind: "dir",
      path,
      name,
      fileCount: 0,
      children: toNodes(raw, path),
    };
    // 单子目录压缩：子目录的展示名并入当前节点，路径取最深层目录。
    while (node.children.length === 1 && node.children[0].kind === "dir") {
      const only = node.children[0];
      node.path = only.path;
      node.name = `${node.name}/${only.name}`;
      node.children = only.children;
    }
    node.fileCount = countFiles(node);
    return node;
  };

  return toNodes(root, "").filter((node): node is FileTreeDir<T> => node.kind === "dir");
}

/** 目录（含全部子目录）下的文件总数。 */
export function countFiles<T extends FileTreeItem>(node: FileTreeDir<T>): number {
  let total = 0;
  for (const child of node.children) {
    total += child.kind === "dir" ? countFiles(child) : 1;
  }
  return total;
}

/** 收集目录下全部条目（保持树内顺序），供目录级批量操作使用。 */
export function collectFiles<T extends FileTreeItem>(node: FileTreeDir<T>): T[] {
  const out: T[] = [];
  const walk = (children: FileTreeNode<T>[]) => {
    for (const child of children) {
      if (child.kind === "file") {
        out.push(child.item);
      } else {
        walk(child.children);
      }
    }
  };
  walk(node.children);
  return out;
}

/**
 * 拍平为可视行：折叠目录的子树整段跳过，行顺序与树的前序遍历一致。
 * 返回数组只含扁平行（不递归渲染），由虚拟滚动按需挂载 DOM。
 */
export function flattenVisibleTree<T extends FileTreeItem>(
  nodes: readonly FileTreeNode<T>[],
  collapsedDirs: ReadonlySet<string>,
): FileTreeRow<T>[] {
  const rows: FileTreeRow<T>[] = [];
  const walk = (children: readonly FileTreeNode<T>[], depth: number, dirPath: string) => {
    for (const node of children) {
      if (node.kind === "file") {
        rows.push({
          kind: "file",
          key: `f:${node.path}`,
          path: node.path,
          name: node.name,
          depth,
          item: node.item,
          dirPath,
        });
        continue;
      }
      rows.push({
        kind: "dir",
        key: `d:${node.path}`,
        path: node.path,
        name: node.name,
        depth,
        fileCount: node.fileCount,
      });
      if (!collapsedDirs.has(node.path)) {
        walk(node.children, depth + 1, node.path);
      }
    }
  };
  walk(nodes, 0, "");
  return rows;
}
