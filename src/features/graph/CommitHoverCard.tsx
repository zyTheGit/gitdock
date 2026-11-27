import { useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import type { CommitBranchContextDto, CommitSummaryDto } from "../../shared/types";
import { buildBranchPills } from "./branchPills";
import { laneColor } from "./GraphCell";

const NODE_RADIUS = 6;
const CONNECTOR_LENGTH = 22;

interface CommitHoverCardProps {
  commit: CommitSummaryDto;
  lane: number;
  anchorX: number;
  anchorY: number;
  context: CommitBranchContextDto | null;
  contextLoading: boolean;
}

/**
 * 极简节点悬浮卡（参考 VSCode Git Graph）：
 * 与节点圆点水平居中对齐，中间以泳道色细线连接，无过渡动画。
 */
export function CommitHoverCard({
  commit,
  lane,
  anchorX,
  anchorY,
  context,
  contextLoading,
}: CommitHoverCardProps) {
  const { t } = useI18n();
  const cardRef = useRef<HTMLDivElement>(null);
  const color = laneColor(lane);

  const idealLeft = Math.round(anchorX + NODE_RADIUS + CONNECTOR_LENGTH);
  const [pos, setPos] = useState<{ left: number; top: number; height: number; ready: boolean }>(
    () => ({
      left: idealLeft,
      top: Math.max(8, Math.round(anchorY - 54)),
      height: 108,
      ready: false,
    }),
  );

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const clampedLeft = Math.max(8, Math.min(idealLeft, window.innerWidth - rect.width - 12));
    const clampedTop = Math.max(
      8,
      Math.min(Math.round(anchorY - rect.height / 2), window.innerHeight - rect.height - 8),
    );
    setPos({ left: clampedLeft, top: clampedTop, height: rect.height, ready: true });
  }, [idealLeft, anchorY, context, contextLoading]);

  const headLabel = context?.current_branch ?? "HEAD";
  const pillGroup = context
    ? buildBranchPills(context.branches, context.remote_branches, 8)
    : null;

  const connectorStart = Math.round(anchorX + NODE_RADIUS);
  const connectorWidth = Math.max(0, pos.left - connectorStart);
  const showConnector =
    pos.ready &&
    connectorWidth > 2 &&
    anchorY >= pos.top + 4 &&
    anchorY <= pos.top + pos.height - 4;

  return (
    <>
      {showConnector && (
        <div
          className="commit-hover-connector"
          style={{
            left: connectorStart,
            top: Math.round(anchorY - 1),
            width: connectorWidth,
            backgroundColor: color,
          }}
          aria-hidden="true"
        />
      )}
      <div
        ref={cardRef}
        className="commit-hover-card"
        style={{
          left: pos.left,
          top: pos.top,
          borderColor: color,
          visibility: pos.ready ? "visible" : "hidden",
        }}
        role="tooltip"
      >
        <div className="hover-head mono">{t("graph.hoverCommitHeader", { oid: commit.short_oid })}</div>
        {contextLoading && <p className="hover-status muted">{t("graph.hoverContextLoading")}</p>}
        {context && (
          <div className="hover-body">
            <div className="hover-line">
              <span>
                {context.included_in_head
                  ? t("graph.hoverIncludedIn")
                  : t("graph.hoverNotIncludedIn")}
              </span>
              <span className={context.included_in_head ? "hover-pill" : "hover-pill warn"}>
                {headLabel}
              </span>
            </div>
            <div className="hover-line hover-pills-line">
              <span className="hover-label">{t("graph.hoverBranchesLabel")}</span>
              {pillGroup && pillGroup.pills.length > 0 ? (
                <span className="hover-pills">
                  {pillGroup.pills.map((pill) => (
                    <span className="hover-pill" key={pill.key}>
                      <span className="hover-pill-name">{pill.name}</span>
                      {pill.remotes.map((remote) => (
                        <span className="hover-pill-remote" key={remote}>
                          {remote}
                        </span>
                      ))}
                    </span>
                  ))}
                  {pillGroup.omitted > 0 && (
                    <span className="hover-pill muted">+{pillGroup.omitted}</span>
                  )}
                </span>
              ) : (
                <span className="muted">{t("graph.hoverNoBranches")}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
