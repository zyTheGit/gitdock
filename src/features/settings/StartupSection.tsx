import { useI18n } from "../../i18n";

interface StartupSectionProps {
  active: boolean;
  restore: boolean;
  watch: boolean;
  onRestoreChange: (value: boolean) => void;
  onWatchChange: (value: boolean) => void;
}

export function StartupSection({
  active,
  restore,
  watch,
  onRestoreChange,
  onWatchChange,
}: StartupSectionProps) {
  const { t } = useI18n();
  return (
    <section id="settings-startup" hidden={!active}>
      <h3>{t("settings.startupTitle")}</h3>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={restore}
          onChange={(event) => onRestoreChange(event.target.checked)}
        />
        {t("settings.startupRestore")}
      </label>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={watch}
          onChange={(event) => onWatchChange(event.target.checked)}
        />
        {t("settings.startupWatch")}
      </label>
    </section>
  );
}
