import { useState } from "react";
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
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);

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
      <h3>关于</h3>
      {info ? (
        <dl className="about-grid">
          <dt>版本</dt>
          <dd className="mono">{info.app_version}</dd>
          <dt>平台</dt>
          <dd className="mono">{info.platform}</dd>
          <dt>Git</dt>
          <dd className="mono">
            {info.git_version ?? "未检测到"}（最低 {info.minimum_git_version}）
          </dd>
        </dl>
      ) : (
        <p className="muted">正在读取版本信息…</p>
      )}
      <div
        className={`update-row${updateOffer ? " is-available" : ""}${
          updateCheck.status === "failed" ? " is-failed" : ""
        }`}
      >
        <span className="update-row-status" role="status">
          {updateCheck.status === "checking" ? (
            "检查中…"
          ) : updateOffer ? (
            <>
              发现新版本 <span className="mono">v{updateOffer.latest_version}</span>
              {updateOffer.published_at && (
                <span className="update-row-note muted">发布于 {updateOffer.published_at}</span>
              )}
            </>
          ) : updateCheck.status === "failed" ? (
            "检查更新未成功"
          ) : updateCheck.result ? (
            updateCheck.result.available ? (
              <>
                已跳过 <span className="mono">v{updateCheck.result.latest_version}</span>
              </>
            ) : (
              <>
                已是最新版本 <span className="mono">v{updateCheck.result.latest_version}</span>
              </>
            )
          ) : (
            <span className="muted">尚未检查新版本。</span>
          )}
        </span>
        {updateNotice && <span className="update-row-note muted">{updateNotice}</span>}
        <span className="update-row-actions">
          {updateOffer ? (
            <>
              <button type="button" className="link" onClick={onSkipUpdate}>
                跳过此版本
              </button>
              <button type="button" className="primary" onClick={() => void openDownloadPage()}>
                打开下载页
              </button>
            </>
          ) : (
            <>
              {updateCheck.skippedVersion && updateCheck.result?.available ? (
                <button type="button" className="link" onClick={onClearSkippedUpdate}>
                  撤销跳过
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void manualUpdateCheck()}
                disabled={updateCheck.status === "checking"}
              >
                {updateCheck.status === "failed" ? "重新检查" : "检查更新"}
              </button>
            </>
          )}
        </span>
      </div>
      <div className="about-actions">
        <button type="button" onClick={onOpenFeedback} disabled={!info}>
          提交 Issue…
        </button>
      </div>
      <p className="muted settings-hint">
        反馈框只预填应用版本、操作系统与 Git 版本，不含日志或仓库路径；点击后由你在浏览器中检查并提交。
      </p>
    </section>
  );
}
