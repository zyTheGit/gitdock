import type { ExternalToolConfig } from "../../shared/types";

interface ToolsSectionProps {
  active: boolean;
  tools: ExternalToolConfig[];
  defaultTool: string | null;
  onUpdate: (index: number, patch: Partial<ExternalToolConfig>) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
  onBrowse: (index: number) => Promise<void>;
  onSetDefault: (name: string) => void;
}

/** 外部对比工具只保存名称、可执行文件与参数模板；后端按参数数组调用，不经 shell。 */
export function ToolsSection({
  active,
  tools,
  defaultTool,
  onUpdate,
  onRemove,
  onAdd,
  onBrowse,
  onSetDefault,
}: ToolsSectionProps) {
  return (
    <section id="settings-tools" className="settings-tools" hidden={!active}>
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
                onChange={(event) => onUpdate(index, { name: event.target.value })}
              />
            </label>
            <label>
              可执行文件
              <span className="tool-path">
                <input
                  value={tool.executable}
                  placeholder="完整路径，例如 C:\Program Files\...\BCompare.exe"
                  onChange={(event) => onUpdate(index, { executable: event.target.value })}
                />
                <button type="button" onClick={() => void onBrowse(index)}>
                  浏览…
                </button>
              </span>
            </label>
            <label>
              参数模板
              <input
                className="mono"
                value={tool.args_template}
                onChange={(event) => onUpdate(index, { args_template: event.target.value })}
              />
            </label>
            <div className="tool-actions">
              <label className="settings-check">
                <input
                  type="radio"
                  name="default-tool"
                  checked={defaultTool === tool.name && tool.name !== ""}
                  disabled={!tool.name.trim()}
                  onChange={() => onSetDefault(tool.name)}
                />
                设为默认对比工具
              </label>
              <button className="link danger-text" onClick={() => onRemove(index)}>
                删除
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button onClick={onAdd}>添加工具</button>
    </section>
  );
}
