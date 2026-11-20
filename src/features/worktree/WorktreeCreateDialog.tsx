import { useCallback, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../../i18n";
import { errorText, outcomeText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import { Modal } from "../../shared/Modal";
import { Select } from "../../shared/Select";
import type { RepoStateDto, WriteRequest } from "../../shared/types";
import { useEscClose } from "../../shared/useEscClose";
import { GateReportView } from "../write/GateReportView";
import { useGatePreview } from "../write/useGatePreview";

interface WorktreeCreateDialogProps {
  repo: RepoStateDto;
  onClose: () => void;
  /** 创建成功：调用方展示结果文案并刷新列表。 */
  onCreated: (message: string) => Promise<void>;
}

/**
 * 新建 linked worktree（ADR-0034）：源分支取自本地分支，目标目录只能经原生
 * 目录选择器获得；Gate 摘要即 `git worktree add <path> <branch>` 的说明，
 * 通过后才允许执行。
 */
export function WorktreeCreateDialog({ repo, onClose, onCreated }: WorktreeCreateDialogProps) {
  const { t } = useI18n();
  const [branch, setBranch] = useState("");
  const [targetPath, setTargetPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;

  useEscClose(onClose, busy);

  const branches = useMemo(
    () => repo.refs.filter((ref) => ref.kind === "local_branch"),
    [repo.refs],
  );
  // 信息不全时不发校验请求；目录或分支变化会由 useGatePreview 重新检查。
  const request = useMemo<WriteRequest | null>(
    () => (targetPath && branch ? { kind: "create_worktree", path: targetPath, branch } : null),
    [branch, targetPath],
  );
  const preview = useGatePreview(request);

  const pickDirectory = useCallback(async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t("worktree.pickDialogTitle"),
      });
      if (typeof selected === "string") {
        setTargetPath(selected);
        setExecError(null);
      }
    } catch (err) {
      setExecError(errorText(err));
    }
  }, [t]);

  const execute = useCallback(async () => {
    // 同步占用：连点时第二次调用在重渲染前就会命中这里。
    if (busyRef.current || !targetPath || !branch || !preview.gate?.ok) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setExecError(null);
    try {
      const outcome = await ipc.createWorktree(targetPath, branch);
      if (outcome.status !== "succeeded") {
        setExecError([outcomeText(outcome), outcome.stderr?.trim()].filter(Boolean).join("\n\n"));
        return;
      }
      await onCreated(outcomeText(outcome));
      onClose();
    } catch (err) {
      setExecError(errorText(err));
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }, [branch, onClose, onCreated, preview.gate, targetPath]);

  const blocked = busy || !targetPath || !branch || !preview.gate?.ok;

  return (
    <Modal
      className="confirm-dialog worktree-dialog"
      onBackdropClick={() => {
        // 执行中不允许关闭：请求已发出，关掉对话框不会撤销写操作。
        if (!busy) {
          onClose();
        }
      }}
    >
      <header>
        <div>
          <h2>{t("worktree.createTitle")}</h2>
          <p className="muted settings-hint">{t("worktree.createSubtitle")}</p>
        </div>
        <button
          className="detail-close"
          onClick={onClose}
          disabled={busy}
          aria-label={t("write.closeDialogAria")}
        >
          ×
        </button>
      </header>

      <section className="worktree-form">
        <label className="ref-field-label" htmlFor="worktree-branch">
          {t("worktree.branchLabel")}
        </label>
        {branches.length === 0 ? (
          <p className="muted confirm-hint">{t("worktree.noBranches")}</p>
        ) : (
          <Select
            id="worktree-branch"
            block
            disabled={busy}
            value={branch}
            options={[
              { value: "", label: t("worktree.branchPlaceholder") },
              ...branches.map((ref) => ({ value: ref.short_name, label: ref.short_name })),
            ]}
            onChange={(event) => setBranch(event.target.value)}
          />
        )}

        <span className="ref-field-label">{t("worktree.pathLabel")}</span>
        <div className="worktree-path-row">
          <span
            className={targetPath ? "worktree-path-box mono" : "worktree-path-box mono muted"}
            title={targetPath ?? undefined}
          >
            {targetPath ?? t("worktree.pathPlaceholder")}
          </span>
          <button type="button" onClick={() => void pickDirectory()} disabled={busy}>
            {t("worktree.pickDirectory")}
          </button>
        </div>

        {targetPath && branch && (
          <p className="worktree-command mono">
            {t("worktree.commandPreview", { path: targetPath, branch })}
          </p>
        )}
        <p className="muted confirm-hint">{t("worktree.createHint")}</p>
      </section>

      {request && (
        <GateReportView
          gate={preview.gate}
          gateError={preview.gateError}
          validating={preview.validating}
        />
      )}

      {execError && (
        <section>
          <p className="danger-text">{execError}</p>
        </section>
      )}

      <footer>
        <button onClick={onClose} disabled={busy}>
          {t("write.cancel")}
        </button>
        <button className="primary" onClick={() => void execute()} disabled={blocked}>
          {busy ? t("worktree.creating") : t("worktree.createSubmit")}
        </button>
      </footer>
    </Modal>
  );
}
