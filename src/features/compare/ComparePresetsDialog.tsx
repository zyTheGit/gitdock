import { useId, useRef, useState, type FormEvent } from "react";
import { useI18n } from "../../i18n";
import { formatDateTimeWithSeconds, shortOid } from "../../shared/format";
import { Modal } from "../../shared/Modal";
import { useEscClose } from "../../shared/useEscClose";
import "../../styles/comparePresets.css";
import {
  addComparePreset,
  createComparePreset,
  deleteComparePreset,
  readComparePresets,
  writeComparePresets,
  type ComparePreset,
  type ComparePresetEndpoint,
} from "./comparePresets";

interface ComparePresetsProps {
  mode: "save" | "list";
  repoPath: string;
  base: ComparePresetEndpoint | null;
  compare: ComparePresetEndpoint | null;
  onClose: () => void;
  onApply: (preset: ComparePreset) => void;
}

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function newPresetId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function Endpoint({ side, endpoint }: { side: string; endpoint: ComparePresetEndpoint }) {
  return (
    <span className="compare-preset-endpoint" title={`${endpoint.label}\n${endpoint.oid}`}>
      <span className="compare-preset-endpoint-side">{side}</span>
      <span className="compare-preset-endpoint-label">{endpoint.label}</span>
      <span className="mono muted">{shortOid(endpoint.oid)}</span>
    </span>
  );
}

/** 当前仓库的 OID 快照方案：只访问 localStorage，并通过既有槽位回调应用。 */
export function ComparePresets({
  mode,
  repoPath,
  base,
  compare,
  onClose,
  onApply,
}: ComparePresetsProps) {
  const { t } = useI18n();
  const titleId = useId();
  const [presets, setPresets] = useState(() => readComparePresets(browserStorage(), repoPath));
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const busyRef = useRef(false);
  const blankName = name.length > 0 && !name.trim();

  useEscClose(onClose, busy);

  const runStorage = (action: () => boolean): "busy" | "ok" | "failed" => {
    if (busyRef.current) {
      return "busy";
    }
    busyRef.current = true;
    setBusy(true);
    setStorageError(false);
    let ok = false;
    try {
      ok = action();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
    return ok ? "ok" : "failed";
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !base || !compare) {
      return;
    }
    const result = runStorage(() => {
      const created = createComparePreset(
        { name: trimmed, base, compare },
        newPresetId(),
        Date.now(),
      );
      if (!created) {
        return false;
      }
      const current = readComparePresets(browserStorage(), repoPath);
      const next = addComparePreset(current, created);
      if (!writeComparePresets(browserStorage(), repoPath, next)) {
        return false;
      }
      setPresets(next);
      return true;
    });
    if (result === "failed") {
      setStorageError(true);
    } else if (result === "ok") {
      onClose();
    }
  };

  const remove = (id: string) => {
    const result = runStorage(() => {
      if (!deleteComparePreset(browserStorage(), repoPath, id)) {
        return false;
      }
      setPresets(readComparePresets(browserStorage(), repoPath));
      return true;
    });
    if (result === "failed") {
      setStorageError(true);
    }
  };

  const apply = (preset: ComparePreset) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    onApply(preset);
    onClose();
  };

  return (
    <Modal
      className="compare-modal compare-presets-dialog"
      labelledBy={titleId}
      ariaLabel={mode === "save" ? t("compare.presetSaveTitle") : t("compare.presetListTitle")}
    >
      <h3 id={titleId}>
        {mode === "save" ? t("compare.presetSaveTitle") : t("compare.presetListTitle")}
      </h3>
      {storageError && (
        <p className="compare-presets-error" role="alert">
          {t("compare.presetStorageError")}
        </p>
      )}

      {mode === "save" ? (
        <form className="compare-presets-form" onSubmit={save} aria-busy={busy}>
          <p className="muted">{t("compare.presetSnapshotHint")}</p>
          {base && compare && (
            <div className="compare-preset-current" aria-label={t("compare.presetCurrent")}>
              <Endpoint side={t("compare.slotBase")} endpoint={base} />
              <span aria-hidden="true">→</span>
              <Endpoint side={t("compare.slotCompare")} endpoint={compare} />
            </div>
          )}
          <label>
            {t("compare.presetNameLabel")}
            <input
              value={name}
              maxLength={120}
              autoComplete="off"
              placeholder={t("compare.presetNamePlaceholder")}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {blankName && <p className="compare-presets-error">{t("compare.presetNameRequired")}</p>}
          <div className="compare-modal-actions">
            <button type="button" onClick={onClose} disabled={busy}>
              {t("compare.cancel")}
            </button>
            <button className="primary" type="submit" disabled={busy || !name.trim()}>
              {busy ? t("compare.presetSaving") : t("compare.presetSaveAction")}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="muted">{t("compare.presetSnapshotHint")}</p>
          {presets.length === 0 ? (
            <div className="compare-presets-empty">
              <p>{t("compare.presetEmpty")}</p>
              <p className="muted">{t("compare.presetEmptyHint")}</p>
            </div>
          ) : (
            <ul className="compare-presets-list" aria-busy={busy}>
              {presets.map((preset) => (
                <li key={preset.id} className="compare-preset-item">
                  <div className="compare-preset-item-heading">
                    <strong title={preset.name}>{preset.name}</strong>
                    <span className="muted">
                      {t("compare.presetCreated", {
                        time: formatDateTimeWithSeconds(preset.createdAt),
                      })}
                    </span>
                  </div>
                  <div className="compare-preset-current">
                    <Endpoint side={t("compare.slotBase")} endpoint={preset.base} />
                    <span aria-hidden="true">→</span>
                    <Endpoint side={t("compare.slotCompare")} endpoint={preset.compare} />
                  </div>
                  <div className="compare-preset-item-actions">
                    <button
                      type="button"
                      className="primary"
                      disabled={busy}
                      aria-label={t("compare.presetApplyNamed", { name: preset.name })}
                      onClick={() => apply(preset)}
                    >
                      {t("compare.presetApply")}
                    </button>
                    <button
                      type="button"
                      className="compare-preset-delete"
                      disabled={busy}
                      aria-label={t("compare.presetDeleteNamed", { name: preset.name })}
                      onClick={() => remove(preset.id)}
                    >
                      {busy ? t("compare.presetDeleting") : t("compare.presetDelete")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="compare-modal-actions">
            <button type="button" onClick={onClose} disabled={busy}>
              {t("common.close")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
