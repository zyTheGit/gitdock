import { useEffect, useState } from "react";
import type { LanguagePreference } from "../../i18n";
import { Modal } from "../../shared/Modal";
import type {
  AppInfoDto,
  SettingsDto,
  UpdateCheckDto,
  UpdateCheckOutcome,
  UpdateCheckState,
} from "../../shared/types";
import { AboutSection } from "./AboutSection";
import { AppearanceSection } from "./AppearanceSection";
import { FeedbackDialog } from "./FeedbackDialog";
import { GitConfigSection } from "./GitConfigSection";
import { KeyBindingsSection } from "./KeyBindingsSection";
import { SettingsNav } from "./SettingsNav";
import type { SettingsSectionKey } from "./settingsSections";
import { StartupSection } from "./StartupSection";
import { TerminalSection } from "./TerminalSection";
import { ToolsSection } from "./ToolsSection";
import { useSettingsDraft } from "./useSettingsDraft";

interface SettingsDialogProps {
  settings: SettingsDto;
  /** 当前语言偏好；语言切换即时生效，不经过草稿「保存」。 */
  language: LanguagePreference;
  onLanguageChange: (preference: LanguagePreference) => void;
  info: AppInfoDto | null;
  fontScale: number;
  /** 更新检查状态与「关于」分区动作：App 持有 useUpdateCheck 单例后经 props 注入。 */
  updateCheck: UpdateCheckState;
  updateOffer: UpdateCheckDto | null;
  onCheckUpdate: () => Promise<UpdateCheckOutcome>;
  onOpenDownloadPage: () => Promise<UpdateCheckOutcome>;
  onSkipUpdate: () => void;
  onClearSkippedUpdate: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onClose: () => void;
  onSaved: (settings: SettingsDto) => void;
  onError: (message: string) => void;
}

export function SettingsDialog({
  settings,
  language,
  onLanguageChange,
  info,
  fontScale,
  updateCheck,
  updateOffer,
  onCheckUpdate,
  onOpenDownloadPage,
  onSkipUpdate,
  onClearSkippedUpdate,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onClose,
  onSaved,
  onError,
}: SettingsDialogProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>("startup");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // Git 配置要读真实配置文件，首次进入该分区才发起读取；之后保留编辑内容。
  const [gitConfigOpened, setGitConfigOpened] = useState(false);
  const draft = useSettingsDraft(settings, fontScale, onError);

  useEffect(() => {
    if (activeSection === "git-config") setGitConfigOpened(true);
  }, [activeSection]);

  const save = async () => {
    const saved = await draft.save();
    if (!saved) return;
    onSaved(saved);
    onClose();
  };

  return (
    <>
      <Modal className="settings-dialog">
        <header>
          <div className="settings-heading">
            <h2>设置</h2>
            <span className="muted">配置 GitDock 的行为与工具</span>
          </div>
          <button className="detail-close" onClick={onClose} aria-label="关闭设置">
            ×
          </button>
        </header>
        <div className="settings-content">
          <SettingsNav active={activeSection} onChange={setActiveSection} />
          <div className="settings-body">
            <StartupSection
              active={activeSection === "startup"}
              restore={draft.restore}
              watch={draft.watch}
              onRestoreChange={draft.setRestore}
              onWatchChange={draft.setWatch}
            />

            <AppearanceSection
              active={activeSection === "appearance"}
              fontScale={fontScale}
              language={language}
              onLanguageChange={onLanguageChange}
              onZoomIn={onZoomIn}
              onZoomOut={onZoomOut}
              onResetZoom={onResetZoom}
            />

            <section id="settings-keybindings" hidden={activeSection !== "keybindings"}>
              <KeyBindingsSection />
            </section>

            <TerminalSection
              active={activeSection === "terminal"}
              lazygitPath={draft.lazygitPath}
              onLazygitPathChange={draft.setLazygitPath}
              onBrowse={draft.browseLazygit}
            />

            <ToolsSection
              active={activeSection === "tools"}
              tools={draft.tools}
              defaultTool={draft.defaultTool}
              onUpdate={draft.update}
              onRemove={draft.removeTool}
              onAdd={draft.addTool}
              onBrowse={draft.browse}
              onSetDefault={draft.setDefaultTool}
            />

            <section
              id="settings-git-config"
              className="settings-git-config"
              hidden={activeSection !== "git-config"}
            >
              <h3>Git 配置</h3>
              {gitConfigOpened && <GitConfigSection onError={onError} />}
            </section>

            <AboutSection
              active={activeSection === "about"}
              info={info}
              updateCheck={updateCheck}
              updateOffer={updateOffer}
              onCheckUpdate={onCheckUpdate}
              onOpenDownloadPage={onOpenDownloadPage}
              onSkipUpdate={onSkipUpdate}
              onClearSkippedUpdate={onClearSkippedUpdate}
              onOpenFeedback={() => setFeedbackOpen(true)}
            />
          </div>
        </div>
        <footer>
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={() => void save()} disabled={draft.saving}>
            {draft.saving ? "保存中…" : "保存"}
          </button>
        </footer>
      </Modal>
      {feedbackOpen && info && (
        <FeedbackDialog info={info} onClose={() => setFeedbackOpen(false)} onError={onError} />
      )}
    </>
  );
}
