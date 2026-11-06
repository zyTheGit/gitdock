import { Icon } from "../../assets/icons";
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
      {SETTINGS_SECTIONS.map(({ key, labelKey, icon }) => (
        <button
          key={key}
          className={active === key ? "active" : ""}
          aria-current={active === key ? "page" : undefined}
          onClick={() => onChange(key)}
        >
          <Icon name={icon} className="settings-nav-icon" />
          <span className="settings-nav-label">{t(labelKey)}</span>
        </button>
      ))}
    </nav>
  );
}
