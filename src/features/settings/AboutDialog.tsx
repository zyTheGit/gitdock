import { useState } from "react";
import {
  clearSkippedUpdate,
  openAvailableUpdate,
  pendingUpdate,
  runUpdateCheck,
  skipAvailableUpdate,
} from "../../app/useUpdateCheck";
import { useI18n } from "../../i18n";
import { Modal } from "../../shared/Modal";
import { useEscClose } from "../../shared/useEscClose";
import type { AppInfoDto, UpdateCheckState } from "../../shared/types";
import { AboutSection } from "../settings/AboutSection";
import { FeedbackDialog } from "../settings/FeedbackDialog";

interface AboutDialogProps {
  info: AppInfoDto | null;
  updateCheck: UpdateCheckState;
  onClose: () => void;
  onError: (message: string) => void;
}

/**
 * 独立「关于」弹窗（ADR-0012）：版本、检查更新与反馈就地完成，不再打开设置。
 * 更新检查复用模块级 store，结果直接显示在弹窗内，避免「点了没反应」。
 */
export function AboutDialog({ info, updateCheck, onClose, onError }: AboutDialogProps) {
  const { t } = useI18n();
  useEscClose(onClose);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <Modal className="about-dialog">
      <header>
        <h2>{t("settings.aboutTitle")}</h2>
        <button className="detail-close" onClick={onClose} aria-label={t("staging.close")}>
          ×
        </button>
      </header>
      <div className="about-dialog-body">
        <AboutSection
          active
          info={info}
          updateCheck={updateCheck}
          updateOffer={pendingUpdate(updateCheck)}
          onCheckUpdate={() => runUpdateCheck(true)}
          onOpenDownloadPage={openAvailableUpdate}
          onSkipUpdate={skipAvailableUpdate}
          onClearSkippedUpdate={clearSkippedUpdate}
          onOpenFeedback={() => setFeedbackOpen(true)}
        />
      </div>
      {feedbackOpen && info && (
        <FeedbackDialog info={info} onClose={() => setFeedbackOpen(false)} onError={onError} />
      )}
    </Modal>
  );
}