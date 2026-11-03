import { useI18n } from "../i18n";

/** 仓库未打开时的欢迎占位：标题、说明与选择目录按钮（纯移动自 App.tsx）。 */
export function WelcomePane({ busy, onPick }: { busy: boolean; onPick: () => void }) {
  const { t } = useI18n();
  return (
    <section className="welcome">
      <h1>{t("shell.welcomeTitle")}</h1>
      <p>{t("shell.welcomeBody")}</p>
      <button className="primary large" onClick={onPick} disabled={busy}>
        {t("shell.chooseRepoDirectory")}
      </button>
    </section>
  );
}