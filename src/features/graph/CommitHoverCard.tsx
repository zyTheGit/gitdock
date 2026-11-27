import { useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import type { CommitBranchContextDto, CommitSummaryDto } from "../../shared/types";
import { buildBranchPills } from "./branchPills";
import { laneColor } from "./GraphCell";

interface CommitHoverCardProps {
  commit: CommitSummaryDto;
  lane: number;
  x: number;
  y: number;
  context: CommitBranchContextDto | null;
  contextLoading: boolean;
}

/** 极简节点悬浮卡（参考 VSCode Git Graph）：仅展示 Commit Hash、HEAD 归属与所属分支胶囊。 */
export function CommitHoverCard({
  commit,
  lane,
  x,
  y,
  context,
  contextLoading,
}: CommitHoverCardProps) {
  const { t } = useI18n();
  const cardRef = useRef<HTMLDivElement>(null);
  const width = 340;
  const left = Math.max(8, Math.min(x + 16, window.innerWidth - width - 12));
  const [top, setTop] = useState(() => Math.max(8, Math.min(y + 12, window.innerHeight - 140)));

  useLayoutEffect(() => {
    const height = cardRef.current?.offsetHeight ?? 0;
    setTop(Math.max(8, Math.min(y + 12, window.innerHeight - height - 12)));
  }, [y, context, contextLoading]);

  const headLabel = context?.current_branch ?? "HEAD";
  const pillGroup = context
    ? buildBranchPills(context.branches, context.remote_branches, 8)
    : null;

  return (
    <div
      ref={cardRef}
      className="commit-hover-card"
      style={{ left, top, width, borderColor: laneColor(lane) }}
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
                    <span>{pill.name}</span>
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
  );
}
