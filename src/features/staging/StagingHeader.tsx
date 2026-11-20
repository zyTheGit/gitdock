import { useI18n } from "../../i18n";
import { warningText } from "../../shared/error";
import type { StagingStatusDto } from "../../shared/types";

interface StagingHeaderProps {
  status: StagingStatusDto | null;
  /** 写互斥 / 加载中：禁用顶部动作。 */
  disabled: boolean;
  loading: boolean;
  busy: boolean;
  error: string | null;
  /** 当前 HEAD 的展示文案（分支名 / detached / unborn）。 */
  headLabel: string;
  onClearError: () => void;
  onOpenStash: () => void;
  onRefresh: () => void;
}

/** 暂存区标题栏：HEAD 与计数、刷新 / stash 入口，以及错误与警告横幅。 */
export function StagingHeader({
  status,
  disabled,
  loading,
  busy,
  error,
  headLabel,
  onClearError,
  onOpenStash,
  onRefresh,
}: StagingHeaderProps) {
  const { t } = useI18n();

  return (
    <>
      <header className="staging-head">
        <div className="staging-head-title">
          <strong>{t("staging.title")}</strong>
          <span className="tag">{headLabel}</span>
          {status?.unborn && <span className="muted">{t("staging.noCommitsYet")}</span>}
          {status?.detached && <span className="muted">detached</span>}
        </div>
        <div className="staging-head-actions">
          {status && (
            <span className="staging-counts muted">
              {[
                t("staging.countStaged", { n: status.staged.length }),
                t("staging.countUnstaged", { n: status.unstaged.length }),
                ...(status.conflicted_files.length > 0
                  ? [t("staging.countConflicted", { n: status.conflicted_files.length })]
                  : []),
              ].join(" · ")}
            </span>
          )}
          <button onClick={onOpenStash} disabled={disabled}>
            {t("staging.stashOpen")}
          </button>
          <button onClick={onRefresh} disabled={loading || busy}>
            {loading ? t("staging.loading") : t("staging.refresh")}
          </button>
        </div>
      </header>

      {error && (
        <div className="banner danger compact" role="alert">
          <span className="banner-text">{error}</span>
          <button className="link" onClick={onClearError}>
            {t("staging.close")}
          </button>
        </div>
      )}

      {status?.warnings.map((warning) => (
        <div className="banner warning compact" key={warning.code}>
          {warningText(warning)}
        </div>
      ))}
    </>
  );
}
