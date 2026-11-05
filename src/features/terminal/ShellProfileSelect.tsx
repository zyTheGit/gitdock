import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { Select } from "../../shared/Select";

export type ShellProfile = "default" | "git_bash";

interface ShellProfileSelectProps {
  /** 当前持久化的 Shell 选择。 */
  shellProfile: ShellProfile;
  /** Git Bash 探测结果：undefined=探测中，null=未安装（仅 Windows 渲染本组件）。 */
  gitBashPath: string | null | undefined;
  /** LazyGit 运行中禁用切换，避免静默杀掉其进程。 */
  disabled: boolean;
  /** Shell 会话运行中：切换前需两段确认（将重启当前会话）。 */
  needConfirm: boolean;
  /** 应用新选择：调用方负责持久化与（如需）重启会话。 */
  onApply: (next: ShellProfile) => void;
}

/**
 * 终端工具栏的 Shell 下拉（ADR-0023）：仅 Windows 渲染，替代设置里的 Shell Profile 入口。
 * 会话运行中采用两段确认（对齐命令日志清空模式）：选择后先进入确认态，
 * 3 秒内未确认自动回落；未运行时直接应用。
 */
export function ShellProfileSelect({
  shellProfile,
  gitBashPath,
  disabled,
  needConfirm,
  onApply,
}: ShellProfileSelectProps) {
  const { t } = useI18n();
  const [pending, setPending] = useState<ShellProfile | null>(null);
  const confirmTimer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(confirmTimer.current);
    },
    []
  );

  const gitBashAvailable = gitBashPath != null;

  const onChange = (next: ShellProfile) => {
    if (next === shellProfile || disabled) {
      return;
    }
    if (!needConfirm) {
      onApply(next);
      return;
    }
    window.clearTimeout(confirmTimer.current);
    setPending(next);
    confirmTimer.current = window.setTimeout(() => setPending(null), 3000);
  };

  const confirm = () => {
    window.clearTimeout(confirmTimer.current);
    const next = pending;
    setPending(null);
    if (next) {
      onApply(next);
    }
  };

  const cancel = () => {
    window.clearTimeout(confirmTimer.current);
    setPending(null);
  };

  return (
    <div className="terminal-shell-select">
      <label className="terminal-shell-label">
        <span className="terminal-shell-label-text">{t("terminal.shellLabel")}</span>
        <Select
          compact
          value={pending ?? shellProfile}
          disabled={disabled || gitBashPath === undefined}
          options={[
            { value: "default", label: t("terminal.shellDefault") },
            { value: "git_bash", label: t("terminal.shellGitBash"), disabled: !gitBashAvailable },
          ]}
          onChange={(event) => onChange(event.target.value as ShellProfile)}
        />
      </label>
      {pending && (
        <span className="terminal-shell-confirm" role="status">
          {t("terminal.shellSwitchHint")}
          <button type="button" className="link" onClick={confirm}>
            {t("terminal.shellSwitchConfirm")}
          </button>
          <button type="button" className="link" onClick={cancel}>
            {t("terminal.shellSwitchCancel")}
          </button>
        </span>
      )}
      {disabled && <span className="terminal-shell-blocked">{t("terminal.shellLazygitBlocked")}</span>}
      {!gitBashAvailable && gitBashPath === null && !disabled && (
        <span className="terminal-shell-blocked">{t("terminal.shellGitBashMissing")}</span>
      )}
    </div>
  );
}