import { useState } from "react";
import { useI18n } from "../../i18n";
import { RemoteWriteDialog } from "../write/RemoteWriteDialog";
import { RemotePicker } from "./RemotePicker";
import { defaultRemote } from "./remotes";
import type { WriteRequest } from "../../shared/types";

interface PushUpstreamDialogProps {
  /** 当前检出的本地分支。 */
  branch: string;
  /** 仓库已配置的 remote 名（来自远程跟踪引用缓存）。 */
  remotes: string[];
  onCancel: () => void;
  onMutated: (message: string) => Promise<void>;
}

/**
 * 首次推送并建立上游（ADR-0028）：push 因 `gate_remote_no_upstream` 被拒后的替代流程。
 * 默认 remote 为 origin（或唯一配置的 remote）；多远程且无 origin 时要求显式选择。
 * 不自动执行：必须看清 Gate 摘要并点击确认。
 */
export function PushUpstreamDialog({
  branch,
  remotes,
  onCancel,
  onMutated,
}: PushUpstreamDialogProps) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string | null>(() => defaultRemote(remotes));
  const ambiguous = defaultRemote(remotes) === null;

  const request: WriteRequest | null = selected
    ? { kind: "push_set_upstream", branch, remote: selected }
    : null;

  return (
    <RemoteWriteDialog
      request={request}
      title={t("repository.pushUpstreamTitle")}
      target={selected ? `${selected}/${branch}` : branch}
      hint={
        selected
          ? t("repository.pushUpstreamHint", { branch, remote: selected })
          : t("repository.pushUpstreamHintPick", { branch })
      }
      warning={t("repository.pushUpstreamWarning")}
      missingHint={ambiguous ? t("repository.pushUpstreamAmbiguous") : undefined}
      confirmLabel={t("repository.pushUpstreamConfirm")}
      busyLabel={t("repository.pushUpstreamBusy")}
      onCancel={onCancel}
      onMutated={onMutated}
    >
      {ambiguous ? (
        <RemotePicker
          id="push-upstream-remote"
          remotes={remotes}
          value={selected}
          onChange={setSelected}
        />
      ) : (
        <p className="muted confirm-hint">
          {t("repository.pushRemoteResolved", { remote: selected ?? "" })}
        </p>
      )}
    </RemoteWriteDialog>
  );
}
