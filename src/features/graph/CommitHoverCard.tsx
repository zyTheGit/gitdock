import { useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { formatDate } from "../../shared/format";
import type { CommitBranchContextDto, CommitSummaryDto, RefBadgeDto } from "../../shared/types";

type Translate = ReturnType<typeof useI18n>["t"];

function refLabel(ref: RefBadgeDto, t: Translate): string {
  const name = ref.is_head ? t("graph.refHeadMark", { name: ref.name }) : ref.name;
  return ref.description ? `${name} — ${ref.description}` : name;
}

interface CommitHoverCardProps {
  commit: CommitSummaryDto;
  x: number;
  y: number;
  context: CommitBranchContextDto | null;
  contextLoading: boolean;
}

/** 悬浮卡：参考 Git Graph，在不点击的情况下给出提交的完整元信息与分支差异。 */
export function CommitHoverCard({
  commit,
  x,
  y,
  context,
  contextLoading,
}: CommitHoverCardProps) {
  const { t } = useI18n();
  const cardRef = useRef<HTMLDivElement>(null);
  const width = 380;
  const left = Math.max(8, Math.min(x + 18, window.innerWidth - width - 12));
  const [top, setTop] = useState(() => Math.max(8, Math.min(y + 14, window.innerHeight - 260)));
  // 分支差异返回后卡片会变高，按实际高度重新夹取，避免超出窗口底部。
  useLayoutEffect(() => {
    const height = cardRef.current?.offsetHeight ?? 0;
    setTop(Math.max(8, Math.min(y + 14, window.innerHeight - height - 12)));
  }, [y, context, contextLoading]);
  const branches = commit.refs.filter(
    (ref) => ref.kind === "local_branch" || ref.kind === "remote_branch",
  );
  const tags = commit.refs.filter((ref) => ref.kind === "tag");
  const currentLabel = context?.current_branch ?? "HEAD";
  const branchNames = context
    ? context.branches.map((name) =>
        name === context.current_branch ? t("graph.branchCurrentMark", { name }) : name,
      )
    : [];
  const shownNames = branchNames.slice(0, 8);
  const hiddenNames = branchNames.length - shownNames.length;
  return (
    <div ref={cardRef} className="commit-hover-card" style={{ left, top, width }} role="tooltip">
      <div className="hover-head">
        <span className="mono">{t("graph.hoverTitle", { oid: commit.short_oid })}</span>
        {commit.refs.some((ref) => ref.is_head) && <span className="tag">HEAD</span>}
      </div>
      <p className="hover-summary">{commit.summary || t("graph.noSummary")}</p>
      <dl>
        {branches.length > 0 && (
          <>
            <dt>{t("graph.fieldBranches")}</dt>
            <dd>{branches.map((ref) => refLabel(ref, t)).join(t("graph.listSeparator"))}</dd>
          </>
        )}
        {tags.length > 0 && (
          <>
            <dt>{t("graph.fieldTags")}</dt>
            <dd>{tags.map((ref) => refLabel(ref, t)).join(t("graph.listSeparator"))}</dd>
          </>
        )}
        <dt>{t("graph.fieldParents")}</dt>
        <dd className="mono">
          {commit.parents.length > 0
            ? commit.parents.map((oid) => oid.slice(0, 7)).join(" · ")
            : t("graph.rootCommit")}
        </dd>
        <dt>{t("graph.fieldAuthor")}</dt>
        <dd>
          {commit.author_name} &lt;{commit.author_email}&gt;
        </dd>
        <dt>{t("graph.fieldCommittedAt")}</dt>
        <dd>{formatDate(commit.committed_at)}</dd>
        {commit.authored_at !== commit.committed_at && (
          <>
            <dt>{t("graph.fieldAuthoredAt")}</dt>
            <dd>{formatDate(commit.authored_at)}</dd>
          </>
        )}
      </dl>
      {contextLoading && <p className="hover-status muted">{t("graph.contextLoading")}</p>}
      {context && (
        <div className="hover-branches">
          <p className="hover-branch-line">
            <span className="hover-label">{t("graph.ownedBranches")}</span>
            {branchNames.length === 0
              ? t("graph.noLocalBranches")
              : hiddenNames > 0
                ? t("graph.ownedBranchesTruncated", {
                    branches: shownNames.join(t("graph.listSeparator")),
                    n: branchNames.length,
                  })
                : shownNames.join(t("graph.listSeparator"))}
          </p>
          {context.current_branch && !context.branches.includes(context.current_branch) && (
            <p className="hover-off-branch">
              {t("graph.notOnCurrentBranch", { branch: context.current_branch })}
            </p>
          )}
          {context.gaps.length > 0 && (
            <>
              <p className="hover-branch-line">
                <span className="hover-label">
                  {t("graph.gapRelativeLabel", { branch: currentLabel })}
                </span>{" "}
                <span className="muted">{t("graph.gapLocalBranches")}</span>
              </p>
              {context.gaps.map((gap) => (
                <div className="hover-gap" key={gap.name}>
                  <div className="hover-gap-head">
                    <span className="hover-gap-name">{gap.name}</span>
                    <span className="hover-gap-count muted">
                      {t("graph.gapCounts", { n: gap.branch_only, m: gap.head_only })}
                    </span>
                  </div>
                  {gap.branch_only_commits.length > 0 && (
                    <p className="hover-gap-commits">
                      {t("graph.gapCurrentMissingList", {
                        commits:
                          gap.branch_only_commits
                            .map(
                              (item) =>
                                `${item.short_oid} ${item.summary || t("graph.noSummaryShort")}`,
                            )
                            .join(t("graph.listSeparator")) +
                          (gap.branch_only_truncated ? " …" : ""),
                      })}
                    </p>
                  )}
                  {gap.head_only_commits.length > 0 && (
                    <p className="hover-gap-commits muted">
                      {t("graph.gapBranchMissingList", {
                        commits:
                          gap.head_only_commits
                            .map(
                              (item) =>
                                `${item.short_oid} ${item.summary || t("graph.noSummaryShort")}`,
                            )
                            .join(t("graph.listSeparator")) +
                          (gap.head_only_truncated ? " …" : ""),
                      })}
                    </p>
                  )}
                </div>
              ))}
              {context.gaps_omitted > 0 && (
                <p className="hover-status muted">
                  {t("graph.gapsOmitted", { n: context.gaps_omitted })}
                </p>
              )}
            </>
          )}
        </div>
      )}
      <p className="hover-hint muted">{t("graph.hoverHint")}</p>
    </div>
  );
}
