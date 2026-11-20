import { useI18n } from "../../i18n";
import { formatDate } from "../../shared/format";
import type { StashEntryDto } from "../../shared/types";

interface StashEntryRowProps {
  entry: StashEntryDto;
  active: boolean;
  actionsDisabled: boolean;
  onSelect: () => void;
  onApply: () => void;
  onPop: () => void;
  onDrop: () => void;
}

/** 单条 stash：点击信息区选中并在右栏预览，右侧按钮保持既有的 apply/pop/drop 语义。 */
export function StashEntryRow({
  entry,
  active,
  actionsDisabled,
  onSelect,
  onApply,
  onPop,
  onDrop,
}: StashEntryRowProps) {
  const { t } = useI18n();
  return (
    <li className={active ? "stash-row active" : "stash-row"}>
      <button
        className="stash-row-select"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        aria-label={t("staging.stashSelectEntry", { selector: entry.selector })}
        title={entry.message}
      >
        <span className="mono">{entry.selector}</span>
        <span className="stash-row-message">{entry.message}</span>
        <span className="muted">{formatDate(entry.created_at)}</span>
      </button>
      <div className="stash-row-actions">
        <button disabled={actionsDisabled} onClick={onApply}>
          {t("staging.stashApply")}
        </button>
        <button disabled={actionsDisabled} onClick={onPop}>
          {t("staging.stashPop")}
        </button>
        <button className="danger" disabled={actionsDisabled} onClick={onDrop}>
          {t("staging.stashDrop")}
        </button>
      </div>
      <p className="muted stash-row-hints">
        {t("staging.stashApplyHint")} · {t("staging.stashPopHint")} · {t("staging.stashDropHint")}
      </p>
    </li>
  );
}
