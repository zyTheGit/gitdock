import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { errorText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import type { ExternalToolConfig, SettingsDto } from "../../shared/types";

interface SettingsDialogProps {
  settings: SettingsDto;
  onClose: () => void;
  onSaved: (settings: SettingsDto) => void;
  onError: (message: string) => void;
}

const EMPTY_TOOL: ExternalToolConfig = { name: "", executable: "", args_template: "$LOCAL $REMOTE" };

/** 外部对比工具只保存名称、可执行文件与参数模板；后端按参数数组调用，不经 shell。 */
export function SettingsDialog({ settings, onClose, onSaved, onError }: SettingsDialogProps) {
  const [tools, setTools] = useState<ExternalToolConfig[]>(
    settings.external_tools.map((tool) => ({ ...tool })),
  );
  const [restore, setRestore] = useState(settings.restore_last_repository);
  const [watch, setWatch] = useState(settings.watch_enabled);
  const [saving, setSaving] = useState(false);

  const update = (index: number, patch: Partial<ExternalToolConfig>) => {
    setTools((current) =>
      current.map((tool, position) => (position === index ? { ...tool, ...patch } : tool)),
    );
  };

  // 原生文件选择器：用户不必手输安装路径。
  const browse = async (index: number) => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        title: "选择对比工具可执行文件",
      });
      if (typeof selected === "string") {
        update(index, { executable: selected });
      }
    } catch (err) {
      onError(errorText(err));
    }
  };

  const save = async () => {
    const cleaned = tools
      .map((tool) => ({ ...tool, name: tool.name.trim(), executable: tool.executable.trim() }))
      .filter((tool) => tool.name && tool.executable);
    setSaving(true);
    try {
      const saved = await ipc.saveSettings({
        ...settings,
        external_tools: cleaned,
        restore_last_repository: restore,
        watch_enabled: watch,
      });
      onSaved(saved);
      onClose();
    } catch (err) {
      onError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="settings-dialog">
        <header>
          <h2>设置</h2>
          <button className="detail-close" onClick={onClose} aria-label="关闭设置">
            ×
          </button>
        </header>

        <section>
          <h3>启动</h3>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={restore}
              onChange={(event) => setRestore(event.target.checked)}
            />
            启动时恢复上次打开的仓库
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={watch}
              onChange={(event) => setWatch(event.target.checked)}
            />
            监视 Git 目录变化并自动刷新（外部 commit、切换分支等）
          </label>
        </section>

        <section>
          <h3>外部文件对比工具</h3>
          <p className="muted settings-hint">
            参数模板中 <code>$LOCAL</code> / <code>$REMOTE</code> 必须各自独立成段；程序按参数数组启动，不经过 shell。
          </p>
          {tools.length === 0 && <p className="muted">尚未配置外部工具。</p>}
          <ul className="tool-list">
            {tools.map((tool, index) => (
              <li key={index}>
                <label>
                  名称
                  <input
                    value={tool.name}
                    placeholder="例如 Beyond Compare"
                    onChange={(event) => update(index, { name: event.target.value })}
                  />
                </label>
                <label>
                  可执行文件
                  <span className="tool-path">
                    <input
                      value={tool.executable}
                      placeholder="完整路径，例如 C:\\Program Files\\...\\BCompare.exe"
                      onChange={(event) => update(index, { executable: event.target.value })}
                    />
                    <button type="button" onClick={() => void browse(index)}>
                      浏览…
                    </button>
                  </span>
                </label>
                <label>
                  参数模板
                  <input
                    className="mono"
                    value={tool.args_template}
                    onChange={(event) => update(index, { args_template: event.target.value })}
                  />
                </label>
                <button
                  className="link danger-text"
                  onClick={() => setTools((current) => current.filter((_, p) => p !== index))}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
          <button onClick={() => setTools((current) => current.concat({ ...EMPTY_TOOL }))}>
            添加工具
          </button>
        </section>

        <footer>
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={() => void save()} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </button>
        </footer>
      </div>
    </div>
  );
}
