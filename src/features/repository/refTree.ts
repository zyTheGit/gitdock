import type { RefDto } from "../../shared/types";

/**
 * 引用列表的过滤与目录树构建（纯函数）。
 *
 * 侧栏、搜索过滤都只消费这里的结果：输入顺序即输出顺序，不重新按字母排序，
 * 这样标签「最新优先」等上层已有排序不会被树构建打乱。
 */

/** 引用叶子：label 是短名去掉已折叠目录后的最后一段。 */
export interface RefTreeLeaf {
  type: "ref";
  /** 稳定 key：引用 full_name，避免同名本地分支/标签冲突。 */
  key: string;
  label: string;
  ref: RefDto;
}

/** 目录分组：按 `/` 切分的中间层级，单子目录链已合并（如 `feature/ui`）。 */
export interface RefTreeGroup {
  type: "group";
  /** 完整目录路径，同时作为折叠状态 id。 */
  key: string;
  label: string;
  children: RefTreeNode[];
}

export type RefTreeNode = RefTreeLeaf | RefTreeGroup;

interface Entry {
  segments: string[];
  ref: RefDto;
}

/** 关键词匹配短名与描述；空关键词返回原数组（保持引用不变，便于 useMemo 短路）。 */
export function filterRefs(refs: RefDto[], keyword: string): RefDto[] {
  const needle = keyword.trim().toLowerCase();
  if (!needle) {
    return refs;
  }
  return refs.filter(
    (ref) =>
      ref.short_name.toLowerCase().includes(needle) ||
      (ref.description ?? "").toLowerCase().includes(needle),
  );
}

/** 把引用按 `/` 构造成可折叠目录树；无 `/` 的引用保持为顶层叶子。 */
export function buildRefTree(refs: RefDto[]): RefTreeNode[] {
  return buildLevel(
    refs.map((ref) => ({
      segments: ref.short_name.split("/").filter(Boolean),
      ref,
    })),
    "",
  );
}

function buildLevel(entries: Entry[], prefix: string): RefTreeNode[] {
  const groupHeads = new Set(
    entries.filter((entry) => entry.segments.length > 1).map((entry) => entry.segments[0]),
  );
  const nodes: RefTreeNode[] = [];
  const groups = new Map<string, { node: RefTreeGroup; entries: Entry[] }>();

  for (const entry of entries) {
    const segments =
      entry.segments.length > 0 ? entry.segments : [entry.ref.short_name];
    const [head, ...rest] = segments;
    if (rest.length > 0) {
      let group = groups.get(head);
      if (!group) {
        const path = prefix ? `${prefix}/${head}` : head;
        group = {
          node: { type: "group", key: path, label: head, children: [] },
          entries: [],
        };
        groups.set(head, group);
        nodes.push(group.node);
      }
      group.entries.push({ segments: rest, ref: entry.ref });
      continue;
    }
    if (groupHeads.has(head)) {
      // 同名引用与目录并存（例如分支 a 与 a/b）：引用收进目录，避免两个同名节点。
      groups.get(head)!.entries.push({ segments: [], ref: entry.ref });
      continue;
    }
    nodes.push({
      type: "ref",
      key: entry.ref.full_name,
      label: head,
      ref: entry.ref,
    });
  }

  for (const group of groups.values()) {
    group.node.children = collapseSingleGroupChain(
      buildLevel(group.entries, group.node.key),
    );
  }
  return collapseSingleGroupChain(nodes);
}

/** 合并只有单个子目录的分组（`feature` → `ui` 显示为 `feature/ui`），减少无意义缩进。 */
function collapseSingleGroupChain(nodes: RefTreeNode[]): RefTreeNode[] {
  return nodes.map((node) => {
    if (node.type === "ref") {
      return node;
    }
    let group = node;
    while (group.children.length === 1) {
      const only = group.children[0];
      if (only.type !== "group") {
        break;
      }
      group = {
        type: "group",
        key: only.key,
        label: `${group.label}/${only.label}`,
        children: only.children,
      };
    }
    return { ...group, children: collapseSingleGroupChain(group.children) };
  });
}

/** 分组下可见引用数，用于分组标题的计数徽标。 */
export function countRefLeaves(nodes: RefTreeNode[]): number {
  return nodes.reduce(
    (total, node) =>
      total + (node.type === "ref" ? 1 : countRefLeaves(node.children)),
    0,
  );
}
