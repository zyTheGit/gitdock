import { useI18n } from "../../i18n";
import { currentPlatform } from "../../shared/platform";
import { Select } from "../../shared/Select";
import { useIpcResource } from "../../shared/useIpcResource";
import { ipc } from "../../shared/ipc";

interface TerminalSectionProps {
  active: boolean;
  lazygitPath: string;
  onLazygitPathChange: (value: string) => void;
  shellProfile: string;
  onShellProfileChange: (value: string) => void;
  onBrowse: () => Promise<void>;
}

export function TerminalSection({
  active,
  lazygitPath,
  onLazygitPathChange,
  shellProfile,
  onShellProfileChange,
  onBrowse,
}: TerminalSectionProps) {
  const { t } = useI18n();
  // Git Bash 仅 Windows 有意义：整块只在 Windows 渲染，capabilities 也只在
  // Windows 拉取（enabled 传平台条件，其余平台零请求）。
  const isWindows = currentPlatform() === "windows";
  const capabilities = useIpcResource(
    [],
    () => ipc.terminalCapabilities(),
    { enabled: active && isWindows },
  );
  const gitBashAvailable = Boolean(capabilities.data?.git_bash_path);
  return (
    <section id="settings-terminal" hidden={!active}>
      <h3>{t("settings.terminalTitle")}</h3>
      <p className="muted settings-hint">{t("settings.terminalHint")}</p>
      {isWindows && (
        <label className="settings-field">
          <span className="settings-field-label">{t("settings.terminalShellProfileLabel")}</span>
          <Select
            block
            value={shellProfile}
            options={[
              { value: "default", label: t("settings.terminalShellProfileDefault") },
              {
                value: "git_bash",
                label: t("settings.terminalShellProfileGitBash"),
                disabled: !gitBashAvailable,
              },
            ]}
            onChange={(event) => onShellProfileChange(event.target.value)}
          />
          {!gitBashAvailable && (
            <span className="muted settings-hint">
              {t("settings.terminalShellProfileGitBashMissing")}
            </span>
          )}
        </label>
      )}
      <label className="settings-field">
        <span className="settings-field-label">{t("settings.terminalLazygitLabel")}</span>
        <span className="tool-path">
          <input
            value={lazygitPath}
            placeholder={t("settings.terminalLazygitPlaceholder")}
            onChange={(event) => onLazygitPathChange(event.target.value)}
          />
          <button type="button" onClick={() => void onBrowse()}>
            {t("settings.browse")}
          </button>
        </span>
      </label>
    </section>
  );
}
