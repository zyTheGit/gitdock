interface StartupSectionProps {
  active: boolean;
  restore: boolean;
  watch: boolean;
  onRestoreChange: (value: boolean) => void;
  onWatchChange: (value: boolean) => void;
}

export function StartupSection({
  active,
  restore,
  watch,
  onRestoreChange,
  onWatchChange,
}: StartupSectionProps) {
  return (
    <section id="settings-startup" hidden={!active}>
      <h3>启动</h3>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={restore}
          onChange={(event) => onRestoreChange(event.target.checked)}
        />
        启动时恢复上次打开的仓库
      </label>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={watch}
          onChange={(event) => onWatchChange(event.target.checked)}
        />
        监视 Git 目录变化并自动刷新（外部 commit、切换分支等）
      </label>
    </section>
  );
}
