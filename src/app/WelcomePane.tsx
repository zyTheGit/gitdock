import { useI18n } from "../i18n";

/** 仓库未打开时的欢迎占位：标题、说明与统一打开仓库弹层入口。 */
export function WelcomePane({
  busy,
  opening,
  onPick,
}: {
  busy: boolean;
  opening: boolean;
  onPick: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="welcome">
      <h1>{t("shell.welcomeTitle")}</h1>
      <p>{t("shell.welcomeBody")}</p>
      <button
        type="button"
        className="primary large"
        title={t("repository.tabOpenTitle")}
        onClick={onPick}
        disabled={busy}
      >
        {opening ? t("shell.openingRepository") : t("repository.tabOpenAria")}
      </button>
    </section>
  );
}
