import { useCallback, useRef, useState } from "react";
import { errorText, outcomeText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import type { GateIssueDto, GateReportDto, StagingStatusDto } from "../../shared/types";

/**
 * 丢弃流程的外部依赖：暂存区状态归 StagingView 所有，本 hook 只编排
 * 「确认框 → Gate → 执行 → 收尾」，不直接读写仓库。
 */
export interface DiscardFlowOptions {
  /** 写互斥/加载中：此时不接受新的丢弃请求。 */
  disabled: boolean;
  /** 已有写操作在跑（stage/unstage/提交/静默重载）。 */
  isBusy: () => boolean;
  /** 运行期间置暂存区忙碌，复用既有 busy 状态与 busyRef 互斥。 */
  setBusy: (busy: boolean) => void;
  setError: (message: string | null) => void;
  /** 静默重读暂存状态（成功后刷新列表，由既有副作用校正失效选中）。 */
  reload: () => Promise<StagingStatusDto | null>;
  /** 清空勾选（成功后）。 */
  clearChecked: () => void;
  /** 成功后的统一收尾：toast + 工作区快照 + 图谱刷新。 */
  onMutated: (message: string) => Promise<void>;
}

export interface DiscardFlow {
  /** 待丢弃路径；非 null 表示确认框打开。 */
  pending: string[] | null;
  /** 最近一次 Gate 报告（确认后才产生），用于展示受影响文件清单。 */
  gate: GateReportDto | null;
  /** Gate 未通过时的拒绝原因。 */
  issues: GateIssueDto[] | null;
  /** 执行失败/被拒或调用异常的说明（含 stderr）。 */
  error: string | null;
  validating: boolean;
  busy: boolean;
  open: (paths: string[]) => void;
  cancel: () => void;
  confirm: () => Promise<void>;
}

/**
 * 丢弃未暂存改动的编排（ADR 0026）：先 `validate_write` 再 `execute_write`，
 * Gate 不通过或执行失败都留在确认框内展示原因，只有成功才关闭并刷新。
 */
export function useDiscardFlow(options: DiscardFlowOptions): DiscardFlow {
  const [pending, setPending] = useState<string[] | null>(null);
  const [gate, setGate] = useState<GateReportDto | null>(null);
  const [issues, setIssues] = useState<GateIssueDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [busy, setBusy] = useState(false);

  // 回调经 ref 读取，避免 hook 因上层每次渲染产生的新闭包而重建。
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const runningRef = useRef(false);

  const reset = () => {
    setPending(null);
    setGate(null);
    setIssues(null);
    setError(null);
  };

  const open = useCallback((paths: string[]) => {
    const deduped = [...new Set(paths.filter((path) => path.length > 0))];
    if (deduped.length === 0) {
      return;
    }
    const { disabled, isBusy } = optionsRef.current;
    if (disabled || isBusy()) {
      return;
    }
    setPending(deduped);
    setGate(null);
    setIssues(null);
    setError(null);
  }, []);

  const cancel = useCallback(() => {
    if (runningRef.current) {
      return;
    }
    reset();
  }, []);

  const confirm = useCallback(async () => {
    // 异步按钮规则：执行中再次进入直接返回，不重复发请求。
    if (!pending || pending.length === 0 || runningRef.current) {
      return;
    }
    const { disabled, isBusy } = optionsRef.current;
    if (disabled || isBusy()) {
      return;
    }
    const { setBusy: setViewBusy, setError: setViewError, reload, clearChecked, onMutated } =
      optionsRef.current;

    runningRef.current = true;
    setViewBusy(true);
    setValidating(true);
    setViewError(null);
    setIssues(null);
    setError(null);
    try {
      const request = { kind: "discard_files" as const, paths: pending };
      const report = await ipc.validateWrite(request);
      setGate(report);
      if (!report.ok) {
        setIssues(report.issues);
        return;
      }
      setValidating(false);
      setBusy(true);
      const outcome = await ipc.executeWrite(request);
      if (outcome.status !== "succeeded") {
        setError([outcomeText(outcome), outcome.stderr?.trim()].filter(Boolean).join("\n\n"));
        return;
      }
      const message = outcomeText(outcome);
      clearChecked();
      await reload();
      await onMutated(message);
      reset();
    } catch (err) {
      setError(errorText(err));
    } finally {
      runningRef.current = false;
      setValidating(false);
      setBusy(false);
      setViewBusy(false);
    }
  }, [pending]);

  return { pending, gate, issues, error, validating, busy, open, cancel, confirm };
}
