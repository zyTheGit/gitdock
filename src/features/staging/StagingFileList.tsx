import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Icon } from "../../assets/icons";
import { useI18n } from "../../i18n";
import {
  buildFileTree,
  collectFiles,
  flattenVisibleTree,
  type FileTreeNode,
  type FileTreeRow,
} from "../../shared/fileTree";
import { STATUS_LETTER, statusLabelKey } from "../../shared/fileStatus";
import type { StagingFileDto } from "../../shared/types";
import { useFileListMode } from "../../shared/useFileListMode";

/** 暂存区列别：未暂存或已暂存。 */
export type Side = "staged" | "unstaged";

/** 勾选状态的键：同一路径可能在两列各自出现，勾选状态按列隔离。 */
export const sideKey = (side: Side, path: string) => `${side}:${path}`;

// 行高初值（12px 文本 + 上下 padding）；文本行高随字体而定，
// 首帧后由 measureElement 按实际渲染高度修正。
const ROW_ESTIMATE = 24;
const LIST_OVERSCAN = 10;

function pathLabel(file: StagingFileDto): string {
  return file.old_path && file.old_path !== file.path
    ? `${file.old_path} → ${file.path}`
    : file.path;
}

interface StagingFileListProps {
  side: Side;
  files: StagingFileDto[];
  /** 当前列选中的文件路径（与另一列的选择互不影响）。 */
  activePath: string | null;
  checked: Record<string, boolean>;
  disabled: boolean;
  onSelect: (file: StagingFileDto, side: Side) => void;
  onToggleCheck: (side: Side, path: string) => void;
  /** 目录行勾选：一次切换该目录下全部文件的勾选状态。 */
  onToggleCheckGroup?: (side: Side, paths: string[], value: boolean) => void;
  onRowAction: (side: Side, path: string) => void;
  /** 文件行右键：由调用方决定菜单项（扁平与目录树两种形态共用）。 */
  onRowContextMenu?: (event: ReactMouseEvent, side: Side, path: string) => void;
}

