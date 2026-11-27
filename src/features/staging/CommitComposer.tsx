import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Icon } from "../../assets/icons";
import { publishOperationNotice, writeErrorNotice, writeOutcomeNotice } from "../../app/operationNotice";
import { useI18n } from "../../i18n";
import { errorText, issueText, outcomeText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import { primaryModifierLabel } from "../../shared/platform";
import type { GateIssueDto, GateReportDto, WriteKind, WriteOutcomeDto } from "../../shared/types";
import { outcomeMessage } from "../write/messages";
import { GateReportView } from "../write/GateReportView";
import { AmendConfirmDialog } from "./AmendConfirmDialog";
import { readCommitDraft, storeCommitDraft } from "./commitDraft";

type CommitKind = Extract<WriteKind, "create_commit" | "amend_commit">;

interface CommitComposerProps {
  repoPath: string;
  /** unborn HEAD 时没有可 amend 的提交，amend 开关禁用。 */
  unborn: boolean;
  /** 已暂存文件非空；空 index 且非 unborn 时普通提交无意义。 */
  hasStaged: boolean;
  /** 上一条提交已推送至上游（需确认强制改写风险）；未推送的纯本地提交温和提示即可。 */
  pushedRisk?: boolean;
  /** 与 stage/unstage 等写操作共用的互斥（来自 useWriteFlow.disabled）。 */
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  /** 提交成功：调用方展示 toast 并刷新暂存区与图谱。 */
  onCommitted: (message: string) => Promise<void>;
}

/**
 * 内嵌提交表单（ADR 0007 §2.3）：CommitMessageDialog 的常驻版本，不再遮挡右侧 diff。
 * create 直执——消息即显式意图，Gate 拒绝项就地展示；amend 是历史改写，
 * validate 通过后仍须经 AmendConfirmDialog 二次确认，不跳过改写确认。
 */
export function CommitComposer({
  repoPath,
  unborn,
  hasStaged,
  pushedRisk = true,
  disabled,
  onBusyChange,
  onCommitted,
}: CommitComposerProps) {
  const { t } = useI18n();
  const [text, setText] = useState(() => readCommitDraft(repoPath));
  const [collapsed, setCollapsed] = useState(false);
  const [amend, setAmend] = useState(false);
  const [amendLoading, setAmendLoading] = useState(false);
  const [amendUnborn, setAmendUnborn] = useState(false);
  const [amendError, setAmendError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<GateIssueDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 非 null 时处于 amend 确认步。 */
  const [pendingGate, setPendingGate] = useState<GateReportDto | null>(null);
  /** 已按 commit.template 预填时记录模板路径，用于展示提示（ADR-0034）。 */
  const [templatePath, setTemplatePath] = useState<string | null>(null);

  const headMessageRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const amendLoadingRef = useRef(false);
  const previousRepoRef = useRef(repoPath);
  const repoPathRef = useRef(repoPath);
  repoPathRef.current = repoPath;
  const onBusyChangeRef = useRef(onBusyChange);
  const onCommittedRef = useRef(onCommitted);
  // 异步预填落地时再查一次消息：渲染期同步刷新，避免覆盖用户已输入的内容。
  const textRef = useRef(text);
  textRef.current = text;
  /** 每个仓库只会尝试读取一次提交模板。 */
  const templateRepoRef = useRef<string | null>(null);
  onBusyChangeRef.current = onBusyChange;
  onCommittedRef.current = onCommitted;

  const setOperationBusy = useCallback((value: boolean) => {
    busyRef.current = value;
    onBusyChangeRef.current(value);
    setBusy(value);
  }, []);

  // unmount 时解除暂存区共享互斥。
  useEffect(() => () => onBusyChangeRef.current(false), []);

  // 草稿按仓库会话保存：切仓库丢弃上一仓库的草稿，提交成功后在 applyOutcome 中清空。
  useEffect(() => {
    if (previousRepoRef.current !== repoPath) {
      storeCommitDraft(previousRepoRef.current, "");
      previousRepoRef.current = repoPath;
      headMessageRef.current = null;
      setText(readCommitDraft(repoPath));
      setAmend(false);
      setAmendUnborn(false);
      setAmendError(null);
      setIssues(null);
      setError(null);
      setPendingGate(null);
      return;
    }
    storeCommitDraft(repoPath, text);
  }, [repoPath, text]);

  const amendDisabled = unborn || amendUnborn;

  // commit.template 预填（ADR-0034）：每个仓库只读一次，消息为空才填；
  // 未配置模板返回 null，按静默处理，不打扰用户。
  useEffect(() => {
    if (templateRepoRef.current === repoPath) {
      return;
    }
    templateRepoRef.current = repoPath;
    setTemplatePath(null);
    let canceled = false;
    void (async () => {
      try {
        const template = await ipc.readCommitTemplate();
        if (canceled || !template) {
          return;
        }
        const content = template.content.trimEnd();
        if (!content) {
          return;
        }
        // 异步返回后再确认一次：这段等待期间用户可能已经开始输入。
        if (textRef.current.trim().length > 0) {
          return;
        }
        setText(content);
        setTemplatePath(template.path);
      } catch {
        // 模板只是便利：读取失败与未配置同样静默。
      }
    })();
    return () => {
      canceled = true;
    };
  }, [repoPath]);

  // 开启 amend 时经 read_head_message 预填现有消息；读不到（unborn）则禁用开关。
  const onAmendToggle = useCallback(
    async (next: boolean) => {
      if (!next || amendDisabled || amendLoadingRef.current || busyRef.current) {
        setAmend(next);
        return;
      }
      const requestedRepoPath = repoPath;
      if (headMessageRef.current === null) {
        amendLoadingRef.current = true;
        setAmendLoading(true);
        setAmendError(null);
        try {
          const message = await ipc.readHeadMessage();
          if (repoPathRef.current !== requestedRepoPath) {
            return;
          }
          if (message === null) {
            setAmendUnborn(true);
            return;
          }
          headMessageRef.current = message;
        } catch (err) {
          if (repoPathRef.current === requestedRepoPath) {
            setAmendError(`${t("staging.amendLoadFailedPrefix")}${errorText(err)}`);
          }
          return;
        } finally {
          amendLoadingRef.current = false;
          setAmendLoading(false);
        }
      }
      if (repoPathRef.current === requestedRepoPath) {
        setText(headMessageRef.current ?? "");
        setAmend(true);
      }
    },
    [amendDisabled, repoPath, t],
  );

  const applyOutcome = useCallback(
    async (kind: CommitKind, outcome: WriteOutcomeDto) => {
      if (outcome.status === "succeeded") {
        publishOperationNotice(writeOutcomeNotice(kind, outcome), repoPath);
        setText("");
        storeCommitDraft(repoPath, "");
        setTemplatePath(null);
        // HEAD 已前移，缓存的上一条消息作废，下次 amend 重新读取。
        headMessageRef.current = null;
        setPendingGate(null);
        setIssues(null);
        setError(null);
        setAmend(false);
        await onCommittedRef.current(outcomeMessage(kind, outcome));
        return;
      }
      const message = outcomeText(outcome);
      setError(message);
      setPendingGate(null);
      publishOperationNotice(
        writeErrorNotice(kind, message, outcome.stderr),
        repoPath,
      );
    },
    [repoPath],
  );

  const submit = useCallback(async () => {
    const message = text.trim();
    const blocked = !amend && !hasStaged && !unborn;
    if (!message || busyRef.current || amendLoadingRef.current || disabled || blocked) {
      return;
    }
    const requestedRepoPath = repoPath;
    const kind: CommitKind = amend ? "amend_commit" : "create_commit";
    setOperationBusy(true);
    setError(null);
    setIssues(null);
    try {
      const gate = await ipc.validateWrite({ kind, message });
      if (repoPathRef.current !== requestedRepoPath) {
        return;
      }
      if (!gate.ok) {
        const gateMessage = gate.issues.map(issueText).join("\n");
        setIssues(gate.issues);
        publishOperationNotice(writeErrorNotice(kind, gateMessage), requestedRepoPath);
        return;
      }
      if (kind === "create_commit") {
        const outcome = await ipc.executeWrite({ kind, message });
        if (repoPathRef.current === requestedRepoPath) {
          await applyOutcome(kind, outcome);
        }
        return;
      }
      setPendingGate(gate);
    } catch (err) {
      if (repoPathRef.current === requestedRepoPath) {
        const message = errorText(err);
        setError(message);
        publishOperationNotice(writeErrorNotice(kind, message), requestedRepoPath);
      }
    } finally {
      setOperationBusy(false);
    }
  }, [amend, applyOutcome, disabled, hasStaged, repoPath, setOperationBusy, text, unborn]);

  const confirmAmend = useCallback(async () => {
    const message = text.trim();
    if (!message || busyRef.current) {
      return;
    }
    const requestedRepoPath = repoPath;
    setOperationBusy(true);
    setError(null);
    try {
      const outcome = await ipc.executeWrite({ kind: "amend_commit", message });
      if (repoPathRef.current === requestedRepoPath) {
        await applyOutcome("amend_commit", outcome);
      }
    } catch (err) {
      if (repoPathRef.current === requestedRepoPath) {
        const message = errorText(err);
        setError(message);
        setPendingGate(null);
        publishOperationNotice(writeErrorNotice("amend_commit", message), requestedRepoPath);
      }
    } finally {
      setOperationBusy(false);
    }
  }, [applyOutcome, repoPath, setOperationBusy, text]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  };

  const canSubmit =
    text.trim().length > 0 && !busy && !amendLoading && !disabled && (amend || hasStaged || unborn);

  return (
    <section className="commit-composer" aria-label={t("staging.commitComposerLabel")}>
      <button
        className="commit-composer-toggle"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((current) => !current)}
      >
        <Icon name="chevronDown" className="file-tree-chevron" />
        <strong>{t("staging.commitTitle")}</strong>
        <span className="muted commit-composer-hint">
          {t("staging.commitShortcutHint", { modifier: primaryModifierLabel() })}
        </span>
      </button>

      {!collapsed && (
        <div className="commit-composer-body" onKeyDown={onKeyDown}>
          <textarea
            className="description-input commit-composer-input"
            rows={4}
            disabled={busy || amendLoading}
            placeholder={t("staging.commitMessagePlaceholder")}
            aria-label={t("staging.commitMessageLabel")}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          {templatePath && text.trim().length > 0 && (
            <p className="muted commit-template-hint" title={templatePath}>
              {t("staging.commitTemplateHint")}
            </p>
          )}
          <label className="commit-amend-row">
            <input
              type="checkbox"
              checked={amend}
              disabled={amendDisabled || amendLoading || busy}
              onChange={(event) => void onAmendToggle(event.target.checked)}
            />
            {t("staging.amendToggle")}
          </label>
          {amendLoading && <p className="muted confirm-hint">{t("staging.amendLoadingMessage")}</p>}
          {amendDisabled && <p className="muted confirm-hint">{t("staging.amendUnbornHint")}</p>}
          {amend && !amendLoading && (
            <div className="commit-amend-hints">
              <p>{t(pushedRisk ? "staging.amendRewriteHint" : "staging.amendLocalHint")}</p>
              <p>{t("staging.amendReflogHint")}</p>
            </div>
          )}
          {amendError && <p className="danger-text">{amendError}</p>}
          {issues && (
            <GateReportView gate={null} gateError={null} validating={false} issues={issues} />
          )}
          {error && <p className="danger-text commit-composer-error">{error}</p>}
          <footer className="commit-composer-actions">
            <button className="primary" onClick={() => void submit()} disabled={!canSubmit}>
              {busy ? t("staging.commitSubmitting") : t("staging.commitSubmit")}
            </button>
          </footer>
        </div>
      )}

      {pendingGate && (
        <AmendConfirmDialog
          gate={pendingGate}
          pushedRisk={pushedRisk}
          busy={busy}
          onCancel={() => setPendingGate(null)}
          onConfirm={() => void confirmAmend()}
        />
      )}
    </section>
  );
}
