import { useI18n } from "../../i18n";


interface TerminalSectionProps {
  active: boolean;
  lazygitPath: string;
  onLazygitPathChange: (value: string) => void;
  onBrowse: () => Promise<void>;
}

export function TerminalSection({
  active,
  lazygitPath,
  onLazygitPathChange,
  onBrowse,
}: TerminalSectionProps) {
  const { t } = useI18n();
  return (
    <section id="settings-terminal" hidden={!active}>
      <h3>{t("settings.terminalTitle")}</h3>
      <p className="muted settings-hint">{t("settings.terminalHint")}</p>
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
