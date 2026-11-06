/**
 * Esc 分层消费协议。
 *
 * 界面多层都直接监听 window 的 keydown，为避免一次 Esc 触发多层退出，
 * 约定「放大 diff 视图」在捕获阶段最先处理 Esc 并在事件对象上打标记，
 * 后续各全局监听（App 分级退出、暂存区退出、终端全屏还原）见标记即让路。
 * 不使用 stopPropagation：那会连右键菜单等同样监听 Esc 的浮层一并吞掉；
 * 标记只约束界面退出层，且随事件对象生命周期销毁，无跨按键泄漏。
 */

/** 底部面板容器选择器：焦点在面板内时 Esc 归面板（终端程序或日志视图），界面层统一让路。 */
export const BOTTOM_PANEL_SELECTOR = ".bottom-panel";

const escConsumedFlag = Symbol("gitdockEscConsumed");

type EscMarkedEvent = KeyboardEvent & { [escConsumedFlag]?: boolean };

/** 该次 Esc 是否已被更内层（放大 diff 视图）消费。 */
export function isEscConsumed(event: KeyboardEvent): boolean {
  return (event as EscMarkedEvent)[escConsumedFlag] === true;
}

/** 由最内层调用：标记这次 Esc 已被消费，外层界面应各自让路。 */
export function consumeEsc(event: KeyboardEvent): void {
  (event as EscMarkedEvent)[escConsumedFlag] = true;
}

/** 事件目标是否位于底部面板内（终端聚焦时按键归终端程序，日志视图内不穿透）。 */
export function isEventInBottomPanel(event: KeyboardEvent): boolean {
  return (event.target as HTMLElement | null)?.closest(BOTTOM_PANEL_SELECTOR) != null;
}