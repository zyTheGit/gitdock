import { useCallback, useRef, useState } from "react";
import { errorText, outcomeText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import type {
  GateIssueDto,
  GateReportDto,
  StagingStatusDto,
  WarningDto,
  WriteRequest,
} from "../../shared/types";

/** 冲突解决的三个受限动作（ADR-0033），请求复用 `WriteRequest.path`（单路径）。 */
export type ConflictAction =
  | "resolve_conflict_ours"
  | "resolve_conflict_theirs"
  | "mark_conflict_resolved";

/** 待处理目标：一行冲突文件 + 一个动作。 */
export interface ConflictTarget {
  path: string;
  action: ConflictAction;
}

/**
 * 确认框阶段：`confirm` 是动作本身的确认；`markers` 表示文件仍含冲突标记，
 * 需要第二次显式确认才允许执行 `mark_conflict_resolved`。
 */
export type ConflictStage = "confirm" | "markers";

/** 残留冲突标记的 Gate 警告 code（非阻断，Gate 仍为 ok）。 */
const MARKERS_WARNING = "conflict_markers_present";

/** 冲突解决流程的外部依赖：暂存状态归 StagingView 所有，本 hook 只编排确认与执行。 */
export interface ConflictFlowOptions {
  /** 写互斥/加载中：此时不接受新的冲突动作。 */
  disabled: boolean;
  /** 已有写操作在跑（stage/unstage/提交/静默重载）。 */
  isBusy: () => boolean;
  /** 运行期间置暂存区忙碌，复用既有 busy 状态与 busyRef 互斥。 */
  setBusy: (busy: boolean) => void;
  setError: (message: string | null) => void;
  /** 静默重读暂存状态：成功后冲突分组、横幅与「继续」按钮随之更新。 */
  reload: () => Promise<StagingStatusDto | null>;
  /** 成功后的统一收尾：toast + 工作区快照 + 图谱刷新。 */
  onMutated: (message: string) => Promise<void>;
}

export interface ConflictFlow {
  /** 待确认目标；非 null 表示确认框打开。 */
  pending: ConflictTarget | null;
  /** 当前确认阶段（残留标记时为 markers）。 */
  stage: ConflictStage;
  /** 最近一次 Gate 报告（确认后才产生）。 */
  gate: GateReportDto | null;
  /** Gate 未通过时的拒绝原因。 */
  issues: GateIssueDto[] | null;
  /** `conflict_markers_present` 警告（可能多条，每条带 path）。 */
  markers: WarningDto[];
  /** 执行失败/被拒或调用异常的说明（含 stderr）。 */
  error: string | null;
  validating: boolean;
  busy: boolean;
  /** 行内按钮级忙碌：只有被点的那颗按钮显示 loading。 */
  busyTarget: ConflictTarget | null;
  open: (path: string, action: ConflictAction) => void;
  cancel: () => void;
  confirm: () => Promise<void>;
}

/**
 * 冲突解决编排（ADR-0033）：打开确认框 → `validate_write` → （残留标记再确认一次）
 * → `execute_write` → 重读暂存状态 + 既有刷新通道。绝不自动 continue / abort，
 * 也绝不把 checkout 与 add 合并成一步（ADR-0033 §2.2）。
 */
export function useConflictFlow(options: ConflictFlowOptions): ConflictFlow {
  const [pending, setPending] = useState<ConflictTarget | null>(null);
  const [stage, setStage] = useState<ConflictStage>("confirm");
  const [gate, setGate] = useState<GateReportDto | null>(null);
  const [issues, setIssues] = useState<GateIssueDto[] | null>(null);
  const [markers, setMarkers] = useState<WarningDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyTarget, setBusyTarget] = useState<ConflictTarget | null>(null);

  // 回调经 ref 读取，避免 hook 因上层每次渲染产生的新闭包而重建。
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const runningRef = useRef(false);

  const reset = () => {
    setPending(null);
    setStage("confirm");
    setGate(null);
    setIssues(null);
    setMarkers([]);
    setError(null);
  };

  const open = useCallback((path: string, action: ConflictAction) => {
    const { disabled, isBusy } = optionsRef.current;
    if (path.length === 0 || runningRef.current || disabled || isBusy()) {
      return;
    }
    setPending({ path, action });
    setStage("confirm");
    setGate(null);
    setIssues(null);
    setMarkers([]);
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
    if (!pending || runningRef.current) {
      return;
    }
    const opts = optionsRef.current;
    if (opts.disabled || opts.isBusy()) {
      return;
    }
    const request: WriteRequest = { kind: pending.action, path: pending.path };

    runningRef.current = true;
    opts.setBusy(true);
    setValidating(true);
    setBusyTarget(pending);
    opts.setError(null);
    setIssues(null);
    setError(null);
    try {
      const report = await ipc.validateWrite(request);
      setGate(report);
      const found = report.warnings.filter((warning) => warning.code === MARKERS_WARNING);
      setMarkers(found);
      if (!report.ok) {
        setIssues(report.issues);
        return;
      }
      // 仍含冲突标记：Gate 保持 ok，但必须在执行前再确认一次。
      if (pending.action === "mark_conflict_resolved" && found.length > 0 && stage === "confirm") {
        setStage("markers");
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
      // 先重读冲突分组，再走既有 mutate 通道（toast + 快照 + 图谱刷新）。
      await opts.reload();
      await opts.onMutated(message);
      reset();
    } catch (err) {
      setError(errorText(err));
    } finally {
      runningRef.current = false;
      setValidating(false);
      setBusy(false);
      setBusyTarget(null);
      opts.setBusy(false);
    }
  }, [pending, stage]);

  return {
    pending,
    stage,
    gate,
    issues,
    markers,
    error,
    validating,
    busy,
    busyTarget,
    open,
    cancel,
    confirm,
  };
}
