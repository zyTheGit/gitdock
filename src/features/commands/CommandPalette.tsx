import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useI18n } from "../../i18n";
import { Modal } from "../../shared/Modal";
import { useEscClose } from "../../shared/useEscClose";
import "../../styles/commands.css";
import {
  searchCommandItems,
  type CommandPaletteItem,
} from "./commandSearch";

export interface CommandPaletteProps {
  items: readonly CommandPaletteItem[];
  onExecute: (id: string) => void;
  onClose: () => void;
  ariaLabel?: string;
  placeholder?: string;
  closeLabel?: string;
  emptyMessage?: string;
}

export function CommandPalette({
  items,
  onExecute,
  onClose,
  ariaLabel,
  placeholder,
  closeLabel,
  emptyMessage,
}: CommandPaletteProps) {
  const { t } = useI18n();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef(new Map<string, HTMLLIElement>());
  const composingRef = useRef(false);
  const executingRef = useRef(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useMemo(() => {
    const matched = searchCommandItems(items, query);
    const enabled: CommandPaletteItem[] = [];
    const disabled: CommandPaletteItem[] = [];
    for (const item of matched) {
      if (item.disabledReason === undefined) {
        enabled.push(item);
      } else {
        disabled.push(item);
      }
    }
    return [...enabled, ...disabled];
  }, [items, query]);
  const currentActiveIndex = results.length > 0 ? Math.min(activeIndex, results.length - 1) : -1;
  const activeItem = currentActiveIndex >= 0 ? results[currentActiveIndex] : undefined;
  const activeOptionId = activeItem
    ? `${listboxId}-option-${currentActiveIndex}`
    : undefined;
  const label = ariaLabel ?? t("commands.title");
  const inputPlaceholder = placeholder ?? t("commands.placeholder");
  const resolvedCloseLabel = closeLabel ?? t("common.close");

  useEscClose(onClose);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!activeItem) {
      return;
    }
    optionRefs.current.get(activeItem.id)?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
      behavior: "auto",
    });
  }, [activeItem]);

  const execute = (item: CommandPaletteItem) => {
    if (executingRef.current || item.disabledReason !== undefined) {
      return;
    }
    executingRef.current = true;
    onExecute(item.id);
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) {
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (results.length === 0) {
        return;
      }
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => (index + delta + results.length) % results.length);
      return;
    }

    if (event.key === "Home" && results.length > 0) {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }

    if (event.key === "End" && results.length > 0) {
      event.preventDefault();
      setActiveIndex(results.length - 1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (activeItem) {
        execute(activeItem);
      }
    }
  };

  return (
    <Modal className="command-palette" ariaLabel={label}>
      <div className="command-palette-search-row">
        <input
          ref={inputRef}
          className="command-palette-input"
          type="text"
          value={query}
          placeholder={inputPlaceholder}
          aria-label={label}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="command-palette-close"
          aria-label={resolvedCloseLabel}
          title={resolvedCloseLabel}
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <ul
        id={listboxId}
        className="command-palette-list"
        role="listbox"
        aria-label={t("commands.listLabel")}
      >
        {results.map((item, index) => {
          const disabled = item.disabledReason !== undefined;
          const selected = index === currentActiveIndex;
          return (
            <li
              key={item.id}
              id={`${listboxId}-option-${index}`}
              ref={(element) => {
                if (element) {
                  optionRefs.current.set(item.id, element);
                } else {
                  optionRefs.current.delete(item.id);
                }
              }}
              className={`command-palette-option${selected ? " active" : ""}`}
              role="option"
              aria-selected={selected}
              aria-disabled={disabled || undefined}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => execute(item)}
            >
              <span className="command-palette-option-copy">
                <span className="command-palette-option-title">{item.title}</span>
                <span className="command-palette-option-context">{item.context}</span>
                {disabled && (
                  <span className="command-palette-disabled-reason">{item.disabledReason}</span>
                )}
              </span>
              {item.shortcut && (
                <kbd className="command-palette-shortcut">{item.shortcut}</kbd>
              )}
            </li>
          );
        })}
      </ul>

      {results.length === 0 && (
        <p className="command-palette-empty" role="status">
          {emptyMessage ?? t("commands.empty")}
        </p>
      )}
      <p className="command-palette-hint">{t("commands.hint")}</p>
    </Modal>
  );
}
