import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * 可改键的动作集合。
 *
 * 刻意不纳入 `Esc` 与控件内导航键（`↑↓` / `Enter`）：`Esc` 有分层语义
 * （取消待替换 → 退出搜索 → 退出对比 → 清空双槽），改键会破坏这套顺序；
 * 控件内按键是无障碍基线，不该被配置掉。
 */
export type BindableAction = "terminal.toggle" | "zoom.in" | "zoom.out" | "zoom.reset";

export const BINDABLE_ACTIONS: readonly BindableAction[] = [
  "terminal.toggle",
  "zoom.in",
  "zoom.out",
  "zoom.reset",
];

export const DEFAULT_BINDINGS: Record<BindableAction, string> = {
  "terminal.toggle": "Ctrl+`",
  "zoom.in": "Ctrl+=",
  "zoom.out": "Ctrl+-",
  "zoom.reset": "Ctrl+0",
};

/**
 * 拒绝原因的结构化描述：本模块不产出任何语言文案，界面据此翻译。
 * `keyName` 是触发组合的主键名（原文展示）；`clashAction` 是冲突的动作，
 * 由界面翻译动作名后插值。
 */
export interface BindingRejection {
  key:
    | "settings.keybindRejectNoModifier"
    | "settings.keybindRejectShift"
    | "settings.keybindRejectCtrlAlt"
    | "settings.keybindRejectAltReserved"
    | "settings.keybindRejectCtrlLetter"
    | "settings.keybindRejectUnsupported"
    | "settings.keybindRejectUnrecognized"
    | "settings.keybindRejectClash";
  keyName?: string;
  clashAction?: BindableAction;
}

const STORAGE_KEY = "gitdock.keybindings";

interface Combo {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

/**
 * 别名折叠：主键盘与小键盘、Shift 打出的符号在不同布局下报不同的值，
 * 统一到一个规范键，避免同一个物理键位被存成两种组合。
 */
const KEY_ALIASES: Record<string, string> = {
  "+": "=",
  Add: "=",
  _: "-",
  Subtract: "-",
  " ": "Space",
  Escape: "Esc",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
};

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "OS"]);

/** 只按下修饰键不算一次组合。 */
function normalizeKey(raw: string): string {
  const alias = KEY_ALIASES[raw];
  if (alias) {
    return alias;
  }
  return raw.length === 1 ? raw.toLowerCase() : raw;
}

export function parseSpec(spec: string): Combo | null {
  let ctrl = false;
  let alt = false;
  let shift = false;
  const rest: string[] = [];
  for (const part of spec.split("+")) {
    switch (part.toLowerCase()) {
      case "ctrl":
      case "control":
        ctrl = true;
        break;
      case "alt":
        alt = true;
        break;
      case "shift":
        shift = true;
        break;
      default:
        if (part) {
          rest.push(part);
        }
    }
  }
  const key = normalizeKey(rest.join("+"));
  if (!key) {
    return null;
  }
  return { ctrl, alt, shift, key };
}

export function formatCombo(combo: Combo): string {
  return [combo.ctrl && "Ctrl", combo.alt && "Alt", combo.shift && "Shift", combo.key]
    .filter(Boolean)
    .join("+");
}

/** 拆成修饰键 + 主键，供界面逐个渲染 `<kbd>`。 */
export function splitCombo(spec: string): string[] {
  const combo = parseSpec(spec);
  if (!combo) {
    return [spec];
  }
  return [combo.ctrl && "Ctrl", combo.alt && "Alt", combo.shift && "Shift", combo.key]
    .filter(Boolean)
    .map(String);
}

export function comboFromEvent(event: KeyboardEvent): Combo | null {
  if (MODIFIER_KEYS.has(event.key)) {
    return null;
  }
  const key = normalizeKey(event.key);
  if (!key) {
    return null;
  }
  return { ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, key };
}

/**
 * 匹配规则比录入规则宽松：绑定本身不含 Shift（校验会拒绝），因此
 * `Ctrl+Shift+=` 也算命中——这是改动前就有的行为，不能回退。
 */
export function matchesBinding(spec: string, event: KeyboardEvent): boolean {
  const combo = parseSpec(spec);
  const actual = comboFromEvent(event);
  if (!combo || !actual || event.metaKey) {
    return false;
  }
  if (combo.shift && !actual.shift) {
    return false;
  }
  return (
    combo.ctrl === actual.ctrl &&
    combo.alt === actual.alt &&
    combo.key === actual.key
  );
}

/**
 * Ctrl 允许的组合键：数字、符号与功能键。字母一律保留给复制/粘贴/查找
 * 等系统与浏览器行为，不做改键。
 */
const CTRL_ALLOWED = new Set([
  "`",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "0",
  "=",
  "-",
  "[",
  "]",
  ";",
  "'",
  ",",
  ".",
  "/",
  "\\",
]);

