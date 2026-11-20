import { useI18n } from "../../i18n";
import { Select } from "../../shared/Select";

interface RemotePickerProps {
  id: string;
  remotes: string[];
  value: string | null;
  onChange: (remote: string | null) => void;
  disabled?: boolean;
}

/** 多远程且无 origin 时的远程选择（ADR-0028 §3 的 ambiguity 分支）。 */
export function RemotePicker({ id, remotes, value, onChange, disabled }: RemotePickerProps) {
  const { t } = useI18n();
  return (
    <>
      <label className="ref-field-label" htmlFor={id}>
        {t("repository.pushRemoteLabel")}
      </label>
      <Select
        id={id}
        block
        disabled={disabled}
        value={value ?? ""}
        options={[
          { value: "", label: t("repository.pushRemotePlaceholder") },
          ...remotes.map((remote) => ({ value: remote, label: remote })),
        ]}
        onChange={(event) => onChange(event.target.value || null)}
      />
    </>
  );
}
