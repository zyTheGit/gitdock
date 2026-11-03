interface TerminalSectionProps {
  active: boolean;
  lazygitPath: string;
  onLazygitPathChange: (value: string) => void;
  onBrowse: () => Promise<void>;
}

export function TerminalSection({
  active,
  lazygitPath,
  onLazygitPathChange,
  onBrowse,
}: TerminalSectionProps) {
  return (
    <section id="settings-terminal" hidden={!active}>
      <h3>终端</h3>
      <p className="muted settings-hint">
        GitDock 不捆绑 LazyGit。留空时从 PATH 查找；填写后只使用该文件，找不到会在终端面板提示。
        终端以当前用户权限、在当前打开的仓库目录中运行。
      </p>
      <label className="settings-field">
        <span className="settings-field-label">LazyGit 可执行文件</span>
        <span className="tool-path">
          <input
            value={lazygitPath}
            placeholder="留空则从 PATH 查找 LazyGit，例如 C:\Users\me\scoop\shims\lazygit.exe"
            onChange={(event) => onLazygitPathChange(event.target.value)}
          />
          <button type="button" onClick={() => void onBrowse()}>
            浏览…
          </button>
        </span>
      </label>
    </section>
  );
}
