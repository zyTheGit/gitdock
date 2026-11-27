import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { Icon } from "../../assets/icons";
import { copyText } from "../../shared/clipboard";
import { errorText } from "../../shared/error";
import { formatDate, shortOid } from "../../shared/format";
import { ipc } from "../../shared/ipc";
import { Modal } from "../../shared/Modal";
import { useEscClose } from "../../shared/useEscClose";
import type { CommitSummaryDto, ReflogEntryDto } from "../../shared/types";

interface ReflogDialogProps {
  /** 仓库 generation：重置/amend 后重开或刷新时重新读取 reflog。 */
  generation: number;
  /** 写操作不可用时禁用「创建分支 / Cherry-pick」入口（只读浏览仍可用）。 */
  writeDisabled: boolean;
  onClose: () => void;
  /** 在图谱中定位该提交（只读）。 */
  onLocate: (oid: string) => void;
  /** 复用既有创建分支流程，以该提交为起点。 */
  onCreateBranch: (commit: CommitSummaryDto) => void;
  /** 复用既有 cherry-pick 确认流程，绝不自动执行。 */
  onCherryPick: (commit: CommitSummaryDto) => void;
  /** 复制结果反馈：弹窗盖住主区，统一走应用级 toast（层级高于遮罩）。 */
  onToast: (message: string) => void;
}

type RowAction = "branch" | "cherry";

/**
 * HEAD reflog 只读恢复视图（ADR-0029 §2.7）：列出 `HEAD@{N}` / 短 OID / 时间 / 原始消息，
 * 行内动作只派发既有写流程（创建分支、cherry-pick），不提供「把分支移到此处」的旁路。
 */
export function ReflogDialog({
  generation,
  writeDisabled,
  onClose,
  onLocate,
  onCreateBranch,
  onCherryPick,
  onToast,
}: ReflogDialogProps) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<ReflogEntryDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 正在派发的行内动作，形如 `branch:<oid>`；期间其余动作禁用。 */
  const [pending, setPending] = useState<string | null>(null);
  const seq = useRef(0);
  const busyRef = useRef(false);
  busyRef.current = pending !== null;

  useEscClose(onClose, pending !== null);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      // 默认 200 条即可满足「找回最近的提交」；服务端再 clamp 到 1000 上限。
      const list = await ipc.readReflog();
      if (seq.current === id) {
        setEntries(list);
      }
    } catch (err) {
      if (seq.current === id) {
        setEntries([]);
        setError(errorText(err));
      }
    } finally {
      if (seq.current === id) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, generation]);

  /** reflog 只给 OID 与消息；创建分支 / cherry-pick 需要完整提交流程的目标，先读一次详情。 */
  const dispatch = useCallback(
    async (entry: ReflogEntryDto, action: RowAction) => {
      if (busyRef.current) {
        return;
      }
      // 同步占用：连点时第二次调用在重渲染前就会命中这里。
      busyRef.current = true;
      setPending(`${action}:${entry.new_oid}`);
      setError(null);
      try {
        const detail = await ipc.readCommit(entry.new_oid);
        if (action === "branch") {
          onCreateBranch(detail.commit);
        } else {
          onCherryPick(detail.commit);
        }
      } catch (err) {
        setError(errorText(err));
      } finally {
        setPending(null);
      }
    },
    [onCherryPick, onCreateBranch],
  );

  const copy = useCallback(
    async (oid: string) => {
      const ok = await copyText(oid);
      onToast(ok ? t("shell.oidCopied") : t("shell.copyFailed"));
    },
    [onToast, t],
  );

  return (
    <Modal
      className="confirm-dialog reflog-dialog"
      onBackdropClick={() => {
        // 正在派发「创建分支 / Cherry-pick」时不关闭，避免打断随后的确认框串接。
        if (pending === null) {
          onClose();
        }
      }}
    >
      <header>
        <div>
          <h2>{t("graph.reflogTitle")}</h2>
          <p className="muted settings-hint">{t("graph.reflogSubtitle")}</p>
        </div>
        <button
          className="detail-close"
          onClick={onClose}
          disabled={pending !== null}
          aria-label={t("graph.reflogCloseAria")}
        >
          ×
        </button>
      </header>

      <section className="reflog-toolbar">
        <span className="muted">{t("graph.reflogHint")}</span>
        <button onClick={() => void load()} disabled={loading}>
          <Icon name="refresh" />
          <span>{loading ? t("graph.reflogRefreshing") : t("graph.reflogRefresh")}</span>
        </button>
      </section>

      {error && <p className="danger-text reflog-error">{error}</p>}

      <section className="reflog-list" aria-label={t("graph.reflogListAria")}>
        {entries === null ? (
          <p className="muted">{t("graph.reflogLoading")}</p>
        ) : entries.length === 0 ? (
          <p className="muted">{t("graph.reflogEmpty")}</p>
        ) : (
          <ul>
            {entries.map((entry) => {
              const resolving =
                pending !== null && pending.endsWith(`:${entry.new_oid}`)
                  ? pending.slice(0, pending.indexOf(":"))
                  : null;
              return (
                <li className="reflog-row" key={entry.selector}>
                  <div className="reflog-row-info">
                    <span className="mono reflog-selector">{entry.selector}</span>
                    <span className="mono">{shortOid(entry.new_oid)}</span>
                    <span className="muted reflog-time">{formatDate(entry.created_at)}</span>
                    <span className="reflog-message" title={entry.message}>
                      {entry.message}
                    </span>
                  </div>
                  <div className="reflog-row-actions">
                    <button
                      onClick={() => void copy(entry.new_oid)}
                      title={t("graph.reflogCopyTitle")}
                    >
                      {t("graph.reflogCopyOid")}
                    </button>
                    <button
                      disabled={writeDisabled || pending !== null}
                      onClick={() => void dispatch(entry, "branch")}
                    >
                      {resolving === "branch"
                        ? t("graph.reflogResolving")
                        : t("graph.reflogCreateBranch")}
                    </button>
                    <button
                      disabled={writeDisabled || pending !== null}
                      onClick={() => void dispatch(entry, "cherry")}
                    >
                      {resolving === "cherry"
                        ? t("graph.reflogResolving")
                        : t("graph.reflogCherryPick")}
                    </button>
                    <button disabled={pending !== null} onClick={() => onLocate(entry.new_oid)}>
                      {t("graph.reflogLocate")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <footer>
        <span className="muted reflog-footer-hint">{t("graph.reflogFooterHint")}</span>
        <button onClick={onClose} disabled={pending !== null}>
          {t("staging.close")}
        </button>
      </footer>
    </Modal>
  );
}
