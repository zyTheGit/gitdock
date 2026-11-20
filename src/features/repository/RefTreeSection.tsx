import type { MouseEvent, ReactNode } from "react";
import { useMemo } from "react";
import { Icon, type IconName } from "../../assets/icons";
import type { RefDto } from "../../shared/types";
import { buildRefTree, countRefLeaves, type RefTreeNode } from "./refTree";

interface RefTreeSectionProps {
  /** 折叠状态 id 前缀：同一目录名出现在不同分组里不会互相影响。 */
  sectionKey: string;
  title: string;
  /** 分组图标：本地分支 / 远程分支 / 标签一眼区分。 */
  icon?: IconName;
  /** 已按业务顺序排好并过滤过的引用。 */
  refs: RefDto[];
  emptyText: string;
  /** 分组标题行的附加动作（新建分支、对比…）。 */
  actions?: ReactNode;
  isCollapsed: (id: string) => boolean;
  onToggleCollapse: (id: string) => void;
  onActivate: (ref: RefDto) => void;
  /** 仅本地分支提供：双击切换分支。 */
  onActivateDouble?: (ref: RefDto) => void;
  onMenu: (event: MouseEvent, ref: RefDto) => void;
  /** 行尾徽标（当前 HEAD 等）；返回空则不渲染。 */
  badge?: (ref: RefDto) => string | null;
  /** 行尾紧凑标记（本地分支的 ↑领先 ↓落后）；title 作为悬浮说明与 aria-label。 */
  meta?: (ref: RefDto) => { text: string; title: string } | null;
}

interface TreeListProps extends Omit<RefTreeSectionProps, "title" | "icon" | "emptyText" | "actions" | "refs"> {
  nodes: RefTreeNode[];
  depth: number;
}

/** 层级缩进：目录行的三角 12px + 间距 5px 决定叶子行的基准内边距，使同层目录标题与叶子左对齐。 */
const INDENT_STEP = 12;
const GROUP_BASE_PAD = 6;
const LEAF_BASE_PAD = GROUP_BASE_PAD + 12 + 5;

function TreeList({ nodes, depth, sectionKey, isCollapsed, onToggleCollapse, onActivate, onActivateDouble, onMenu, badge, meta }: TreeListProps) {
  return (
    <>
      {nodes.map((node) => {
        if (node.type === "group") {
          const id = `${sectionKey}/${node.key}`;
          const collapsed = isCollapsed(id);
          return (
            <li key={`group:${node.key}`} className="ref-tree-group">
              <button
                className="ref-toggle ref-group-toggle"
                style={{ paddingLeft: GROUP_BASE_PAD + depth * INDENT_STEP }}
                aria-expanded={!collapsed}
                onClick={() => onToggleCollapse(id)}
              >
                <span className="ref-caret" aria-hidden="true">{collapsed ? "▶" : "▼"}</span>
                <span className="ref-group-label" title={node.key}>{node.label}</span>
                <span className="ref-count muted">{countRefLeaves(node.children)}</span>
              </button>
              {!collapsed && (
                <ul className="ref-tree">
                  <TreeList
                    nodes={node.children}
                    depth={depth + 1}
                    sectionKey={sectionKey}
                    isCollapsed={isCollapsed}
                    onToggleCollapse={onToggleCollapse}
                    onActivate={onActivate}
                    onActivateDouble={onActivateDouble}
                    onMenu={onMenu}
                    badge={badge}
                    meta={meta}
                  />
                </ul>
              )}
            </li>
          );
        }
        const { ref } = node;
        const text = ref.description ? `${ref.short_name} — ${ref.description}` : ref.short_name;
        const mark = badge?.(ref);
        const metaInfo = meta?.(ref);
        return (
          <li key={`ref:${node.key}`}>
            <button
              className={ref.is_head ? "branch-item active" : "branch-item"}
              style={{ paddingLeft: LEAF_BASE_PAD + depth * INDENT_STEP }}
              title={text}
              onClick={() => onActivate(ref)}
              onDoubleClick={onActivateDouble ? () => onActivateDouble(ref) : undefined}
              onContextMenu={(event) => {
                event.preventDefault();
                onMenu(event, ref);
              }}
            >
              <span className="branch-text">
                <span className="branch-name">{node.label}</span>
                {ref.description && <span className="branch-desc">{ref.description}</span>}
              </span>
              {(mark || metaInfo) && (
                <span className="ref-trailing">
                  {metaInfo && (
                    <span className="ref-sync" title={metaInfo.title} aria-label={metaInfo.title}>
                      {metaInfo.text}
                    </span>
                  )}
                  {mark && <span className="tag">{mark}</span>}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </>
  );
}

/** 通用引用分组：标题可折叠 + 按 `/` 目录折叠的引用列表。 */
export function RefTreeSection({
  sectionKey,
  title,
  icon,
  refs,
  emptyText,
  actions,
  isCollapsed,
  onToggleCollapse,
  onActivate,
  onActivateDouble,
  onMenu,
  badge,
  meta,
}: RefTreeSectionProps) {
  const nodes = useMemo(() => buildRefTree(refs), [refs]);
  const sectionId = `section:${sectionKey}`;
  const collapsed = isCollapsed(sectionId);
  return (
    <section className="ref-section">
      <div className="ref-section-head">
        <button
          className="ref-toggle ref-section-toggle"
          aria-expanded={!collapsed}
          onClick={() => onToggleCollapse(sectionId)}
        >
          <span className="ref-caret" aria-hidden="true">{collapsed ? "▶" : "▼"}</span>
          {icon && <Icon name={icon} className="ref-section-icon" />}
          <span className="ref-section-title">{title}</span>
          <span className="ref-count muted">{refs.length}</span>
        </button>
      </div>
      {actions && <div className="ref-section-actions">{actions}</div>}
      {!collapsed &&
        (refs.length === 0 ? (
          <p className="muted ref-empty">{emptyText}</p>
        ) : (
          <ul className="ref-tree">
            <TreeList
              nodes={nodes}
              depth={0}
              sectionKey={sectionKey}
              isCollapsed={isCollapsed}
              onToggleCollapse={onToggleCollapse}
              onActivate={onActivate}
              onActivateDouble={onActivateDouble}
              onMenu={onMenu}
              badge={badge}
              meta={meta}
            />
          </ul>
        ))}
    </section>
  );
}
