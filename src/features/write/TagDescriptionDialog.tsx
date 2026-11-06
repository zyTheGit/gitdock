import { useState } from "react";
import { useI18n } from "../../i18n";
import { errorText, issueText, outcomeText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import { Modal } from "../../shared/Modal";
import { useEscClose } from "../../shared/useEscClose";
import type { GateReportDto } from "../../shared/types";

interface TagDescriptionDialogProps {
  tag: string;
  /** 当前附注消息；轻量标签为空串。 */
  description: string;
  onCancel: () => void;
  onSaved: (message: string) => void;
}

/** 标签描述即附注标签消息：非空保存重建附注标签，留空保存改为轻量标签。 */
export function TagDescriptionDialog({
  tag,
  description,
  onCancel,
  onSaved,
}: TagDescriptionDialogProps) {
  const { t } = useI18n();
  const [text, setText] = useState(description);
  const [gate, setGate] = useState<GateReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEscClose(onCancel, saving);

  const save = async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    setGate(null);
    setError(null);
    try {
      const request = { kind: "set_tag_description" as const, branch: tag, description: text };
      const report = await ipc.validateWrite(request);
      setGate(report);
      if (!report.ok) {
        return;
      }
      const outcome = await ipc.executeWrite(request);
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

  const changed = text.trim() !== description.trim();

  return (
    <Modal className="confirm-dialog description-dialog">
      <header>
        <h2>{t("write.descriptionTagTitle")}</h2>
        <button
          className="detail-close"
          onClick={onCancel}
          disabled={saving}
          aria-label={t("write.descriptionTagCloseAria")}
        >
          ×
        </button>
      </header>

      <section>
        <p className="confirm-target">
          <span className="mono">{tag}</span>
        </p>
        <p className="muted confirm-hint">
          {t("write.descriptionTagHintPrefix")}
          <span className="mono">git tag -a</span>
          {t("write.descriptionTagHintSuffix")}
        </p>
        <textarea
          className="description-input"
          rows={6}
          autoFocus
          disabled={saving}
          placeholder={t("write.descriptionTagPlaceholder")}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <p className="muted confirm-hint">{t("write.descriptionTagRewriteHint")}</p>
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
          disabled={!changed || saving}
        >
          {saving ? t("write.saving") : t("write.save")}
        </button>
      </footer>
    </Modal>
  );
}
