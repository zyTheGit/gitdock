import type { ReactNode } from "react";
import { useI18n } from "../../i18n";
import { gateSummaryText, issueText, warningText } from "../../shared/error";
import type { GateIssueDto, GateReportDto } from "../../shared/types";

interface GateReportViewProps {
  gate: GateReportDto | null;
  gateError: string | null;
  /** 正在按当前选择重新检查；期间不得放行执行。 */
  validating: boolean;
  /** 独立 Gate 预览（例如提交/丢弃确认框）的拒绝原因。 */
  issues?: GateIssueDto[] | null;
  /** 调用方已用常驻危险文案说明的警告，不在 Gate 块重复展示。 */
  hideWarnings?: readonly string[];
  children?: ReactNode;
}

/**
 * 写前检查结论块：摘要 / 拒绝原因 / 警告 / 受影响路径。
 * 与 ConfirmWriteDialog 的 Gate 区域保持同一套语义，供远程写对话框复用。
 */
export function GateReportView({
  gate,
  gateError,
  validating,
  issues,
  hideWarnings = [],
  children,
}: GateReportViewProps) {
  const { t } = useI18n();
  const warnings = gate?.warnings.filter((warning) => !hideWarnings.includes(warning.code)) ?? [];
  return (
    <section className="gate-report">
      <h3>{t("write.gateTitle")}</h3>
      {issues ? (
        <>
          <p className="danger-text">{t("write.gateFailedPrefix")}</p>
          <ul className="gate-issues">
            {issues.map((issue) => (
              <li key={`${issue.code}:${issue.message}`}>{issueText(issue)}</li>
            ))}
          </ul>
        </>
      ) : gateError ? (
        <p className="danger-text">{gateError}</p>
      ) : !gate ? (
        <p className="muted">{t("write.gateChecking")}</p>
      ) : gate.ok ? (
        <p className="gate-ok">{gateSummaryText(gate)}</p>
      ) : (
        <>
          <p className="danger-text">{t("write.gateFailedPrefix")}</p>
          <ul className="gate-issues">
            {gate.issues.map((issue) => (
              <li key={`${issue.code}:${issue.message}`}>{issueText(issue)}</li>
            ))}
          </ul>
        </>
      )}
      {validating && gate && <p className="muted">{t("write.gateRechecking")}</p>}
      {warnings.map((warning) => (
        <p className="gate-warning" key={`${warning.code}:${warning.message}`}>
          {warningText(warning)}
        </p>
      ))}
      {gate && gate.affected_paths.length > 0 && (
        <div className="gate-affected">
          <p className="muted">
            {gate.affected_total > gate.affected_paths.length
              ? t("write.affectedFilesTruncated", {
                  n: gate.affected_total,
                  m: gate.affected_paths.length,
                })
              : t("write.affectedFiles", { n: gate.affected_total })}
          </p>
          <ul className="gate-paths">
            {gate.affected_paths.map((path) => (
              <li className="mono" key={path}>
                {path}
              </li>
            ))}
          </ul>
        </div>
      )}
      {children}
    </section>
  );
}
