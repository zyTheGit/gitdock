import { i18next } from "../i18n";
import { CommandError } from "./ipc";
import type {
  GateIssueDto,
  GateReportDto,
  InterruptionKind,
  WarningDto,
  WriteOutcomeDto,
} from "./types";

type LooseTranslate = (
  key: string,
  options?: Record<string, string | number | undefined>,
) => string;

const looseT = i18next.t as LooseTranslate;

function snakeToCamel(code: string): string {
  return code.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** 按 code 查 errors 域（code 转 camelCase）；无翻译（返回 key 原文）时回落兜底。 */
function byCode(
  code: string,
  args: Record<string, string> | null | undefined,
  fallback: string,
): string {
  const key = `errors.${snakeToCamel(code)}`;
  const translated = looseT(key, args ?? {});
  return translated !== key ? translated : fallback;
}

/** 错误 → 用户可见文本；Rust 标注了 i18n key 时优先本地化，缺失翻译回落 message。 */
export function errorText(err: unknown): string {
  if (err instanceof CommandError) {
    let base: string;
    if (err.key) {
      const translated = looseT(err.key, err.args ?? {});
      base = translated !== err.key ? translated : err.message;
    } else {
      base = err.message;
    }
    return err.detail ? `${base}（${err.detail}）` : base;
  }
  return String(err);
}

/** WarningDto → 本地化文本；code+args 优先，缺失翻译回落 message。 */
export function warningText(warning: WarningDto): string {
  return byCode(warning.code, warning.args, warning.message);
}

/** GateIssueDto → 本地化文本；code+args 优先，缺失翻译回落 message。 */
export function issueText(issue: GateIssueDto): string {
  return byCode(issue.code, issue.args, issue.message);
}

/** GateReportDto 摘要 → 本地化文本；summary_key+args 优先，缺失回落 summary。 */
export function gateSummaryText(gate: GateReportDto): string {
  if (gate.summary_key) {
    const translated = looseT(gate.summary_key, gate.summary_args ?? {});
    if (translated !== gate.summary_key) return translated;
  }
  return gate.summary;
}

/** 写操作结果 → 本地化文本；key+args 优先，缺失翻译回落 message。 */
export function outcomeText(outcome: WriteOutcomeDto): string {
  if (outcome.key) {
    const translated = looseT(outcome.key, outcome.args ?? {});
    if (translated !== outcome.key) return translated;
  }
  return outcome.message;
}

const KIND_KEYS: Record<InterruptionKind, string> = {
  merge: "errors.kindMerge",
  cherry_pick: "errors.kindCherryPick",
  revert: "errors.kindRevert",
  rebase: "errors.kindRebase",
  sequencer: "errors.kindSequencer",
  index_lock: "errors.kindIndexLock",
};

/** 中断态标题：「检测到未完成的 Git 操作：…」；名称列表按当前语言拼接。 */
export function interruptionText(kinds: InterruptionKind[]): string {
  const separator = looseT("errors.kindSeparator");
  const names = kinds.map((kind) => looseT(KIND_KEYS[kind])).join(separator);
  return looseT("errors.interruptionDetected", { names });
}

/** 终端接管提示；优先级与 Rust 侧一致（锁 > cherry-pick > revert > rebase > merge）。 */
export function interruptionHintText(kinds: InterruptionKind[]): string {
  if (kinds.includes("index_lock")) return looseT("errors.hintIndexLock");
  if (kinds.includes("cherry_pick")) return looseT("errors.hintCherryPick");
  if (kinds.includes("revert")) return looseT("errors.hintRevert");
  if (kinds.includes("rebase")) return looseT("errors.hintRebase");
  if (kinds.includes("merge")) return looseT("errors.hintMerge");
  return looseT("errors.hintGeneral");
}
