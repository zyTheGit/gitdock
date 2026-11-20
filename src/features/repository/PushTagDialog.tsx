import { useState } from "react";
import { useI18n } from "../../i18n";
import { RemoteWriteDialog } from "../write/RemoteWriteDialog";
import { RemotePicker } from "./RemotePicker";
import { defaultRemote } from "./remotes";
import type { WriteRequest } from "../../shared/types";

interface PushTagDialogProps {
  /** 本地标签名。 */
  tag: string;
  /** 仓库已配置的 remote 名（来自远程跟踪引用缓存）。 */
  remotes: string[];
  onCancel: () => void;
  onMutated: (message: string) => Promise<void>;
}

/**
 * 推送本地标签（ADR-0028）：`git push <remote> refs/tags/<tag>`。
 * 只提供普通推送，没有 force / 删除入口；执行前必须确认。
 */
export function PushTagDialog({ tag, remotes, onCancel, onMutated }: PushTagDialogProps) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string | null>(() => defaultRemote(remotes));
  const ambiguous = defaultRemote(remotes) === null;

  const request: WriteRequest | null = selected
    ? { kind: "push_tag", branch: tag, remote: selected }
    : null;

  return (
    <RemoteWriteDialog
      request={request}
      title={t("repository.pushTagTitle")}
      target={selected ? `${selected}:refs/tags/${tag}` : tag}
      hint={
        selected
          ? t("repository.pushTagHint", { tag, remote: selected })
          : t("repository.pushTagHintPick", { tag })
      }
      warning={t("repository.pushTagWarning")}
      missingHint={ambiguous ? t("repository.pushTagAmbiguous") : undefined}
      confirmLabel={t("repository.pushTagConfirm")}
      busyLabel={t("repository.pushTagBusy")}
      onCancel={onCancel}
      onMutated={onMutated}
    >
      {ambiguous ? (
        <RemotePicker id="push-tag-remote" remotes={remotes} value={selected} onChange={setSelected} />
      ) : (
        <p className="muted confirm-hint">
          {t("repository.pushRemoteResolved", { remote: selected ?? "" })}
        </p>
      )}
    </RemoteWriteDialog>
  );
}
