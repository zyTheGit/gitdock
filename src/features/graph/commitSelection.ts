export interface CommitSelectionState {
  oids: string[];
  anchor: string | null;
}

export interface ToggleCommitOptions {
  /** 是否在从空选择起步时把已有普通点击锚点一起纳入（Alt/Option+点击语义）。 */
  includeAnchor?: boolean;
}

/**
 * 切换单个提交的批量选中状态；保留用户点选顺序并同步更新锚点。
 */
export function toggleCommitSelection(
  state: CommitSelectionState,
  oid: string,
  orderedOids: string[],
  options?: ToggleCommitOptions,
): CommitSelectionState {
  if (state.oids.includes(oid)) {
    const nextOids = state.oids.filter((item) => item !== oid);
    const nextAnchor =
      state.anchor === oid ? (nextOids[nextOids.length - 1] ?? null) : state.anchor;
    return { oids: nextOids, anchor: nextAnchor };
  }
  if (
    options?.includeAnchor &&
    state.oids.length === 0 &&
    state.anchor &&
    state.anchor !== oid &&
    orderedOids.includes(state.anchor)
  ) {
    return { oids: [state.anchor, oid], anchor: oid };
  }
  return { oids: [...state.oids, oid], anchor: oid };
}

/**
 * 按当前视图顺序选择锚点到目标提交的连续区间，并与已选提交去重合并。
 */
export function selectCommitRange(
  state: CommitSelectionState,
  oid: string,
  orderedOids: string[],
): CommitSelectionState {
  const target = orderedOids.indexOf(oid);
  if (target < 0) {
    return state;
  }
  const anchor = state.anchor;
  const start = anchor ? orderedOids.indexOf(anchor) : -1;
  if (start < 0) {
    return {
      oids: state.oids.includes(oid) ? state.oids : [...state.oids, oid],
      anchor: oid,
    };
  }
  const from = Math.min(start, target);
  const to = Math.max(start, target);
  const range = orderedOids.slice(from, to + 1);
  const orderedRange = start <= target ? range : [...range].reverse();
  const merged = [...state.oids];
  for (const item of orderedRange) {
    if (!merged.includes(item)) {
      merged.push(item);
    }
  }
  return { oids: merged, anchor };
}
