import { useLayoutEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { errorText, issueText, outcomeText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import { Modal } from "../../shared/Modal";
import { useIpcResource } from "../../shared/useIpcResource";
import type { GateReportDto } from "../../shared/types";

interface BranchDescriptionDialogProps {
  branch: string;
  onCancel: () => void;
  onSaved: (message: string) => void;
}

/** 分支描述编辑器：写入 local config，留空保存等价于删除。 */
export function BranchDescriptionDialog({
  branch,
  onCancel,
  onSaved,
}: BranchDescriptionDialogProps) {
  const { t } = useI18n();
  const { data, loading, error: loadError } = useIpcResource(
    [branch],
    () => ipc.readBranchDescription(branch),
  );
  const [text, setText] = useState("");
  const [shared, setShared] = useState(false);
  const [gate, setGate] = useState<GateReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 读取结果到达后回填编辑器；layoutEffect 让回填与数据帧同批渲染，避免先闪一帧空输入框。
  useLayoutEffect(() => {
    if (data) {
      setText(data.description);
      setShared(data.shared_across_worktrees);
    }
  }, [data]);

  const save = async () => {
    if (saving || loading || loadError) {
      return;
    }
    setSaving(true);
    setGate(null);
    setError(null);
    try {
      const report = await ipc.validateWrite({
        kind: "set_branch_description",
        branch,
        description: text,
      });
      setGate(report);
      if (!report.ok) {
        return;
      }
      const outcome = await ipc.executeWrite({
        kind: "set_branch_description",
        branch,
        description: text,
      });
      if (outcome.status === "succeeded") {
        onSaved(outcomeText(outcome));
        return;
      }
      setError(outcome.stderr?.trim() || outcomeText(outcome));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal className="confirm-dialog description-dialog">
      <header>
        <h2>{t("write.descriptionTitle")}</h2>
        <button
          className="detail-close"
          onClick={onCancel}
          aria-label={t("write.descriptionCloseAria")}
        >
          ×
        </button>
      </header>

      <section>
        <p className="confirm-target">
          <span className="mono">{branch}</span>
        </p>
        <p className="muted confirm-hint">
          {t("write.descriptionHintPrefix")}
          <span className="mono">git config --local branch.{branch}.description</span>
          {t("write.descriptionHintSuffix")}
        </p>
        {loading ? (
          <p className="muted">{t("write.descriptionLoading")}</p>
        ) : (
          <textarea
            className="description-input"
            rows={5}
            autoFocus
            disabled={saving || Boolean(loadError)}
            placeholder={t("write.descriptionPlaceholder")}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        )}
        {shared && (
          <p className="muted confirm-hint">{t("write.descriptionSharedHint")}</p>
        )}
        {loadError && <p className="danger-text">{loadError}</p>}
        {gate && !gate.ok && (
          <div className="gate-report">
            <p className="danger-text">{t("write.gateFailedPrefix")}</p>
            <ul className="gate-issues">
              {gate.issues.map((issue) => (
                <li key={`${issue.code}:${issue.message}`}>{issueText(issue)}</li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="danger-text">{error}</p>}
      </section>

      <footer>
        <button onClick={onCancel} disabled={saving}>
          {t("write.cancel")}
        </button>
        <button
          className="primary"
          onClick={() => void save()}
          disabled={loading || saving || Boolean(loadError)}
        >
          {saving ? t("write.saving") : t("write.save")}
        </button>
      </footer>
    </Modal>
  );
}
