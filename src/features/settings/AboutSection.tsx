import { useState } from "react";
import { useI18n } from "../../i18n";
import type {
  AppInfoDto,
  UpdateCheckDto,
  UpdateCheckOutcome,
  UpdateCheckState,
} from "../../shared/types";

interface AboutSectionProps {
  active: boolean;
  info: AppInfoDto | null;
  updateCheck: UpdateCheckState;
  updateOffer: UpdateCheckDto | null;
  onCheckUpdate: () => Promise<UpdateCheckOutcome>;
  onOpenDownloadPage: () => Promise<UpdateCheckOutcome>;
  onSkipUpdate: () => void;
  onClearSkippedUpdate: () => void;
  onOpenFeedback: () => void;
}

export function AboutSection({
  active,
  info,
  updateCheck,
  updateOffer,
  onCheckUpdate,
  onOpenDownloadPage,
  onSkipUpdate,
  onClearSkippedUpdate,
  onOpenFeedback,
}: AboutSectionProps) {
  const { t } = useI18n();
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);
  const result = updateCheck.result;
  // 当前版本比线上最新还新：正常发版不会出现，只可能是安装包版本号被误标。
  const currentNewer = Boolean(result && !result.available && result.current_newer);

  const manualUpdateCheck = async () => {
    setUpdateNotice(null);
    const outcome = await onCheckUpdate();
    if (outcome.kind === "failed") setUpdateNotice(outcome.message);
  };

  const openDownloadPage = async () => {
    setUpdateNotice(null);
    const outcome = await onOpenDownloadPage();
    if (outcome.kind === "failed") setUpdateNotice(outcome.message);
  };

  return (
    <section id="settings-about" hidden={!active}>
      <h3>{t("settings.aboutTitle")}</h3>
      {info ? (
        <dl className="about-grid">
          <dt>{t("settings.aboutVersion")}</dt>
          <dd className="mono">{info.app_version}</dd>
          <dt>{t("settings.aboutPlatform")}</dt>
          <dd className="mono">{info.platform}</dd>
          <dt>Git</dt>
          <dd className="mono">
            {info.git_version ?? t("settings.aboutGitNotDetected")}
            {t("settings.aboutGitMinimum", { version: info.minimum_git_version })}
          </dd>
        </dl>
      ) : (
        <p className="muted">{t("settings.aboutLoading")}</p>
      )}
      <div
        className={`update-row${updateOffer ? " is-available" : ""}${
          updateCheck.status === "failed" ? " is-failed" : ""
        }`}
      >
        <span className="update-row-status" role="status">
          {updateCheck.status === "checking" ? (
            t("settings.aboutChecking")
          ) : updateOffer ? (
            <>
              {t("settings.aboutFoundVersion")}{" "}
              <span className="mono">v{updateOffer.latest_version}</span>
              {updateOffer.published_at && (
                <span className="update-row-note muted">
                  {t("settings.aboutPublishedAt", { date: updateOffer.published_at })}
                </span>
              )}
            </>
          ) : updateCheck.status === "failed" ? (
            t("settings.aboutCheckFailed")
          ) : updateCheck.result ? (
            currentNewer ? (
              <span className="update-row-warning">
                {t("settings.aboutCurrentAhead", { version: updateCheck.result.latest_version })}
              </span>
            ) : updateCheck.result.available ? (
              <>
                {t("settings.aboutSkipped")}{" "}
                <span className="mono">v{updateCheck.result.latest_version}</span>
              </>
            ) : (
              <>
                {t("settings.aboutUpToDate")}{" "}
                <span className="mono">v{updateCheck.result.latest_version}</span>
              </>
            )
          ) : (
            <span className="muted">{t("settings.aboutNotChecked")}</span>
          )}
        </span>
        {updateNotice && <span className="update-row-note muted">{updateNotice}</span>}
        <span className="update-row-actions">
          {updateOffer ? (
            <button type="button" className="link" onClick={onSkipUpdate}>
              {t("settings.aboutSkipVersion")}
            </button>
          ) : null}
          {updateOffer || currentNewer ? (
            <button type="button" className="primary" onClick={() => void openDownloadPage()}>
              {t("settings.aboutOpenDownload")}
            </button>
          ) : null}
          {updateOffer ? null : (
            <>
              {updateCheck.skippedVersion && updateCheck.result?.available ? (
                <button type="button" className="link" onClick={onClearSkippedUpdate}>
                  {t("settings.aboutUndoSkip")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void manualUpdateCheck()}
                disabled={updateCheck.status === "checking"}
              >
                {updateCheck.status === "failed"
                  ? t("settings.aboutRecheck")
                  : t("settings.aboutCheckUpdate")}
              </button>
            </>
          )}
        </span>
      </div>
      <div className="about-actions">
        <button type="button" onClick={onOpenFeedback} disabled={!info}>
          {t("settings.aboutSubmitIssue")}
        </button>
      </div>
      <p className="muted settings-hint">{t("settings.aboutFeedbackHint")}</p>
    </section>
  );
}
