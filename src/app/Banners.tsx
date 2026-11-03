import { useI18n } from "../i18n";
import {
  interruptionHintText,
  interruptionText,
  warningText,
} from "../shared/error";
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
  const { t } = useI18n();
  const single = repo ? singleInterruption(repo.interruption.kinds) : null;

  return (
    <>
      {repo?.interruption.kinds.length ? (
        <div className="banner warning">
          <strong>{interruptionText(repo.interruption.kinds)}</strong>
          {repo.interruption.files.length > 0 && (
            <span>
              {t("shell.interruptionFiles", {
                files: repo.interruption.files.join(t("shell.fileListSeparator")),
              })}
            </span>
          )}
          <code>{interruptionHintText(repo.interruption.kinds)}</code>
          {single && (
            <div className="banner-actions">
              <button
                onClick={() => onInterruptionAction("continue_operation", single)}
                disabled={interruptionDisabled}
              >
                {t("shell.interruptionContinue")}
              </button>
              <button
                className="danger-text"
                onClick={() => onInterruptionAction("abort_operation", single)}
                disabled={interruptionDisabled}
              >
                {t("shell.interruptionAbort")}
              </button>
            </div>
          )}
          <span className="muted">
            {single ? t("shell.interruptionHintSingle") : t("shell.interruptionHintGeneral")}
          </span>
        </div>
      ) : null}

      {repo?.warnings.map((warning) => (
        <div className="banner info" key={warning.code}>
          {warningText(warning)}
        </div>
      ))}

      {info && !info.git_version_supported && (
        <div className="banner danger">
          {t("shell.gitVersionTooLow", {
            current: info.git_version ?? t("shell.unknown"),
            minimum: info.minimum_git_version,
          })}
        </div>
      )}

      {error && (
        <div className="banner danger">
          <span className="banner-text">{error}</span>
          {diagnostic && (
            <button className="link" onClick={onCopyDiagnostic}>
              {t("shell.copyDiagnostic")}
            </button>
          )}
        </div>
      )}
    </>
  );
}
