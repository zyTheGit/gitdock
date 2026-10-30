import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { errorText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import { Modal } from "../../shared/Modal";
import type { AppInfoDto, ExternalToolConfig, SettingsDto } from "../../shared/types";
import { FeedbackDialog } from "./FeedbackDialog";

interface SettingsDialogProps {
  settings: SettingsDto;
  info: AppInfoDto | null;
  fontScale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onClose: () => void;
  onSaved: (settings: SettingsDto) => void;
  onError: (message: string) => void;
}

const EMPTY_TOOL: ExternalToolConfig = { name: "", executable: "", args_template: "$LOCAL $REMOTE" };
const MIN_SCALE = 0.75;
const MAX_SCALE = 2;

/** 外部对比工具只保存名称、可执行文件与参数模板；后端按参数数组调用，不经 shell。 */
export function SettingsDialog({
  settings,
  info,
  fontScale,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onClose,
  onSaved,
  onError,
}: SettingsDialogProps) {
  const [tools, setTools] = useState<ExternalToolConfig[]>(
    settings.external_tools.map((tool) => ({ ...tool })),
  );
  const [restore, setRestore] = useState(settings.restore_last_repository);
  const [watch, setWatch] = useState(settings.watch_enabled);
  const [lazygitPath, setLazygitPath] = useState(settings.lazygit_path ?? "");
  const [defaultTool, setDefaultTool] = useState<string | null>(
    settings.default_tool ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

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

  const browseLazygit = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        title: "选择 LazyGit 可执行文件",
      });
      if (typeof selected === "string") {
        setLazygitPath(selected);
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
      // 工具被删除或改名为空时，默认项随之失效。
      const nextDefault = cleaned.some((tool) => tool.name === defaultTool)
        ? defaultTool
        : null;
      const saved = await ipc.saveSettings({
        ...settings,
        external_tools: cleaned,
        default_tool: nextDefault,
        restore_last_repository: restore,
        watch_enabled: watch,
        lazygit_path: lazygitPath.trim() || null,
        font_scale: fontScale,
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
    <>
      <Modal className="settings-dialog">
      <header>
        <h2>设置</h2>
        <button className="detail-close" onClick={onClose} aria-label="关闭设置">
          ×
        </button>
      </header>
      <div className="settings-body">
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
          <h3>外观</h3>
          <p className="muted settings-hint">
            颜色跟随 Windows 系统的浅色/深色设置，不提供应用内主题覆盖；终端内容保持深色
            ANSI 配色。
          </p>
          <div className="zoom-row">
            <span>界面缩放</span>
            <button type="button" onClick={onZoomOut} disabled={fontScale <= MIN_SCALE}>
              缩小
            </button>
            <button type="button" className="mono" onClick={onResetZoom} disabled={fontScale === 1}>
              {Math.round(fontScale * 100)}%
            </button>
            <button type="button" onClick={onZoomIn} disabled={fontScale >= MAX_SCALE}>
              放大
            </button>
          </div>
          <p className="muted settings-hint">
            快捷键：<kbd>Ctrl</kbd>+<kbd>=</kbd> 放大，<kbd>Ctrl</kbd>+<kbd>-</kbd> 缩小，
            <kbd>Ctrl</kbd>+<kbd>0</kbd> 恢复 100%。调整立即生效并保存。
          </p>
        </section>

        <section>
          <h3>终端</h3>
          <p className="muted settings-hint">
            GitDock 不捆绑 LazyGit。留空时从 PATH 查找；填写后只使用该文件，找不到会在终端面板提示。
            终端以当前用户权限、在当前打开的仓库目录中运行。
          </p>
          <label>
            LazyGit 可执行文件
            <span className="tool-path">
              <input
                className="mono"
                value={lazygitPath}
                placeholder="留空则从 PATH 查找 LazyGit，例如 C:\Users\me\scoop\shims\lazygit.exe"
                onChange={(event) => setLazygitPath(event.target.value)}
              />
              <button type="button" onClick={() => void browseLazygit()}>
                浏览…
              </button>
            </span>
          </label>
        </section>

        <section className="settings-tools">
          <h3>外部文件对比工具</h3>
          <p className="muted settings-hint">
            参数模板中 <code>$LOCAL</code> / <code>$REMOTE</code> 必须各自独立成段；程序按参数数组启动，不经过 shell。
            首次启动会按当前系统探测已安装的 VS Code / Beyond Compare / Zed，作为内置默认并选中第一项；
            所有工具都可以修改或删除，新增工具无需改动程序代码。
          </p>
          <p className="muted settings-hint">
            示例：VS Code / Zed 用 <code>--diff $LOCAL $REMOTE</code>，Beyond Compare 用{" "}
            <code>$LOCAL $REMOTE</code>；只传两个路径会打开两个独立文件而不是差异视图；未指定默认工具时使用列表第一项。
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
                        placeholder="完整路径，例如 C:\Program Files\...\BCompare.exe"
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
                  <div className="tool-actions">
                    <label className="settings-check">
                      <input
                        type="radio"
                        name="default-tool"
                        checked={defaultTool === tool.name && tool.name !== ""}
                        disabled={!tool.name.trim()}
                        onChange={() => setDefaultTool(tool.name)}
                      />
                      设为默认对比工具
                    </label>
                    <button className="link danger-text" onClick={() => removeTool(index)}>
                      删除
                    </button>
                  </div>
                </li>
              ))}
          </ul>
          <button onClick={() => setTools((current) => current.concat({ ...EMPTY_TOOL }))}>
            添加工具
          </button>
        </section>

        <section>
          <h3>关于</h3>
          {info ? (
            <dl className="about-grid">
              <dt>版本</dt>
              <dd className="mono">{info.app_version}</dd>
              <dt>平台</dt>
              <dd className="mono">{info.platform}</dd>
              <dt>Git</dt>
              <dd className="mono">
                {info.git_version ?? "未检测到"}（最低 {info.minimum_git_version}）
              </dd>
            </dl>
          ) : (
            <p className="muted">正在读取版本信息…</p>
          )}
          <div className="about-actions">
            <button type="button" onClick={() => setFeedbackOpen(true)} disabled={!info}>
              提交 Issue…
            </button>
          </div>
          <p className="muted settings-hint">
            反馈框只预填应用版本、操作系统与 Git 版本，不含日志或仓库路径；点击后由你在浏览器中检查并提交。
          </p>
        </section>
      </div>
      <footer>
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={() => void save()} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </button>
      </footer>
    </Modal>
      {feedbackOpen && info && (
        <FeedbackDialog info={info} onClose={() => setFeedbackOpen(false)} onError={onError} />
      )}
    </>
  );
}
