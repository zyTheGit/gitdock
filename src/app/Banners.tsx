import type { AppInfoDto, RepoStateDto } from "../shared/types";

interface BannersProps {
  repo: RepoStateDto | null;
  info: AppInfoDto | null;
  error: string | null;
  diagnostic: string | null;
  onCopyDiagnostic: () => void;
}

/** 主区顶部横幅：中断态、仓库警告、Git 版本不足、错误与诊断。 */
export function Banners({ repo, info, error, diagnostic, onCopyDiagnostic }: BannersProps) {
  return (
    <>
      {repo?.interruption.kinds.length ? (
        <div className="banner warning">
          <strong>{repo.interruption.message}</strong>
          {repo.interruption.files.length > 0 && (
            <span>未完成文件：{repo.interruption.files.join("、")}</span>
          )}
          {repo.interruption.terminal_hint && <code>{repo.interruption.terminal_hint}</code>}
          <span className="muted">
            本应用不会自动执行 --abort / --quit，也不会跳过冲突；写操作在中断态解除前保持禁用。
          </span>
        </div>
      ) : null}

      {repo?.warnings.map((warning) => (
        <div className="banner info" key={warning.code}>
          {warning.message}
        </div>
      ))}

      {info && !info.git_version_supported && (
        <div className="banner danger">
          系统 Git 版本 {info.git_version ?? "未知"} 低于最低要求 {info.minimum_git_version}，写操作将不可用。
        </div>
      )}

      {error && (
        <div className="banner danger">
          <span className="banner-text">{error}</span>
          {diagnostic && (
            <button className="link" onClick={onCopyDiagnostic}>
              复制诊断
            </button>
          )}
        </div>
      )}
    </>
  );
}
