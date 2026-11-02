import { useEffect, useState } from "react";
import {
  ACTION_LABELS,
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
} from "../../app/keybindings";
import { Kbd } from "../../shared/Kbd";

/** 界面里写死的键位说明，与 fixedShortcuts 一一对应，不支持改键。 */
const FIXED_SHORTCUTS: { keys: string[]; text: string }[] = [
  { keys: ["Esc"], text: "逐层退出：取消待替换的槽位 → 退出搜索 → 退出对比 → 清空双槽；也用于收起放大的 diff、关闭菜单与仓库切换器" },
  { keys: ["Ctrl", "Shift", "Enter"], text: "终端整窗放大 / 还原（只在终端面板内生效）" },
  { keys: ["↑", "↓"], text: "仓库切换器、搜索建议里移动高亮；拖拽分隔条时调整栏宽，按住 Shift 步长更大" },
  { keys: ["Enter"], text: "确认仓库切换器 / 搜索输入框里的高亮项" },
  { keys: ["Ctrl", "点击"], text: "把提交放进对比双槽，第二次点击换到另一个槽位" },
];

export function KeyBindingsSection() {
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
        setMessage(reason);
        return;
      }
      setMessage(`「${ACTION_LABELS[capturing]}」已改为 ${spec}。`);
      setCapturingAction(null);
    };
    // 捕获阶段：先于全局派发与任何控件的按键处理拿到这次按键。
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [capturing]);

  // 卸载（关闭设置）时录制状态必须归还，否则全局快捷键永久失灵。
  useEffect(() => () => setCapturing(false), []);

  const changed = BINDABLE_ACTIONS.some(
    (action) => bindings[action] !== DEFAULT_BINDINGS[action],
  );

  return (
    <>
      <h3>快捷键</h3>
      <p className="muted settings-hint">
        点击「修改」后按下新组合即生效，只保存在本机。
        <kbd>Esc</kbd> 与控件内的 <kbd>↑</kbd> <kbd>↓</kbd> <kbd>Enter</kbd> 承担固定的退出与导航语义，不支持改键。
      </p>
      <ul className="keybinding-list">
        {BINDABLE_ACTIONS.map((action) => (
          <li key={action} className={capturing === action ? "is-capturing" : undefined}>
            <span className="keybinding-action">{ACTION_LABELS[action]}</span>
            <span className="keybinding-keys">
              <Kbd spec={bindings[action]} />
              {capturing === action && <span className="muted">按下新组合…</span>}
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
                {capturing === action ? "取消" : "修改"}
              </button>
              {bindings[action] !== DEFAULT_BINDINGS[action] && (
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    resetBinding(action);
                    setMessage(`「${ACTION_LABELS[action]}」已恢复默认。`);
                    setCapturingAction(null);
                  }}
                >
                  恢复默认
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
              setMessage("全部快捷键已恢复默认。");
              setCapturingAction(null);
            }}
          >
            全部恢复默认
          </button>
        )}
      </div>

      <h4 className="keybinding-subtitle">固定键位</h4>
      <ul className="keybinding-fixed">
        {FIXED_SHORTCUTS.map((shortcut) => (
          <li key={shortcut.text}>
            <span className="keybinding-keys">
              {shortcut.keys.map((key) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </span>
            <span className="muted">{shortcut.text}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
