import { Modal } from "../../shared/Modal";
import type { CommitSummaryDto, GateReportDto, WriteKind } from "../../shared/types";

type DialogKind = Extract<WriteKind, "cherry_pick" | "revert" | "switch_branch">;

const ACTION_LABEL: Record<DialogKind, string> = {
  cherry_pick: "Cherry Pick",
  revert: "Revert",
  switch_branch: "切换分支",
};

const ACTION_HINT: Record<DialogKind, string> = {
  cherry_pick: "将在当前 HEAD 上重放该提交；merge commit 不受支持。",
  revert: "将生成一个反向提交，提交说明由 Git 自动生成。",
  switch_branch:
    "仅切换到已存在的本地分支（git switch --no-guess），不会创建分支或猜测远程分支；存在改动时不会自动 stash、reset 或 clean。",
};

interface ConfirmWriteDialogProps {
  kind: DialogKind;
  commit?: CommitSummaryDto;
  branch?: string;
  gate: GateReportDto | null;
  gateError?: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** 写操作确认框：先展示 Gate 结论，Gate 未通过时禁止执行。 */
export function ConfirmWriteDialog({
  kind,
  commit,
  branch,
  gate,
  gateError,
  busy,
  onCancel,
  onConfirm,
}: ConfirmWriteDialogProps) {
  const label = ACTION_LABEL[kind];
  const blocked = Boolean(gateError) || !gate?.ok;

  return (
    <Modal className="confirm-dialog">
      <header>
        <h2>{label} 确认</h2>
        <button className="detail-close" onClick={onCancel} aria-label="关闭确认框">
          ×
        </button>
      </header>

      <section>
        {commit ? (
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
        <p className="muted confirm-hint">{ACTION_HINT[kind]}</p>
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
        {gate?.is_merge_commit && (
          <p className="muted">该提交是 merge commit，命令行的 -m 父选择在 P1 提供。</p>
        )}
      </section>

      <footer>
        <button onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button className="primary" onClick={onConfirm} disabled={blocked || busy}>
          {busy ? "执行中…" : `执行 ${label}`}
        </button>
      </footer>
    </Modal>
  );
}
