import { Modal } from "../../shared/Modal";
import type { CommitSummaryDto, GateReportDto, WriteKind } from "../../shared/types";

type DialogKind = Extract<
  WriteKind,
  "cherry_pick" | "revert" | "switch_branch" | "continue_operation" | "abort_operation"
>;

const ACTION_LABEL: Record<DialogKind, string> = {
  cherry_pick: "Cherry Pick",
  revert: "Revert",
  switch_branch: "切换分支",
  continue_operation: "继续操作",
  abort_operation: "中止操作",
};

const ACTION_HINT: Record<DialogKind, string> = {
  cherry_pick: "将在当前 HEAD 上重放该提交；merge commit 需在下方选择基线父提交。",
  revert: "将生成一个反向提交，提交说明由 Git 自动生成；merge commit 需在下方选择基线父提交。",
  switch_branch:
    "仅切换到已存在的本地分支（git switch --no-guess），不会创建分支或猜测远程分支；存在改动时不会自动 stash、reset 或 clean。",
  continue_operation:
    "将完成当前中断的操作。请先在终端解决全部冲突并 git add；若结果为空提交，Git 会失败并保留中断标记，此时需在终端执行 --skip 跳过本次操作（本应用不会自动跳过）。",
  abort_operation: "将回到操作开始前的状态，已手工解决的冲突内容会丢失。",
};

const CONFIRM_LABEL: Partial<Record<DialogKind, string>> = {
  continue_operation: "继续并完成操作",
  abort_operation: "中止并丢弃冲突解决",
};

const DIALOG_TITLE: Partial<Record<DialogKind, string>> = {
  continue_operation: "继续操作确认",
  abort_operation: "中止操作确认",
};

const INTERRUPTION_LABEL: Record<"cherry_pick" | "revert", string> = {
  cherry_pick: "Cherry Pick",
  revert: "Revert",
};

interface ConfirmWriteDialogProps {
  kind: DialogKind;
  commit?: CommitSummaryDto;
  branch?: string;
  /** continue/abort 对应的中断类型；存在时不显示提交目标行。 */
  interruption?: "cherry_pick" | "revert";
  gate: GateReportDto | null;
  gateError?: string;
  /** 正在重新检查（例如改选父提交）；期间不得放行执行。 */
  validating: boolean;
  /** merge commit 的基线父序号（1 起始），由写流程维护。 */
  mainline: number;
  onMainlineChange: (mainline: number) => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** 写操作确认框：先展示 Gate 结论，Gate 未通过时禁止执行。 */
export function ConfirmWriteDialog({
  kind,
  commit,
  branch,
  interruption,
  gate,
  gateError,
  validating,
  mainline,
  onMainlineChange,
  busy,
  onCancel,
  onConfirm,
}: ConfirmWriteDialogProps) {
  const label = ACTION_LABEL[kind];
  const blocked = Boolean(gateError) || !gate?.ok || validating;
  const destructive = kind === "abort_operation";

  return (
    <Modal className="confirm-dialog">
      <header>
        <h2>{DIALOG_TITLE[kind] ?? `${label} 确认`}</h2>
        <button className="detail-close" onClick={onCancel} aria-label="关闭确认框">
          ×
        </button>
      </header>

      <section>
        {interruption ? (
          <p className="confirm-target">
            <span className="muted">中断的操作</span>
            <span className="mono">{INTERRUPTION_LABEL[interruption]}</span>
          </p>
        ) : commit ? (
          <p className="confirm-target">
            <span className="mono">{commit.short_oid}</span>
            <span className="confirm-summary" title={commit.summary}>
              {commit.summary}
            </span>
          </p>
        ) : (
          <p className="confirm-target">
            <span className="mono">{branch ?? ""}</span>
          </p>
        )}
        <p className={destructive ? "danger-text confirm-hint" : "muted confirm-hint"}>
          {ACTION_HINT[kind]}
        </p>
      </section>

      <section className="gate-report">
        <h3>写前检查</h3>
        {gateError ? (
          <p className="danger-text">{gateError}</p>
        ) : !gate ? (
          <p className="muted">正在检查工作区与仓库状态…</p>
        ) : gate.ok ? (
          <p className="gate-ok">{gate.summary}</p>
        ) : (
          <>
            <p className="danger-text">写前检查未通过：</p>
            <ul className="gate-issues">
              {gate.issues.map((issue) => (
                <li key={`${issue.code}:${issue.message}`}>{issue.message}</li>
              ))}
            </ul>
          </>
        )}
        {validating && gate && <p className="muted">正在按当前选择重新检查…</p>}
        {gate?.warnings.map((warning) => (
          <p className="gate-warning" key={`${warning.code}:${warning.message}`}>
            {warning.message}
          </p>
        ))}
        {gate && gate.affected_paths.length > 0 && (
          <div className="gate-affected">
            <p className="muted">
              受影响文件（{gate.affected_total}）
              {gate.affected_total > gate.affected_paths.length
                ? `，仅列出前 ${gate.affected_paths.length} 项`
                : ""}
              ：
            </p>
            <ul className="gate-paths">
              {gate.affected_paths.map((path) => (
                <li className="mono" key={path}>
                  {path}
                </li>
              ))}
            </ul>
          </div>
        )}
        {gate?.is_merge_commit &&
          (gate.parents.length > 0 ? (
            <fieldset className="mainline-picker">
              <legend className="muted">以第几父提交为基线（-m N）</legend>
              {gate.parents.map((parent, index) => {
                const ordinal = index + 1;
                return (
                  <label className="mainline-option" key={parent.oid}>
                    <input
                      type="radio"
                      name="write-mainline"
                      value={ordinal}
                      checked={mainline === ordinal}
                      disabled={busy}
                      onChange={() => onMainlineChange(ordinal)}
                    />
                    <span>第 {ordinal} 父</span>
                    <span className="mono">{parent.short_oid}</span>
                    <span className="confirm-summary" title={parent.summary}>
                      {parent.summary || "（无提交说明）"}
                    </span>
                  </label>
                );
              })}
              <p className="muted">共 {gate.parents.length} 个父提交；改选后会自动重新检查。</p>
            </fieldset>
          ) : (
            <p className="muted">该提交是 merge commit，但未返回父提交列表，请在终端使用 -m 执行。</p>
          ))}
      </section>

      <footer>
        <button onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button className="primary" onClick={onConfirm} disabled={blocked || busy}>
          {busy ? "执行中…" : (CONFIRM_LABEL[kind] ?? `执行 ${label}`)}
        </button>
      </footer>
    </Modal>
  );
}
