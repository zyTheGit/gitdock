import type { AppInfoDto, RepoStateDto, SettingsDto } from "../shared/types";

interface StatusBarProps {
  busy: boolean;
  repo: RepoStateDto | null;
  info: AppInfoDto | null;
  settings: SettingsDto | null;
  fontScale: number;
}

export function StatusBar({ busy, repo, info, settings, fontScale }: StatusBarProps) {
  return (
    <footer className="statusbar">
      <span>{busy ? "处理中…" : repo ? "就绪" : "未打开仓库"}</span>
      <span className="mono">
        {info ? `git ${info.git_version ?? "未知"} · ${info.platform}` : ""}
        {repo && settings ? ` · ${settings.watch_enabled ? "监听已开启" : "监听已关闭"}` : ""}
        {` · 缩放 ${Math.round(fontScale * 100)}%`}
      </span>
    </footer>
  );
}
