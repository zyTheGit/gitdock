import { SETTINGS_SECTIONS, type SettingsSectionKey } from "./settingsSections";

interface SettingsNavProps {
  active: SettingsSectionKey;
  onChange: (section: SettingsSectionKey) => void;
}

export function SettingsNav({ active, onChange }: SettingsNavProps) {
  return (
    <nav className="settings-nav" aria-label="设置分区">
      {SETTINGS_SECTIONS.map(({ key, label }) => (
        <button
          key={key}
          className={active === key ? "active" : ""}
          aria-current={active === key ? "page" : undefined}
          onClick={() => onChange(key)}
        >
          <span className={`settings-nav-mark mark-${key}`} aria-hidden="true" />
          {label}
        </button>
      ))}
    </nav>
  );
}
