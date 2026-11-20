import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { errorText, issueText, outcomeText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import { Modal } from "../../shared/Modal";
import { useEscClose } from "../../shared/useEscClose";
import type { GateIssueDto, StashEntryDto, WriteKind, WriteRequest } from "../../shared/types";
import { StashEntryRow } from "./StashEntryRow";
import { StashPreviewPane } from "./StashPreviewPane";

interface StashDialogProps {
  writeDisabled: boolean;
  onClose: () => void;
  onMutated: (message: string) => Promise<void>;
}

type StashAction = Extract<WriteKind, "stash_apply" | "stash_pop" | "stash_drop">;

/** 手动 stash 管理（ADR 0009）：保存、应用、弹出与删除。 */
export function StashDialog({ writeDisabled, onClose, onMutated }: StashDialogProps) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<StashEntryDto[] | null>(null);
  const [message, setMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<GateIssueDto[] | null>(null);
  const [pendingDrop, setPendingDrop] = useState<StashEntryDto | null>(null);
  const [selectedOid, setSelectedOid] = useState<string | null>(null);

  const busyRef = useRef(false);
  const pendingDropRef = useRef<StashEntryDto | null>(null);
  busyRef.current = busy;
  pendingDropRef.current = pendingDrop;

  const load = useCallback(async () => {
    try {
      setEntries(await ipc.readStashes());
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 列表刷新后保持有效选择；被 pop/drop 的条目失效时回落到第一条。
  useEffect(() => {
    if (!entries) {
      return;
    }
    setSelectedOid((current) =>
      current && entries.some((entry) => entry.oid === current)
        ? current
        : entries[0]?.oid ?? null,
    );
  }, [entries]);

  useEscClose(() => {
    if (pendingDropRef.current) {
      setPendingDrop(null);
    } else {
      onClose();
    }
  }, busy);

  const finish = useCallback(
    async (outcomeStatus: string, text: string) => {
      await load();
      await onMutated(text);
      if (outcomeStatus === "succeeded") {
        setMessage("");
      }
    },
    [load, onMutated],
  );

  const run = useCallback(
    async (request: WriteRequest, failedText: string) => {
      if (busyRef.current || writeDisabled) {
        return;
      }
      setBusy(true);
      setError(null);
      setIssues(null);
      try {
        const gate = await ipc.validateWrite(request);
        if (!gate.ok) {
          setIssues(gate.issues);
          return;
        }
        const outcome = await ipc.executeWrite(request);
        if (outcome.status === "rejected") {
          setError(outcomeText(outcome));
          return;
        }
        if (outcome.status === "failed") {
          setError([failedText, outcomeText(outcome), outcome.stderr?.trim()].filter(Boolean).join("\n\n"));
          return;
        }
        if (outcome.status === "conflicted") {
          setError(
            [outcomeText(outcome), t("staging.stashConflictHint"), outcome.stderr?.trim()]
              .filter(Boolean)
              .join("\n\n"),
          );
          await finish(outcome.status, outcomeText(outcome));
          return;
        }
        await finish(outcome.status, outcomeText(outcome));
      } catch (err) {
        setError(errorText(err));
      } finally {
        setBusy(false);
      }
    },
    [finish, t, writeDisabled],
  );

  const save = useCallback(() => {
    void run(
      {
        kind: "stash_save",
        message: message.trim() || undefined,
        include_untracked: includeUntracked,
      },
      t("staging.stashSaveFailed"),
    );
  }, [includeUntracked, message, run, t]);

  const act = useCallback(
    (kind: StashAction, entry: StashEntryDto) => {
      void run({ kind, stash: entry.selector }, t("staging.stashActionFailed"));
    },
    [run, t],
  );

  const confirmDrop = useCallback(() => {
    const entry = pendingDropRef.current;
    if (!entry) {
      return;
    }
    setPendingDrop(null);
    act("stash_drop", entry);
  }, [act]);

  const canSave = !busy && !writeDisabled;

  return (
    <Modal className="confirm-dialog stash-dialog wide">
      <header>
        <div>
          <h2>{t("staging.stashTitle")}</h2>
          <p className="muted settings-hint">{t("staging.stashSubtitle")}</p>
        </div>
        <button
          className="detail-close"
          onClick={onClose}
          disabled={busy}
          aria-label={t("staging.stashCloseAria")}
        >
          ×
        </button>
      </header>

      {pendingDrop ? (
        <>
          <section>
            <p className="confirm-target">
              <span className="mono">{pendingDrop.selector}</span>
              <span className="confirm-summary" title={pendingDrop.message}>
                {pendingDrop.message}
              </span>
            </p>
            <p className="danger-text confirm-hint">{t("staging.stashDropConfirmHint")}</p>
          </section>
          <footer>
            <button onClick={() => setPendingDrop(null)} disabled={busy}>
              {t("write.cancel")}
            </button>
            <button className="danger" onClick={confirmDrop} disabled={busy}>
              {busy ? t("staging.stashBusy") : t("staging.stashDropConfirm")}
            </button>
          </footer>
        </>
      ) : (
        <>
          <div className="stash-layout">
            <div className="stash-column">
              <section className="stash-save">
                <label className="ref-field-label" htmlFor="stash-message">
                  {t("staging.stashMessageLabel")}
                </label>
                <input
                  id="stash-message"
                  className="ref-input"
                  type="text"
                  disabled={busy}
                  placeholder={t("staging.stashMessagePlaceholder")}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />
                <label className="stash-check">
                  <input
                    type="checkbox"
                    checked={includeUntracked}
                    disabled={busy}
                    onChange={(event) => setIncludeUntracked(event.target.checked)}
                  />
                  {t("staging.stashIncludeUntracked")}
                </label>
                <button className="primary" onClick={save} disabled={!canSave}>
                  {busy ? t("staging.stashSaving") : t("staging.stashSave")}
                </button>
              </section>

              {issues && (
                <div className="gate-report">
                  <p className="danger-text">{t("write.gateFailedPrefix")}</p>
                  <ul className="gate-issues">
                    {issues.map((issue) => (
                      <li key={`${issue.code}:${issue.message}`}>{issueText(issue)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {error && <p className="danger-text stash-error">{error}</p>}

              <section className="stash-list" aria-label={t("staging.stashListLabel")}>
                {entries === null ? (
                  <p className="muted">{t("staging.stashBusy")}</p>
                ) : entries.length === 0 ? (
                  <p className="muted">{t("staging.stashEmpty")}</p>
                ) : (
                  <ul>
                    {entries.map((entry) => (
                      <StashEntryRow
                        key={entry.oid}
                        entry={entry}
                        active={entry.oid === selectedOid}
                        actionsDisabled={!canSave}
                        onSelect={() => setSelectedOid(entry.oid)}
                        onApply={() => act("stash_apply", entry)}
                        onPop={() => act("stash_pop", entry)}
                        onDrop={() => setPendingDrop(entry)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <StashPreviewPane oid={selectedOid} />
          </div>
          <footer>
            <button onClick={onClose} disabled={busy}>
              {t("staging.close")}
            </button>
          </footer>
        </>
      )}
    </Modal>
  );
}