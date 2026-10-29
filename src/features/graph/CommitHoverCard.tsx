import { useLayoutEffect, useRef, useState } from "react";
import { formatDate } from "../../shared/format";
import type { CommitBranchContextDto, CommitSummaryDto, RefBadgeDto } from "../../shared/types";

function refLabel(ref: RefBadgeDto): string {
  const name = ref.is_head ? `${ref.name}（HEAD）` : ref.name;
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
    ? context.branches.map((name) => (name === context.current_branch ? `${name}（当前）` : name))
    : [];
  const shownNames = branchNames.slice(0, 8);
  const hiddenNames = branchNames.length - shownNames.length;
  return (
    <div ref={cardRef} className="commit-hover-card" style={{ left, top, width }} role="tooltip">
      <div className="hover-head">
        <span className="mono">提交 {commit.short_oid}</span>
        {commit.refs.some((ref) => ref.is_head) && <span className="tag">HEAD</span>}
      </div>
      <p className="hover-summary">{commit.summary || "（无提交说明）"}</p>
      <dl>
        {branches.length > 0 && (
          <>
            <dt>分支</dt>
            <dd>{branches.map(refLabel).join("、")}</dd>
          </>
        )}
        {tags.length > 0 && (
          <>
            <dt>标签</dt>
            <dd>{tags.map(refLabel).join("、")}</dd>
          </>
        )}
        <dt>父提交</dt>
        <dd className="mono">
          {commit.parents.length > 0
            ? commit.parents.map((oid) => oid.slice(0, 7)).join(" · ")
            : "无（根提交）"}
        </dd>
        <dt>作者</dt>
        <dd>
          {commit.author_name} &lt;{commit.author_email}&gt;
        </dd>
        <dt>提交时间</dt>
        <dd>{formatDate(commit.committed_at)}</dd>
        {commit.authored_at !== commit.committed_at && (
          <>
            <dt>作者时间</dt>
            <dd>{formatDate(commit.authored_at)}</dd>
          </>
        )}
      </dl>
      {contextLoading && <p className="hover-status muted">正在统计所属分支与差异…</p>}
      {context && (
        <div className="hover-branches">
          <p className="hover-branch-line">
            <span className="hover-label">所属分支</span>
            {branchNames.length === 0
              ? "无本地分支"
              : `${shownNames.join("、")}${hiddenNames > 0 ? ` 等 ${branchNames.length} 个` : ""}`}
          </p>
          {context.current_branch && !context.branches.includes(context.current_branch) && (
            <p className="hover-off-branch">该提交不在当前分支 {context.current_branch}</p>
          )}
          {context.gaps.length > 0 && (
            <>
              <p className="hover-branch-line">
                <span className="hover-label">相对 {currentLabel}</span>{" "}
                <span className="muted">本地分支</span>
              </p>
              {context.gaps.map((gap) => (
                <div className="hover-gap" key={gap.name}>
                  <div className="hover-gap-head">
                    <span className="hover-gap-name">{gap.name}</span>
                    <span className="hover-gap-count muted">
                      当前分支缺少 {gap.branch_only} · 该分支缺少 {gap.head_only}
                    </span>
                  </div>
                  {gap.branch_only_commits.length > 0 && (
                    <p className="hover-gap-commits">
                      缺少：
                      {gap.branch_only_commits
                        .map((item) => `${item.short_oid} ${item.summary || "（无说明）"}`)
                        .join("、")}
                      {gap.branch_only_truncated ? " …" : ""}
                    </p>
                  )}
                  {gap.head_only_commits.length > 0 && (
                    <p className="hover-gap-commits muted">
                      该分支缺少：
                      {gap.head_only_commits
                        .map((item) => `${item.short_oid} ${item.summary || "（无说明）"}`)
                        .join("、")}
                      {gap.head_only_truncated ? " …" : ""}
                    </p>
                  )}
                </div>
              ))}
              {context.gaps_omitted > 0 && (
                <p className="hover-status muted">
                  另有 {context.gaps_omitted} 个分支未参与统计
                </p>
              )}
            </>
          )}
        </div>
      )}
      <p className="hover-hint muted">点击行查看详情与文件改动</p>
    </div>
  );
}
