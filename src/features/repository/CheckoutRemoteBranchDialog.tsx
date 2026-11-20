import { useState } from "react";
import { useI18n } from "../../i18n";
import { RemoteWriteDialog } from "../write/RemoteWriteDialog";
import { suggestedLocalBranch } from "./remotes";
import type { WriteRequest } from "../../shared/types";

interface CheckoutRemoteBranchDialogProps {
  /** 远程跟踪短名，形如 `origin/feat-a`。 */
  remoteBranch: string;
  /** 本地已有分支名（来自引用缓存）：同名时直接拒绝，不必等 Gate。 */
  localBranches: string[];
  onCancel: () => void;
  onMutated: (message: string) => Promise<void>;
}

/**
 * 检出远程跟踪分支（ADR-0028）：本地名可改，信息变化后自动重跑 Gate，
 * Gate 的 dirty 警告与受影响路径原样展示，确认后才执行 `git switch -c --track`。
 */
export function CheckoutRemoteBranchDialog({
  remoteBranch,
  localBranches,
  onCancel,
  onMutated,
}: CheckoutRemoteBranchDialogProps) {
  const { t } = useI18n();
  const [localName, setLocalName] = useState(() => suggestedLocalBranch(remoteBranch));
  const name = localName.trim();
  const exists = name.length > 0 && localBranches.includes(name);

  const request: WriteRequest | null =
    name.length > 0 && !exists
      ? { kind: "checkout_remote_branch", branch: remoteBranch, new_name: name }
      : null;

  return (
    <RemoteWriteDialog
      request={request}
      title={t("repository.checkoutRemoteTitle")}
      target={remoteBranch}
      hint={t("repository.checkoutRemoteHint", { branch: remoteBranch })}
      confirmLabel={t("repository.checkoutRemoteConfirm")}
      busyLabel={t("repository.checkoutRemoteBusy")}
      missingHint={exists ? undefined : t("repository.checkoutRemoteNameRequired")}
      onCancel={onCancel}
      onMutated={onMutated}
    >
      <label className="ref-field-label" htmlFor="checkout-remote-local-name">
        {t("repository.checkoutRemoteLocalLabel")}
      </label>
      <input
        id="checkout-remote-local-name"
        className="ref-input"
        type="text"
        autoFocus
        value={localName}
        onChange={(event) => setLocalName(event.target.value)}
      />
      {exists && (
        <p className="danger-text confirm-hint">
          {t("repository.checkoutRemoteLocalExists", { branch: name })}
        </p>
      )}
    </RemoteWriteDialog>
  );
}
