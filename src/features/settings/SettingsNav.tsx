import { useI18n } from "../../i18n";
import { SETTINGS_SECTIONS, type SettingsSectionKey } from "./settingsSections";

interface SettingsNavProps {
  active: SettingsSectionKey;
  onChange: (section: SettingsSectionKey) => void;
}

export function SettingsNav({ active, onChange }: SettingsNavProps) {
  const { t } = useI18n();
  return (
    <nav className="settings-nav" aria-label={t("settings.navAria")}>
      {SETTINGS_SECTIONS.map(({ key, labelKey }) => (
        <button
          key={key}
          className={active === key ? "active" : ""}
          aria-current={active === key ? "page" : undefined}
          onClick={() => onChange(key)}
        >
          <span className={`settings-nav-mark mark-${key}`} aria-hidden="true" />
          {t(labelKey)}
        </button>
      ))}
    </nav>
  );
}
