import { useEffect, useState } from "react";
import { useI18n, tLoose } from "../../i18n";
import type settingsZh from "../../i18n/locales/zh-CN/settings";
import {
  BINDABLE_ACTIONS,
  DEFAULT_BINDINGS,
  comboFromEvent,
  formatCombo,
  rejectionReason,
  resetAllBindings,
  resetBinding,
  setBinding,
  setCapturing,
  useBindings,
  type BindableAction,
  type BindingRejection,
} from "../../shared/keybindings";
import { Kbd } from "../../shared/Kbd";
import { altModifierLabel, primaryModifierLabel } from "../../shared/platform";

/** settings 域消息 key（带命名空间前缀）：映射表字段用它收窄，t() 才能编译期校验。 */
type SettingsKey = `settings.${keyof typeof settingsZh}`;

/** 结构化拒绝原因 → 当前语言的完整句子。 */
function formatRejection(
  t: ReturnType<typeof useI18n>["t"],
  rejection: BindingRejection,
): string {
  if (rejection.clashAction) {
    return tLoose(rejection.key, { action: t(ACTION_LABEL_KEYS[rejection.clashAction]) });
  }
  if (rejection.keyName) {
    // Unsupported 的前缀修饰键按平台显示 ⌘/Ctrl（ADR-0006）；AltReserved 的 Alt 保持原文。
    const options =
      rejection.key === "settings.keybindRejectUnsupported"
        ? { key: rejection.keyName, modifier: primaryModifierLabel() }
        : { key: rejection.keyName };
    return tLoose(rejection.key, options);
  }
  return t(rejection.key);
}

/** 界面里写死的键位说明，与 fixedShortcuts 一一对应，不支持改键；textKey 存 i18n key。 */
const FIXED_SHORTCUTS: { keys: string[]; textKey: SettingsKey }[] = [
  { keys: ["Esc"], textKey: "settings.fixedEsc" },
  { keys: ["Ctrl", "Shift", "Enter"], textKey: "settings.fixedTerminalZoom" },
  { keys: ["↑", "↓"], textKey: "settings.fixedArrows" },
  { keys: ["Enter"], textKey: "settings.fixedEnter" },
  { keys: ["Ctrl", "点击"], textKey: "settings.fixedCtrlClick" },
  { keys: ["Ctrl", ","], textKey: "settings.fixedSettings" },
  { keys: ["Ctrl", "PageDown"], textKey: "settings.fixedPanelTabNext" },
  { keys: ["Ctrl", "PageUp"], textKey: "settings.fixedPanelTabPrev" },
  { keys: ["Shift", "点击"], textKey: "settings.fixedShiftClick" },
  { keys: ["Alt", "点击"], textKey: "settings.fixedAltClick" },
];

/** 可改键动作的展示名 key；shared 的 ACTION_LABELS 供其内部消息使用，界面渲染走 i18n。 */
const ACTION_LABEL_KEYS: Record<BindableAction, SettingsKey> = {
  "terminal.toggle": "settings.actionTerminalToggle",
  "zoom.in": "settings.actionZoomIn",
  "zoom.out": "settings.actionZoomOut",
  "zoom.reset": "settings.actionZoomReset",
};

/** 键位符号里需要翻译的词；Esc / Ctrl / ↑ / Enter 等其余符号保持原文。 */
const KBD_LABEL_KEYS: Record<string, SettingsKey> = {
  点击: "settings.keybindKeyClick",
};

export function KeyBindingsSection() {
  const { t } = useI18n();
  const bindings = useBindings();
  const [capturing, setCapturingAction] = useState<BindableAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setCapturing(capturing !== null);
    if (capturing === null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setCapturingAction(null);
        return;
      }
      const combo = comboFromEvent(event);
      if (!combo) {
        return;
      }
      const spec = formatCombo(combo);
      const reason = rejectionReason(combo) ?? setBinding(capturing, spec);
      if (reason) {
        setMessage(formatRejection(t, reason));
        return;
      }
      setMessage(t("settings.keybindChangedMessage", { action: t(ACTION_LABEL_KEYS[capturing]), spec }));
      setCapturingAction(null);
    };
    // 捕获阶段：先于全局派发与任何控件的按键处理拿到这次按键。
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [capturing, t]);

  // 卸载（关闭设置）时录制状态必须归还，否则全局快捷键永久失灵。
  useEffect(() => () => setCapturing(false), []);

  const changed = BINDABLE_ACTIONS.some(
    (action) => bindings[action] !== DEFAULT_BINDINGS[action],
  );

  return (
    <>
      <h3>{t("settings.keybindTitle")}</h3>
      <p className="muted settings-hint">
        {t("settings.keybindHintEditable")}
        <kbd>Esc</kbd>
        {t("settings.keybindHintKbdMid")}
        <kbd>↑</kbd> <kbd>↓</kbd> <kbd>Enter</kbd>
        {t("settings.keybindHintKbdTail")}
      </p>
      <ul className="keybinding-list">
        {BINDABLE_ACTIONS.map((action) => (
          <li key={action} className={capturing === action ? "is-capturing" : undefined}>
            <span className="keybinding-action">{t(ACTION_LABEL_KEYS[action])}</span>
            <span className="keybinding-keys">
              <Kbd spec={bindings[action]} />
              {capturing === action && (
                <span className="muted">{t("settings.keybindCapturing")}</span>
              )}
            </span>
            <span className="keybinding-actions">
              <button
                type="button"
                className="link"
                onClick={() => {
                  setMessage(null);
                  setCapturingAction(capturing === action ? null : action);
                }}
              >
                {capturing === action ? t("settings.cancel") : t("settings.keybindModify")}
              </button>
              {bindings[action] !== DEFAULT_BINDINGS[action] && (
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    resetBinding(action);
                    setMessage(
                      t("settings.keybindResetMessage", { action: t(ACTION_LABEL_KEYS[action]) }),
                    );
                    setCapturingAction(null);
                  }}
                >
                  {t("settings.keybindResetOne")}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <div className="keybinding-footer">
        {message && <span className="muted">{message}</span>}
        {changed && (
          <button
            type="button"
            className="link"
            onClick={() => {
              resetAllBindings();
              setMessage(t("settings.keybindResetAllMessage"));
              setCapturingAction(null);
            }}
          >
            {t("settings.keybindResetAll")}
          </button>
        )}
      </div>

      <h4 className="keybinding-subtitle">{t("settings.keybindFixedTitle")}</h4>
      <ul className="keybinding-fixed">
        {FIXED_SHORTCUTS.map((shortcut) => (
          <li key={shortcut.textKey}>
            <span className="keybinding-keys">
              {shortcut.keys.map((key) => (
                <kbd key={key}>
                  {key === "Ctrl" && primaryModifierLabel() !== "Ctrl"
                    ? primaryModifierLabel()
                    : key === "Alt"
                      ? altModifierLabel()
                      : KBD_LABEL_KEYS[key]
                        ? t(KBD_LABEL_KEYS[key])
                        : key}
                </kbd>
              ))}
            </span>
            <span className="muted">
              {tLoose(shortcut.textKey, { modifier: primaryModifierLabel(), alt: altModifierLabel() })}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