const RESERVED_ALT = new Set(["F4", "Tab", "Esc", "Space", "Home", "End"]);

/** 返回结构化拒绝原因；`null` 表示该组合可用。 */
export function rejectionReason(combo: Combo): BindingRejection | null {
  if (!combo.ctrl && !combo.alt) {
    return { key: "settings.keybindRejectNoModifier" };
  }
  if (combo.shift) {
    return { key: "settings.keybindRejectShift" };
  }
  if (combo.ctrl && combo.alt) {
    return { key: "settings.keybindRejectCtrlAlt" };
  }
  if (combo.alt && !combo.ctrl && RESERVED_ALT.has(combo.key)) {
    return { key: "settings.keybindRejectAltReserved", keyName: combo.key };
  }
  if (combo.ctrl) {
    if (/^F([1-9]|1[0-2])$/.test(combo.key)) {
      return null;
    }
    if (CTRL_ALLOWED.has(combo.key)) {
      return null;
    }
    if (/^[a-z]$/.test(combo.key)) {
      return { key: "settings.keybindRejectCtrlLetter" };
    }
    return { key: "settings.keybindRejectUnsupported", keyName: combo.key };
  }
  return null;
}

function sanitize(spec: string): string | null {
  const combo = parseSpec(spec);
  if (!combo || rejectionReason(combo)) {
    return null;
  }
  return formatCombo(combo);
}

function readStored(): Record<string, unknown> | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * 贪心按动作顺序采纳用户值：非法组合、已被占用的组合都退回默认。
 * 只保护「不抢别人正在用的键位」，不做自动腾挪，因为默认键位本身也可能
 * 被用户改走，腾挪链会难以解释。手改存储才能走到这条路径。
 */
function load(): Record<BindableAction, string> {
  const merged: Record<BindableAction, string> = { ...DEFAULT_BINDINGS };
  const stored = readStored();
  if (!stored) {
    return merged;
  }
  const taken = new Set<string>(BINDABLE_ACTIONS.map((action) => DEFAULT_BINDINGS[action]));
  for (const action of BINDABLE_ACTIONS) {
    const value = stored[action];
    if (typeof value !== "string") {
      continue;
    }
    const allowed = sanitize(value);
    if (!allowed || allowed === merged[action] || taken.has(allowed)) {
      continue;
    }
    taken.delete(merged[action]);
    taken.add(allowed);
    merged[action] = allowed;
  }
  return merged;
}

let bindings: Record<BindableAction, string> = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // 隐私模式或配额不足：改键在本次会话内仍然生效，只是不跨重启。
  }
}

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getBindings(): Record<BindableAction, string> {
  return bindings;
}

export function bindingLabel(action: BindableAction): string {
  return bindings[action];
}

/** 录入框正在捕获按键时，全局派发要让路，否则改键过程会误触发功能。 */
let capturing = false;

export function setCapturing(next: boolean) {
  capturing = next;
}

export function isCapturing(): boolean {
  return capturing;
}

/** 写入一个组合；返回结构化拒绝原因，`null` 表示成功。 */
export function setBinding(action: BindableAction, spec: string): BindingRejection | null {
  const combo = parseSpec(spec);
  if (!combo) {
    return { key: "settings.keybindRejectUnrecognized" };
  }
  const reason = rejectionReason(combo);
  if (reason) {
    return reason;
  }
  const canonical = formatCombo(combo);
  const clash = BINDABLE_ACTIONS.find(
    (other) => other !== action && bindings[other] === canonical,
  );
  if (clash) {
    return { key: "settings.keybindRejectClash", clashAction: clash };
  }
  bindings = { ...bindings, [action]: canonical };
  persist();
  emit();
  return null;
}

export function resetBinding(action: BindableAction) {
  bindings = { ...bindings, [action]: DEFAULT_BINDINGS[action] };
  persist();
  emit();
}

export function resetAllBindings() {
  bindings = { ...DEFAULT_BINDINGS };
  persist();
  emit();
}

/** 是否存在与默认不同的绑定。 */
export function hasCustomBindings(): boolean {
  return BINDABLE_ACTIONS.some((action) => bindings[action] !== DEFAULT_BINDINGS[action]);
}

export function useBindings(): Record<BindableAction, string> {
  return useSyncExternalStore(subscribe, getBindings, getBindings);
}

export type ActionHandlers = Partial<Record<BindableAction, () => void>>;

/**
 * 全局按键派发。捕获阶段监听，优先于终端与输入框内的按键；每次按键现读绑定，
 * 改键立即生效，不需要重装监听器。没有处理器的动作不拦截，保留浏览器默认行为。
 */
export function useKeybindings(handlers: ActionHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isCapturing() || event.metaKey) {
        return;
      }
      for (const action of BINDABLE_ACTIONS) {
        const handler = handlersRef.current[action];
        if (handler && matchesBinding(bindings[action], event)) {
          event.preventDefault();
          handler();
          return;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
