import { useState } from "react";
import { useI18n } from "../../i18n";
import { copyText } from "../../shared/clipboard";
import { errorText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import type { AppInfoDto } from "../../shared/types";
import { Modal } from "../../shared/Modal";

interface FeedbackDialogProps {
  info: AppInfoDto;
  onClose: () => void;
  onError: (message: string) => void;
}

/** 只预填应用版本、操作系统与 Git 版本；不含日志、仓库路径，提交动作由用户在浏览器完成。 */
export function FeedbackDialog({ info, onClose, onError }: FeedbackDialogProps) {
  const { t } = useI18n();
  // Issue 标题与正文模板暂不迁移：发给 GitHub 的内容语言待产品裁决。
  const [title, setTitle] = useState(`[反馈] GitDock ${info.app_version}`);
  const [body, setBody] = useState(
    [
      "请描述你遇到的问题或建议：",
      "",
      "",
      "---",
      `应用版本：${info.app_version}`,
      `操作系统：${info.platform}`,
      `Git 版本：${info.git_version ?? "未知"}`,
    ].join("\n"),
  );
  const [copied, setCopied] = useState(false);
  const [opening, setOpening] = useState(false);

  const copy = async () => {
    const ok = await copyText(`${title}\n\n${body}`);
    setCopied(ok);
  };

  const open = async () => {
    setOpening(true);
    try {
      await ipc.openFeedbackIssue(title, body);
      onClose();
    } catch (err) {
      onError(errorText(err));
    } finally {
      setOpening(false);
    }
  };

  return (
    <Modal className="feedback-dialog">
      <header>
        <h2>{t("settings.feedbackTitle")}</h2>
        <button className="detail-close" onClick={onClose} aria-label={t("settings.feedbackCloseAria")}>
          ×
        </button>
      </header>
      <p className="muted settings-hint">{t("settings.feedbackHint")}</p>
      <label>
        {t("settings.feedbackTitleLabel")}
        <input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        {t("settings.feedbackBodyLabel")}
        <textarea
          rows={12}
          value={body}
          maxLength={8000}
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
      <div className="feedback-actions">
        <button type="button" onClick={() => void copy()}>
          {copied ? t("settings.feedbackCopied") : t("settings.feedbackCopy")}
        </button>
        <span className="spacer" />
        <button type="button" onClick={onClose}>
          {t("settings.cancel")}
        </button>
        <button
          className="primary"
          type="button"
          onClick={() => void open()}
          disabled={opening || !title.trim()}
        >
          {opening ? t("settings.feedbackOpening") : t("settings.feedbackOpenIssue")}
        </button>
      </div>
    </Modal>
  );
}
