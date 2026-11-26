import { useI18n } from "../../i18n";
import { isDateDraftValid, type SearchDateDraft } from "./dateRange";

interface SearchDateRangeProps {
  value: SearchDateDraft;
  onChange: (value: SearchDateDraft) => void;
}

export function SearchDateRange({ value, onChange }: SearchDateRangeProps) {
  const { t } = useI18n();
  const invalid = !isDateDraftValid(value);

  return (
    <div className="search-date-range" role="group" aria-label={t("search.dateRange")}>
      <span className="muted">{t("search.dateRange")}</span>
      <input
        type="date"
        value={value.from}
        max={value.to || undefined}
        aria-label={t("search.dateFrom")}
        aria-invalid={invalid}
        onChange={(event) => onChange({ ...value, from: event.target.value })}
      />
      <span className="search-date-sep" aria-hidden="true" />
      <input
        type="date"
        value={value.to}
        min={value.from || undefined}
        aria-label={t("search.dateTo")}
        aria-invalid={invalid}
        onChange={(event) => onChange({ ...value, to: event.target.value })}
      />
      {(value.from || value.to) && (
        <button type="button" className="search-date-clear" onClick={() => onChange({ from: "", to: "" })}>
          {t("search.clearDates")}
        </button>
      )}
      {invalid && <span className="search-date-error">{t("search.dateRangeInvalid")}</span>}
    </div>
  );
}
