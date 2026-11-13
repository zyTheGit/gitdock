import { useI18n } from "../../i18n";
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
  const { t } = useI18n();
  return (
    <section id="settings-tools" className="settings-tools" hidden={!active}>
      <h3>{t("settings.toolsTitle")}</h3>
      <p className="muted settings-hint">
        {t("settings.toolsHintTemplateHead")}
        <code>$LOCAL</code> / <code>$REMOTE</code>
        {t("settings.toolsHintTemplateTail")}
        {t("settings.toolsHintDirVars")}
        {t("settings.toolsHintDetect")}
      </p>
      <p className="muted settings-hint">
        {t("settings.toolsHintExampleHead")}
        <code>--diff $LOCAL $REMOTE</code>
        {t("settings.toolsHintExampleMid")}
        <code>$LOCAL $REMOTE</code>
        {t("settings.toolsHintExampleTail")}
      </p>
      {tools.length === 0 && <p className="muted">{t("settings.toolsEmpty")}</p>}
      <ul className="tool-list">
        {tools.map((tool, index) => (
          <li key={index}>
            <label>
              {t("settings.toolsNameLabel")}
              <input
                value={tool.name}
                placeholder={t("settings.toolsNamePlaceholder")}
                onChange={(event) => onUpdate(index, { name: event.target.value })}
              />
            </label>
            <label>
              {t("settings.toolsExecutableLabel")}
              <span className="tool-path">
                <input
                  value={tool.executable}
                  placeholder={t("settings.toolsExecutablePlaceholder")}
                  onChange={(event) => onUpdate(index, { executable: event.target.value })}
                />
                <button type="button" onClick={() => void onBrowse(index)}>
                  {t("settings.browse")}
                </button>
              </span>
            </label>
            <label>
              {t("settings.toolsArgsTemplateLabel")}
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
                {t("settings.toolsSetDefault")}
              </label>
              <button className="link danger-text" onClick={() => onRemove(index)}>
                {t("settings.toolsRemove")}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button onClick={onAdd}>{t("settings.toolsAdd")}</button>
    </section>
  );
}
