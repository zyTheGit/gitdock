import { useState } from "react";
import { useI18n, type LanguagePreference } from "../../i18n";
import { Icon } from "../../assets/icons";
import { Select } from "../../shared/Select";

const MIN_SCALE = 0.75;
const MAX_SCALE = 2;

interface AppearanceSectionProps {
  active: boolean;
  fontScale: number;
  /** 语言切换即时生效（写 settings.json 独立命令），不走设置草稿的「保存」。 */
  language: LanguagePreference;
  onLanguageChange: (preference: LanguagePreference) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
}

export function AppearanceSection({
  active,
  fontScale,
  language,
  onLanguageChange,
  onZoomIn,
  onZoomOut,
  onResetZoom,
}: AppearanceSectionProps) {
  const { t } = useI18n();
  const [theme, setTheme] = useState(() => localStorage.getItem("gitdock.theme") ?? "system");

  return (
    <section id="settings-appearance" hidden={!active}>
      <h3>{t("settings.appearanceTitle")}</h3>
      <p className="muted settings-hint">{t("settings.appearanceHint")}</p>
      <label className="settings-theme-row">
        <span>{t("settings.themeLabel")}</span>
        <Select
          className="theme-select"
          value={theme}
          options={[
            { value: "system", label: t("settings.themeOptionSystem") },
            { value: "light", label: t("settings.themeOptionLight") },
            { value: "dark", label: t("settings.themeOptionDark") },
          ]}
          onChange={(event) => {
            const value = event.target.value;
            setTheme(value);
            if (value === "system") localStorage.removeItem("gitdock.theme");
            else localStorage.setItem("gitdock.theme", value);
            if (value === "system") document.documentElement.removeAttribute("data-theme");
            else document.documentElement.dataset.theme = value;
          }}
        />
      </label>
      <label className="settings-theme-row">
        <span>{t("language")}</span>
        <Select
          className="theme-select"
          value={language}
          options={[
            { value: "system", label: t("languageOptionSystem") },
            { value: "zh-CN", label: t("languageOptionZhCn") },
            { value: "en", label: t("languageOptionEn") },
          ]}
          onChange={(event) => onLanguageChange(event.target.value as LanguagePreference)}
        />
      </label>
      <p className="muted settings-hint">{t("languageHint")}</p>
      <div className="zoom-row">
        <span>{t("settings.zoomLabel")}</span>
        <span className="zoom-controls">
          <button
            type="button"
            className="zoom-button"
            title={t("settings.zoomOut")}
            aria-label={t("settings.zoomOutAria")}
            onClick={onZoomOut}
            disabled={fontScale <= MIN_SCALE}
          >
            <Icon name="zoomOut" className="zoom-icon" />
          </button>
          <button
            type="button"
            className="zoom-value mono"
            title={t("settings.zoomReset")}
            aria-label={t("settings.zoomCurrent", { n: Math.round(fontScale * 100) })}
            onClick={onResetZoom}
            disabled={fontScale === 1}
          >
            {Math.round(fontScale * 100)}%
          </button>
          <button
            type="button"
            className="zoom-button"
            title={t("settings.zoomIn")}
            aria-label={t("settings.zoomInAria")}
            onClick={onZoomIn}
            disabled={fontScale >= MAX_SCALE}
          >
            <Icon name="zoomIn" className="zoom-icon" />
          </button>
        </span>
      </div>
      <p className="muted settings-hint">{t("settings.zoomHint")}</p>
    </section>
  );
}
