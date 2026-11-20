import { useState } from "react";
import { Icon } from "../../assets/icons";
import { useI18n } from "../../i18n";

/**
 * FileDiffView 的 hunk 操作回调（ADR 0027）。只有暂存区传入；提交详情与对比
 * 视图不传，hunk 头部因此保持纯只读。每个回调对应当前 diff 的一侧：
 * 未暂存侧给 `onStage` / `onDiscard`，已暂存侧给 `onUnstage`。
 */
export interface HunkActionsConfig {
  /** 暂存这一块（未暂存侧）。 */
  onStage?: (index: number) => Promise<void> | void;
  /** 取消暂存这一块（已暂存侧）。 */
  onUnstage?: (index: number) => Promise<void> | void;
  /** 丢弃这一块（未暂存侧）；破坏性确认由调用方负责。 */
  onDiscard?: (index: number) => Promise<void> | void;
  /** 任一 hunk 操作进行中：全部按钮禁用。 */
  disabled?: boolean;
}

type ActionKind = "stage" | "unstage" | "discard";

const ACTION_ICON = {
  stage: "stage",
  unstage: "upload",
  discard: "trash",
} as const;

interface HunkActionButtonsProps {
  /** 0 起始的块序号（与后端 hunk_index 一致）。 */
  index: number;
  /** 当前 diff 的块总数，仅用于 tooltip。 */
  total: number;
  actions?: HunkActionsConfig;
}

/** 单块的紧凑操作按钮组：图标 + 短文案，aria-label 带「第 n 块」上下文。 */
export function HunkActionButtons({ index, total, actions }: HunkActionButtonsProps) {
  const { t } = useI18n();
  const [pending, setPending] = useState<ActionKind | null>(null);

  if (!actions) {
    return null;
  }

  const ordinal = index + 1;
  const blocked = Boolean(actions.disabled) || pending !== null;

  const run = (kind: ActionKind, handler?: (value: number) => Promise<void> | void) => {
    if (!handler || blocked) {
      return;
    }
    setPending(kind);
    void (async () => {
      try {
        await handler(index);
      } finally {
        setPending(null);
      }
    })();
  };

  return (
    <span
      className="hunk-actions"
      role="group"
      aria-label={t("diff.hunkActionsGroup", { n: ordinal })}
    >
      {actions.onStage && (
        <button
          type="button"
          className="hunk-action"
          disabled={blocked}
          aria-busy={pending === "stage"}
          onClick={() => run("stage", actions.onStage)}
          title={t("diff.hunkStageTitle", { n: ordinal, total })}
          aria-label={t("diff.hunkStageTitle", { n: ordinal, total })}
        >
          <Icon name={ACTION_ICON.stage} />
          <span>{pending === "stage" ? t("diff.hunkRunning") : t("diff.hunkStage")}</span>
        </button>
      )}
      {actions.onUnstage && (
        <button
          type="button"
          className="hunk-action"
          disabled={blocked}
          aria-busy={pending === "unstage"}
          onClick={() => run("unstage", actions.onUnstage)}
          title={t("diff.hunkUnstageTitle", { n: ordinal, total })}
          aria-label={t("diff.hunkUnstageTitle", { n: ordinal, total })}
        >
          <Icon name={ACTION_ICON.unstage} />
          <span>{pending === "unstage" ? t("diff.hunkRunning") : t("diff.hunkUnstage")}</span>
        </button>
      )}
      {actions.onDiscard && (
        <button
          type="button"
          className="hunk-action danger"
          disabled={blocked}
          aria-busy={pending === "discard"}
          onClick={() => run("discard", actions.onDiscard)}
          title={t("diff.hunkDiscardTitle", { n: ordinal, total })}
          aria-label={t("diff.hunkDiscardTitle", { n: ordinal, total })}
        >
          <Icon name={ACTION_ICON.discard} />
          <span>{pending === "discard" ? t("diff.hunkRunning") : t("diff.hunkDiscard")}</span>
        </button>
      )}
    </span>
  );
}

interface HunkHeaderRowProps {
  /** `@@ -a,b +c,d @@` 原文。 */
  content: string;
  index: number;
  total: number;
  /** 统一 / 并排视图的列数；表格行需横跨整行。 */
  colSpan: number;
  actions?: HunkActionsConfig;
}

/**
 * react-diff-view 的 `<Hunk>` 不渲染 `@@` 头部，hunk 操作按钮需要一个宿主行：
 * 在 `<table>` 里补一个 `<tbody>`，与各 hunk 的 tbody 平级，列数与视图一致。
 */
export function HunkHeaderRow({ content, index, total, colSpan, actions }: HunkHeaderRowProps) {
  return (
    <tbody className="diff-hunk-head">
      <tr>
        <td className="diff-hunk-head-cell" colSpan={colSpan}>
          <span className="diff-hunk-head-inner">
            <span className="diff-hunk-head-text mono">{content}</span>
            <HunkActionButtons index={index} total={total} actions={actions} />
          </span>
        </td>
      </tr>
    </tbody>
  );
}
