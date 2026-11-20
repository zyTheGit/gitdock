import { useEffect, useRef } from "react";
import { Icon } from "../../assets/icons";
import { useI18n } from "../../i18n";

interface DiffSearchBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  count: number;
  activeIndex: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

/** diff 内搜索条：输入即高亮，上一个 / 下一个在命中行之间跳转。 */
export function DiffSearchBar({
  query,
  onQueryChange,
  count,
  activeIndex,
  onNext,
  onPrev,
  onClose,
}: DiffSearchBarProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="diff-search-bar" role="search" aria-label={t("diff.searchLabel")}>
      <input
        ref={inputRef}
        type="search"
        className="diff-search-input"
        value={query}
        placeholder={t("diff.searchPlaceholder")}
        aria-label={t("diff.searchLabel")}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <span className="diff-search-count muted" aria-live="polite">
        {`${count === 0 ? 0 : activeIndex + 1}/${count}`}
      </span>
      <button
        className="diff-search-step"
        onClick={onPrev}
        disabled={count === 0}
        title={t("diff.searchPrevious")}
        aria-label={t("diff.searchPrevious")}
      >
        <Icon name="chevronDown" className="diff-search-step-up" />
      </button>
      <button
        className="diff-search-step"
        onClick={onNext}
        disabled={count === 0}
        title={t("diff.searchNext")}
        aria-label={t("diff.searchNext")}
      >
        <Icon name="chevronDown" />
      </button>
      <button
        className="diff-search-step"
        onClick={onClose}
        title={t("diff.searchClose")}
        aria-label={t("diff.searchClose")}
      >
        ×
      </button>
    </div>
  );
}
