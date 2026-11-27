import { useState } from "react";
import { useI18n } from "../../i18n";
import { Modal } from "../../shared/Modal";
import { useEscClose } from "../../shared/useEscClose";
import { FileBlameView } from "./FileBlameView";
import { FileHistoryView } from "./FileHistoryView";
import {
  closeFileHistory,
  useFileHistoryTarget,
  type FileHistoryTab,
  type FileHistoryTarget,
} from "./fileHistoryTarget";

interface FileHistoryDialogProps {
  /** 仓库 generation：用于丢弃刷新前发出的过期响应。 */
  generation: number;
  hasExternalTools?: boolean;
  onExternalDiff?: (left: string | null, right: string, path: string, twoDot: boolean) => void;
  /** 定位提交：由主工作区提供（切图谱 + 选中 + 居中）。 */
  onLocate: (oid: string) => void;
}

/**
 * 文件历史 / Blame 的宽幅对话框。目标来自模块级 store，任何视图右键文件即可
 * 打开，不需要逐层透传回调；关闭（target 变 null）即整体卸载，Esc 关闭层也随
 * 之释放，不会吃掉主界面的 Esc。
 */
export function FileHistoryDialog({
  generation,
  hasExternalTools = false,
  onExternalDiff,
  onLocate,
}: FileHistoryDialogProps) {
  const target = useFileHistoryTarget();
  if (!target) {
    return null;
  }
  return (
    <FileHistoryPanel
      key={`${target.oid}:${target.path}:${target.tab}`}
      target={target}
      generation={generation}
      hasExternalTools={hasExternalTools}
      onExternalDiff={onExternalDiff}
      onLocate={onLocate}
    />
  );
}

interface FileHistoryPanelProps {
  target: FileHistoryTarget;
  generation: number;
  hasExternalTools: boolean;
  onExternalDiff?: (left: string | null, right: string, path: string, twoDot: boolean) => void;
  onLocate: (oid: string) => void;
}

/** 打开后的对话框本体：页签状态与 Esc 层只在可见期间存在。 */
function FileHistoryPanel({
  target,
  generation,
  hasExternalTools,
  onExternalDiff,
  onLocate,
}: FileHistoryPanelProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<FileHistoryTab>(target.tab);

  // 弹层 Esc：只关闭本层（捕获阶段消费，避免连带退出主视图）。
  useEscClose(closeFileHistory);

  // 定位前先关闭弹框：图谱切换与选中在对话框消失后完成。
  const locate = (oid: string) => {
    closeFileHistory();
    onLocate(oid);
  };
  const viewKey = `${target.oid}:${target.path}`;

  return (
    <Modal className="history-dialog" onBackdropClick={closeFileHistory}>
      <header>
        <div className="history-heading">
          <h2>{t("history.title")}</h2>
          <span className="history-path mono" title={target.path}>
            {target.path}
          </span>
        </div>
        <button
          type="button"
          className="detail-close"
          onClick={closeFileHistory}
          aria-label={t("history.closeAria")}
        >
          ×
        </button>
      </header>

      <div className="history-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "history"}
          className={tab === "history" ? "active" : ""}
          onClick={() => setTab("history")}
        >
          {t("history.tabHistory")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "blame"}
          className={tab === "blame" ? "active" : ""}
          onClick={() => setTab("blame")}
        >
          {t("history.tabBlame")}
        </button>
      </div>

      <div className="history-body">
        {tab === "history" ? (
          <FileHistoryView
            key={viewKey}
            path={target.path}
            oid={target.oid}
            generation={generation}
            hasExternalTools={hasExternalTools}
            onExternalDiff={onExternalDiff}
            onLocate={locate}
          />
        ) : (
          <FileBlameView
            key={viewKey}
            path={target.path}
            oid={target.oid}
            generation={generation}
            onLocate={locate}
          />
        )}
      </div>

      <footer className="history-foot">
        {target.origin === "staging" && (
          <span className="muted">{t("history.stagingNote")}</span>
        )}
        <span className="muted">{t("history.limitations")}</span>
      </footer>
    </Modal>
  );
}