/** 暂存区单列文件列表：虚拟化渲染，未暂存/已暂存两列各自实例化、独立滚动。 */
export function StagingFileList({
  side,
  files,
  activePath,
  checked,
  disabled,
  onSelect,
  onToggleCheck,
  onToggleCheckGroup,
  onRowAction,
  onRowContextMenu,
}: StagingFileListProps) {
  const { t } = useI18n();
  const [mode] = useFileListMode();
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(() => new Set());
  const tree = useMemo(() => buildFileTree(files), [files]);
  const rows = useMemo<FileTreeRow<StagingFileDto>[]>(() => {
    if (mode === "tree") {
      return flattenVisibleTree(tree, collapsedDirs);
    }
    return files.map((file) => ({
      kind: "file",
      key: `f:${file.path}`,
      path: file.path,
      name: file.path,
      depth: 0,
      item: file,
      dirPath: "",
    }));
  }, [mode, tree, files, collapsedDirs]);

  // 目录路径 → 其下全部文件路径，供目录行三态勾选与整目录暂存使用。
  const dirPaths = useMemo(() => {
    const map = new Map<string, string[]>();
    const walk = (nodes: FileTreeNode<StagingFileDto>[]) => {
      for (const node of nodes) {
        if (node.kind !== "dir") {
          continue;
        }
        map.set(
          node.path,
          collectFiles(node).map((file) => file.path),
        );
        walk(node.children);
      }
    };
    walk(tree);
    return map;
  }, [tree]);

  const toggleDir = (path: string) =>
    setCollapsedDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: LIST_OVERSCAN,
    getItemKey: (index) => rows[index]?.key ?? index,
  });
  const action = side === "unstaged" ? t("staging.actionStage") : t("staging.actionUnstage");

  const fileMeta = (file: StagingFileDto) => {
    if (file.untracked) {
      return <span className="muted">{t("staging.untracked")}</span>;
    }
    if (file.gitlink) {
      return <span className="muted">{t("staging.submodule")}</span>;
    }
    if (file.binary) {
      return <span className="muted">{t("staging.binary")}</span>;
    }
    return (
      <>
        <span className="diff-add">+{file.additions}</span>
        <span className="diff-del">-{file.deletions}</span>
      </>
    );
  };

  const renderDirRow = (row: Extract<FileTreeRow<StagingFileDto>, { kind: "dir" }>) => {
    const paths = dirPaths.get(row.path) ?? [];
    const selected = paths.filter((path) => checked[sideKey(side, path)]);
    const allChecked = paths.length > 0 && selected.length === paths.length;
    const someChecked = selected.length > 0 && !allChecked;
    return (
      <div className="staging-row staging-dir-row" style={{ paddingLeft: 6 + row.depth * 12 }}>
        {onToggleCheckGroup && (
          <input
            className="staging-check"
            type="checkbox"
            checked={allChecked}
            disabled={disabled || paths.length === 0}
            ref={(node) => {
              if (node) {
                node.indeterminate = someChecked;
              }
            }}
            onChange={(event) => onToggleCheckGroup(side, paths, event.target.checked)}
            onClick={(event) => event.stopPropagation()}
            aria-label={t("staging.selectDirFiles", { path: row.path })}
          />
        )}
        <button
          className="staging-dir-toggle"
          aria-expanded={!collapsedDirs.has(row.path)}
          onClick={() => toggleDir(row.path)}
          title={row.path}
        >
          <Icon name="chevronDown" className="file-tree-chevron" />
          <span className="staging-path mono">{row.name}</span>
          <span className="staging-stats muted">{row.fileCount}</span>
        </button>
      </div>
    );
  };

  const renderFileRow = (row: Extract<FileTreeRow<StagingFileDto>, { kind: "file" }>) => {
    const file = row.item;
    const active = activePath === file.path;
    return (
      <div
        className={active ? "staging-row active" : "staging-row"}
        style={mode === "tree" ? { paddingLeft: 6 + row.depth * 12 } : undefined}
        onClick={() => onSelect(file, side)}
        onContextMenu={
          onRowContextMenu ? (event) => onRowContextMenu(event, side, file.path) : undefined
        }
      >
        <input
          className="staging-check"
          type="checkbox"
          checked={Boolean(checked[sideKey(side, file.path)])}
          onChange={() => onToggleCheck(side, file.path)}
          onClick={(event) => event.stopPropagation()}
          aria-label={t("staging.selectFile", { path: file.path })}
        />
        <span
          className={`file-status file-status-${file.status}`}
          title={t(statusLabelKey(file.status))}
        >
          {STATUS_LETTER[file.status]}
        </span>
        <span className="staging-path mono" title={pathLabel(file)}>
          {mode === "tree" ? row.name : pathLabel(file)}
        </span>
        <span className="staging-stats">{fileMeta(file)}</span>
        <button
          className="staging-row-action"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onRowAction(side, file.path);
          }}
        >
          {action}
        </button>
      </div>
    );
  };

  const fileRows = useMemo(
    () =>
      rows.flatMap((row, index) =>
        row.kind === "file" ? [{ index, file: row.item }] : [],
      ),
    [rows],
  );

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (fileRows.length === 0) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "BUTTON")) {
      return;
    }
    const currentPos = activePath
      ? fileRows.findIndex((entry) => entry.file.path === activePath)
      : -1;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const nextPos =
        currentPos < 0
          ? event.key === "ArrowDown"
            ? 0
            : fileRows.length - 1
          : Math.max(0, Math.min(fileRows.length - 1, currentPos + delta));
      const picked = fileRows[nextPos];
      if (picked) {
        onSelect(picked.file, side);
        virtualizer.scrollToIndex(picked.index, { align: "auto" });
      }
      return;
    }
    if (event.key === " " && currentPos >= 0) {
      event.preventDefault();
      onToggleCheck(side, fileRows[currentPos].file.path);
    }
  };

  return (
    <div className="staging-list" ref={scrollRef} tabIndex={0} onKeyDown={onListKeyDown}>
      <ul className="staging-list-inner" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (!row) {
            return null;
          }
          return (
            <li
              key={item.key}
              data-index={item.index}
              ref={(node) => virtualizer.measureElement(node)}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${item.start}px)`,
              }}
            >
              {row.kind === "dir" ? renderDirRow(row) : renderFileRow(row)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
