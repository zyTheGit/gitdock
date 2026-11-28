import { useUpdateDownload } from "../../app/useUpdateDownload";
import { useI18n } from "../../i18n";
import { Modal } from "../../shared/Modal";
import { useEscClose } from "../../shared/useEscClose";
import type { UpdateCheckDto, UpdateCheckOutcome } from "../../shared/types";
import { UpdateDownloadControls } from "./UpdateDownloadControls";

interface UpdateDialogProps {
  update: UpdateCheckDto;
  onOpenDownloadPage: () => Promise<UpdateCheckOutcome>;
  onSkipVersion: () => void;
  onClose: () => void;
}

/** 发现新版本弹窗：展示版本说明并支持应用内流式下载与校验。 */
export function UpdateDialog({
  update,
  onOpenDownloadPage,
  onSkipVersion,
  onClose,
}: UpdateDialogProps) {
  const { t } = useI18n();
  const download = useUpdateDownload();
  useEscClose(onClose, download.installing);

  return (
    <Modal className="update-dialog">
      <header>
        <h2>{t("settings.updateDialogTitle", { version: update.latest_version })}</h2>
        <button
          type="button"
          className="detail-close"
          onClick={onClose}
          disabled={download.installing}
          aria-label={t("common.close")}
        >
          ×
        </button>
      </header>

      <section className="update-dialog-body">
        <div className="update-version-meta">
          <span className="mono">
            v{update.current_version} → v{update.latest_version}
          </span>
          {update.published_at && (
            <span className="muted">
              {t("settings.aboutPublishedAt", { date: update.published_at })}
            </span>
          )}
        </div>

        {update.release_notes && (
          <div className="update-notes-section">
            <span className="muted update-notes-label">{t("settings.updateReleaseNotesLabel")}</span>
            <pre className="update-release-notes">{update.release_notes}</pre>
          </div>
        )}

        <UpdateDownloadControls
          update={update}
          download={download}
          onOpenDownloadPage={onOpenDownloadPage}
        />
      </section>

      <footer>
        {update.available && (
          <button
            type="button"
            className="link"
            disabled={download.installing}
            onClick={() => {
              onSkipVersion();
              onClose();
            }}
          >
            {t("settings.aboutSkipVersion")}
          </button>
        )}
        <button type="button" disabled={download.installing} onClick={onClose}>
          {t("common.close")}
        </button>
      </footer>
    </Modal>
  );
}
