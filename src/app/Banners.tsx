import type { AppInfoDto, InterruptionKind, RepoStateDto } from "../shared/types";

export type InterruptionActionKind = "continue_operation" | "abort_operation";
export type SingleInterruption = Extract<InterruptionKind, "cherry_pick" | "revert">;

/** 只有「恰好一个」cherry-pick / revert 中断标记才接管；批量序列、merge、rebase 一律交给终端。 */
function singleInterruption(kinds: InterruptionKind[]): SingleInterruption | null {
  if (kinds.length !== 1) {
    return null;
  }
  const kind = kinds[0];
  return kind === "cherry_pick" || kind === "revert" ? kind : null;
}

interface BannersProps {
  repo: RepoStateDto | null;
  info: AppInfoDto | null;
  error: string | null;
  diagnostic: string | null;
  /** 继续/中止按钮自身是否不可用（与普通写操作的禁用条件不同，不含中断态）。 */
  interruptionDisabled: boolean;
  onInterruptionAction: (kind: InterruptionActionKind, interruption: SingleInterruption) => void;
  onCopyDiagnostic: () => void;
}

/** 主区顶部横幅：中断态、仓库警告、Git 版本不足、错误与诊断。 */
export function Banners({
  repo,
  info,
  error,
  diagnostic,
  interruptionDisabled,
  onInterruptionAction,
  onCopyDiagnostic,
}: BannersProps) {
  const single = repo ? singleInterruption(repo.interruption.kinds) : null;

  return (
    <>
      {repo?.interruption.kinds.length ? (
        <div className="banner warning">
          <strong>{repo.interruption.message}</strong>
          {repo.interruption.files.length > 0 && (
            <span>未完成文件：{repo.interruption.files.join("、")}</span>
          )}
          {repo.interruption.terminal_hint && <code>{repo.interruption.terminal_hint}</code>}
          {single && (
            <div className="banner-actions">
              <button
                onClick={() => onInterruptionAction("continue_operation", single)}
                disabled={interruptionDisabled}
              >
                继续
              </button>
              <button
                className="danger-text"
                onClick={() => onInterruptionAction("abort_operation", single)}
                disabled={interruptionDisabled}
              >
                中止…
              </button>
            </div>
          )}
          <span className="muted">
            {single
              ? "本应用不会自动执行 --abort / --quit / --skip；继续或中止只在手动点击并确认后执行，其他写操作在中断态解除前保持禁用。"
              : "本应用不会自动执行 --abort / --quit / --skip；写操作在中断态解除前保持禁用，批量序列、merge 与 rebase 中断请在终端收尾。"}
          </span>
        </div>
      ) : null}

      {repo?.warnings.map((warning) => (
        <div className="banner info" key={warning.code}>
          {warning.message}
        </div>
      ))}

      {info && !info.git_version_supported && (
        <div className="banner danger">
          系统 Git 版本 {info.git_version ?? "未知"} 低于最低要求 {info.minimum_git_version}，写操作将不可用。
        </div>
      )}

      {error && (
        <div className="banner danger">
          <span className="banner-text">{error}</span>
          {diagnostic && (
            <button className="link" onClick={onCopyDiagnostic}>
              复制诊断
            </button>
          )}
        </div>
      )}
    </>
  );
}
