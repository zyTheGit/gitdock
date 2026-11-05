import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { i18next } from "../../i18n";
import { errorText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import type { ExternalToolConfig, SettingsDto } from "../../shared/types";

const EMPTY_TOOL: ExternalToolConfig = {
  name: "",
  executable: "",
  args_template: "$LOCAL $REMOTE",
};

/** 设置对话框的草稿状态：改动先留在本地，点「保存」才写回后端。 */
export function useSettingsDraft(
  settings: SettingsDto,
  fontScale: number,
  onError: (message: string) => void,
) {
  const [tools, setTools] = useState<ExternalToolConfig[]>(() =>
    settings.external_tools.map((tool) => ({ ...tool })),
  );
  const [restore, setRestore] = useState(settings.restore_last_repository);
  const [watch, setWatch] = useState(settings.watch_enabled);
  const [lazygitPath, setLazygitPath] = useState(settings.lazygit_path ?? "");

  const [defaultTool, setDefaultTool] = useState<string | null>(
    settings.default_tool ?? null,
  );
  const [saving, setSaving] = useState(false);

  const update = (index: number, patch: Partial<ExternalToolConfig>) => {
    const previousName = tools[index]?.name;
    setTools((current) =>
      current.map((tool, position) => (position === index ? { ...tool, ...patch } : tool)),
    );
    // 重命名默认工具时同步默认项，避免保存后默认失效。
    if (patch.name !== undefined && defaultTool !== null && defaultTool === previousName) {
      setDefaultTool(patch.name);
    }
  };

  const removeTool = (index: number) => {
    const removed = tools[index];
    setTools((current) => current.filter((_, position) => position !== index));
    if (removed && defaultTool === removed.name) {
      setDefaultTool(null);
    }
  };

  const addTool = () => setTools((current) => current.concat({ ...EMPTY_TOOL }));

  // 原生文件选择器：用户不必手输安装路径。
  const browse = async (index: number) => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        title: i18next.t("settings.draftSelectToolTitle"),
      });
      if (typeof selected === "string") {
        update(index, { executable: selected });
      }
    } catch (err) {
      onError(errorText(err));
    }
  };

  const browseLazygit = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        title: i18next.t("settings.draftSelectLazygitTitle"),
      });
      if (typeof selected === "string") {
        setLazygitPath(selected);
      }
    } catch (err) {
      onError(errorText(err));
    }
  };

  const save = async (): Promise<SettingsDto | null> => {
    const cleaned = tools
      .map((tool) => ({ ...tool, name: tool.name.trim(), executable: tool.executable.trim() }))
      .filter((tool) => tool.name && tool.executable);
    setSaving(true);
    try {
      // 工具被删除或改名为空时，默认项随之失效。
      const nextDefault = cleaned.some((tool) => tool.name === defaultTool)
        ? defaultTool
        : null;
      return await ipc.saveSettings({
        ...settings,
        external_tools: cleaned,
        default_tool: nextDefault,
        restore_last_repository: restore,
        watch_enabled: watch,
        lazygit_path: lazygitPath.trim() || null,

        font_scale: fontScale,
      });
    } catch (err) {
      onError(errorText(err));
      return null;
    } finally {
      setSaving(false);
    }
  };

  return {
    tools,
    restore,
    setRestore,
    watch,
    setWatch,
    lazygitPath,
    setLazygitPath,

    defaultTool,
    setDefaultTool,
    saving,
    update,
    removeTool,
    addTool,
    browse,
    browseLazygit,
    save,
  };
}
