import { Icon } from "../assets/icons";
import { useI18n } from "../i18n";
import type { FileListMode } from "./useFileListMode";

interface FileListModeToggleProps {
  mode: FileListMode;
  onChange: (mode: FileListMode) => void;
  className?: string;
}

/**
 * 「扁平列表 / 目录树」切换按钮组。偏好是全局的（useFileListMode），
 * 本组件只负责渲染与取值，不持有状态。
 */
export function FileListModeToggle({ mode, onChange, className }: FileListModeToggleProps) {
  const { t } = useI18n();
  const options = [
    { value: "flat", icon: "fileList", label: t("common.fileListModeFlat") },
    { value: "tree", icon: "treeView", label: t("common.fileListModeTree") },
  ] as const;

  return (
    <div
      className={["view-toggle", "file-list-toggle", className].filter(Boolean).join(" ")}
      role="group"
      aria-label={t("common.fileListModeLabel")}
    >
      {options.map((option) => (
        <button
          key={option.value}
          className={mode === option.value ? "active" : ""}
          onClick={() => onChange(option.value)}
          title={option.label}
          aria-label={option.label}
          aria-pressed={mode === option.value}
        >
          <Icon name={option.icon} />
        </button>
      ))}
    </div>
  );
}
