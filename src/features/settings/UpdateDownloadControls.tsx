import { useState } from "react";
import {
  cancelUpdateDownload,
  formatBytes,
  installDownloadedUpdate,
  revealDownloadedUpdate,
  setUpdateInstallNotice,
  startUpdateDownload,
} from "../../app/useUpdateDownload";
import { useI18n } from "../../i18n";
import { copyText } from "../../shared/clipboard";
import { currentPlatform } from "../../shared/platform";
import type {
  UpdateCheckDto,
  UpdateCheckOutcome,
  UpdateDownloadState,
} from "../../shared/types";

interface UpdateDownloadControlsProps {
  update: UpdateCheckDto;
  download: UpdateDownloadState;
  onOpenDownloadPage: () => Promise<UpdateCheckOutcome>;
  onError?: (message: string) => void;
}

/** 更新包应用内下载、SHA-256 校验与平台安装衔接控件（弹窗与「关于」共用）。 */
export function UpdateDownloadControls({
  update,
  download,
  onOpenDownloadPage,
  onError,
}: UpdateDownloadControlsProps) {
  const { t } = useI18n();
  const [confirmExitInstall, setConfirmExitInstall] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const platform = currentPlatform();

  const matchesVersion =
    download.version === null || download.version === update.latest_version;
  const activeDownload = matchesVersion ? download : null;
  const isDownloading =
    activeDownload?.status === "downloading" || activeDownload?.status === "verifying";
  const isReady = activeDownload?.status === "ready" && Boolean(activeDownload.result);

  const openPage = async () => {
    setPageError(null);
    const outcome = await onOpenDownloadPage();
    if (outcome.kind === "failed") {
      setPageError(outcome.message);
      onError?.(outcome.message);
    }
  };

  const runInstall = async () => {
    setConfirmExitInstall(false);
    const outcome = await installDownloadedUpdate();
    if (!outcome) {
      return;
    }
    if (outcome.mode === "launched_exit") {
      setUpdateInstallNotice(t("settings.updateInstallLaunching"));
    } else if (outcome.mode === "opened") {
      setUpdateInstallNotice(t("settings.updateInstallMacOpened"));
    } else {
      setUpdateInstallNotice(t("settings.updateInstallLinuxRevealed"));
    }
  };

  const revealFile = async () => {
    const err = await revealDownloadedUpdate();
    if (err) {
      setPageError(err);
      onError?.(err);
    }
  };

  if (!update.can_download) {
    return (
      <div className="update-download-box">
        <p className="muted update-download-note">{t("settings.updateBrowserFallbackHint")}</p>
        <div className="update-download-actions">
          <button type="button" className="primary" onClick={() => void openPage()}>
            {t("settings.aboutOpenDownload")}
          </button>
        </div>
        {pageError && <p className="danger-text update-download-note">{pageError}</p>}
      </div>
    );
  }

  if (isDownloading && activeDownload) {
    const total = activeDownload.totalBytes ?? update.asset_size ?? null;
    const pct =
      total && total > 0
        ? Math.min(100, Math.round((activeDownload.downloadedBytes / total) * 100))
        : null;
    return (
      <div className="update-download-box">
        <div className="update-progress-meta">
          <span>
            {activeDownload.status === "verifying"
              ? t("settings.updateVerifying")
              : total
                ? t("settings.updateDownloadingProgress", {
                    downloaded: formatBytes(activeDownload.downloadedBytes),
                    total: formatBytes(total),
                    pct: pct ?? 0,
                  })
                : t("settings.updateDownloadingBytes", {
                    downloaded: formatBytes(activeDownload.downloadedBytes),
                  })}
          </span>
          <button type="button" className="link" onClick={() => void cancelUpdateDownload()}>
            {t("settings.updateCancelDownload")}
          </button>
        </div>
        <div className="update-progress-track" role="progressbar" aria-valuenow={pct ?? undefined}>
          <div
            className="update-progress-fill"
            style={{ width: `${activeDownload.status === "verifying" ? 100 : (pct ?? 35)}%` }}
          />
        </div>
      </div>
    );
  }

  if (isReady && activeDownload?.result) {
    const artifact = activeDownload.result;
    const linuxCmd = `sudo apt install ./${artifact.file_name}`;
    return (
      <div className="update-download-box is-ready">
        <div className="update-verified-badge">
          <span>{t("settings.updateReadyTitle", { file: artifact.file_name })}</span>
          <span className="mono muted">
            {t("settings.updateVerifiedHash", { hash: artifact.sha256.slice(0, 8) })}
          </span>
        </div>

        {platform === "windows" && confirmExitInstall ? (
          <div className="update-confirm-row">
            <span className="muted">{t("settings.updateInstallWindowsConfirmHint")}</span>
            <div className="update-download-actions">
              <button
                type="button"
                className="primary"
                disabled={activeDownload.installing}
                onClick={() => void runInstall()}
              >
                {t("settings.updateConfirmExitInstall")}
              </button>
              <button
                type="button"
                disabled={activeDownload.installing}
                onClick={() => setConfirmExitInstall(false)}
              >
                {t("settings.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <div className="update-download-actions">
            {platform === "windows" && (
              <button
                type="button"
                className="primary"
                disabled={activeDownload.installing}
                onClick={() => setConfirmExitInstall(true)}
              >
                {t("settings.updateInstallWindows")}
              </button>
            )}
            {platform === "macos" && (
              <button
                type="button"
                className="primary"
                disabled={activeDownload.installing}
                onClick={() => void runInstall()}
              >
                {t("settings.updateOpenDmg")}
              </button>
            )}
            {platform === "linux" && (
              <button
                type="button"
                className="primary"
                disabled={activeDownload.installing}
                onClick={() => void runInstall()}
              >
                {t("settings.updateRevealFile")}
              </button>
            )}
            {platform !== "linux" && (
              <button type="button" className="link" onClick={() => void revealFile()}>
                {t("settings.updateRevealFile")}
              </button>
            )}
          </div>
        )}

        {platform === "macos" && (
          <p className="muted update-download-note">{t("settings.updateMacUnsignedHint")}</p>
        )}
        {platform === "linux" && (
          <div className="update-linux-cmd">
            <code className="mono">{linuxCmd}</code>
            <button
              type="button"
              className="link"
              onClick={() => {
                void copyText(linuxCmd);
                setCopiedCmd(true);
              }}
            >
              {copiedCmd ? t("settings.feedbackCopied") : t("settings.updateCopyCommand")}
            </button>
          </div>
        )}
        {activeDownload.installNotice && (
          <p className="update-download-note">{activeDownload.installNotice}</p>
        )}
        {(activeDownload.error || pageError) && (
          <p className="danger-text update-download-note">{activeDownload.error ?? pageError}</p>
        )}
      </div>
    );
  }

  return (
    <div className="update-download-box">
      <div className="update-download-actions">
        <button
          type="button"
          className="primary"
          onClick={() => void startUpdateDownload(update.latest_version, update.asset_size)}
        >
          {update.asset_size
            ? t("settings.updateDownloadWithSize", { size: formatBytes(update.asset_size) })
            : t("settings.updateDownloadNow")}
        </button>
        <button type="button" className="link" onClick={() => void openPage()}>
          {t("settings.aboutOpenDownload")}
        </button>
      </div>
      {activeDownload?.status === "cancelled" && (
        <p className="muted update-download-note">{t("settings.updateDownloadCancelledNote")}</p>
      )}
      {activeDownload?.status === "failed" && activeDownload.error && (
        <p className="danger-text update-download-note">{activeDownload.error}</p>
      )}
      {pageError && <p className="danger-text update-download-note">{pageError}</p>}
    </div>
  );
}
