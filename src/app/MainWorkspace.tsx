import type { MouseEvent } from "react";
import { Banners } from "./Banners";
import type { ViewMode } from "./useGlobalEsc";
import type { useBottomPanel } from "./useBottomPanel";
import type { RowMenuState, useCommitMenus } from "./useCommitMenus";
import { DETAIL_WIDTH } from "./usePaneWidths";
import type { usePaneWidths } from "./usePaneWidths";
import { useGraphJump } from "./useGraphJump";
import type { useRemoteActions } from "./useRemoteActions";
import type { useRepositorySession } from "./useRepositorySession";
import type { useStashActions } from "./useStashActions";
import type { useWriteFlow } from "./useWriteFlow";
import type { ScrollRestore } from "./useRepoTabState";
import { WelcomePane } from "./WelcomePane";
import { commitSlot, type CompareLoader, type useCompareSlots } from "../features/compare/useCompare";
import { CompareBar } from "../features/compare/CompareBar";
import { CompareView } from "../features/compare/CompareView";
import { CommitDetailPane } from "../features/detail/CommitDetailPane";
import { GraphPane } from "../features/graph/GraphPane";
import { commitMenuWithBatch } from "../features/graph/menus";
import { FileHistoryDialog } from "../features/history/FileHistoryDialog";
import { ReflogDialog } from "../features/graph/ReflogDialog";
import { ResetDialog } from "../features/write/ResetDialog";
import { StagingView } from "../features/staging/StagingView";
import type {
  StagingActionBridgeRef,
  StagingActionSelection,
} from "../features/staging/stagingActionBridge";
import { useI18n } from "../i18n";
import { PaneSplitter } from "../shared/PaneSplitter";
import { copyText } from "../shared/clipboard";
import type {
  AppInfoDto,
  CommitSummaryDto,
  ExternalToolConfig,
  GraphScope,
  RepoStateDto,
} from "../shared/types";

type Setters = {
  setMode: (mode: ViewMode) => void;
  setScope: (scope: GraphScope) => void;
  setSelectedOid: (oid: string | null) => void;
  setFocusTarget: (target: { oid: string; seq: number } | null) => void;
  setPathFilter: (value: string) => void;
  setTwoDot: (value: boolean) => void;
  setRowMenu: (state: RowMenuState | null) => void;
  setStagingBusy: (busy: boolean) => void;
  setError: (message: string | null) => void;
  setDiagnostic: (text: string | null) => void;
  setToast: (message: string | null) => void;
};

interface MainWorkspaceProps {
  repo: RepoStateDto | null;
  /** 活动仓库变更单调计数：由 useRepositorySession 统一派发给暂存区。 */
  changeTick: number;
  info: AppInfoDto | null;
  busy: boolean;
  /** 新增仓库的导入进行中：欢迎页据此显示「正在打开」。 */
  opening: boolean;
  error: string | null;
  diagnostic: string | null;
  mode: ViewMode;
  scope: GraphScope;
  selectedOid: string | null;
  focusTarget: { oid: string; seq: number } | null;
  pathFilter: string;
  twoDot: boolean;
  tools: ExternalToolConfig[];
  defaultTool: string | null;
  /** 标签切换的滚动恢复与偏移上报（ADR-0032）。 */
  scrollRestore: ScrollRestore;
  /** 状态、hook 与回调均来自 App：这里只负责主区的视图切换，不持有任何状态。 */
  slots: ReturnType<typeof useCompareSlots>;
  compare: CompareLoader;
  commitMenus: ReturnType<typeof useCommitMenus>;
  write: ReturnType<typeof useWriteFlow>;
  remote: ReturnType<typeof useRemoteActions>;
  panes: ReturnType<typeof usePaneWidths>;
  graph: ReturnType<typeof useRepositorySession>["graph"];
  panel: ReturnType<typeof useBottomPanel>;
  stash: ReturnType<typeof useStashActions>;
  launchExternal: (
    toolIndex: number,
    left: string | null,
    right: string,
    path: string,
    threeDot: boolean,
  ) => void;
  launchDirectoryDiff: (toolIndex: number) => void;
  stagingMutated: (message: string) => Promise<void>;
  stagingActionHandlersRef: StagingActionBridgeRef;
  onStagingSelectionChange: (selection: StagingActionSelection | null) => void;
  reflogOpen: boolean;
  setReflogOpen: (open: boolean) => void;
  reflogWriteDisabled: boolean;
  /** 以指定提交为起点打开既有创建分支对话框（Reflog 恢复视图复用，ADR-0029）。 */
  onCreateBranch: (commit: CommitSummaryDto) => void;
  onPick: () => void;
  setters: Setters;
}

/** 主区：顶部横幅 + 对比/暂存区/图谱三选一的视图切换。 */
export function MainWorkspace({
  repo,
  changeTick,
  info,
  busy,
  opening,
  error,
  diagnostic,
  mode,
  scope,
  selectedOid,
  focusTarget,
  pathFilter,
  twoDot,
  tools,
  defaultTool,
  scrollRestore,
  slots,
  compare,
  commitMenus,
  write,
  remote,
  panes,
  graph,
  panel,
  stash,
  launchExternal,
  launchDirectoryDiff,
  stagingMutated,
  stagingActionHandlersRef,
  onStagingSelectionChange,
  reflogOpen,
  setReflogOpen,
  reflogWriteDisabled,
  onCreateBranch,
  onPick,
  setters,
}: MainWorkspaceProps) {
  const { t } = useI18n();
  const {
    setMode,
    setScope,
    setSelectedOid,
    setFocusTarget,
    setPathFilter,
    setTwoDot,
    setRowMenu,
    setStagingBusy,
    setError,
    setDiagnostic,
    setToast,
  } = setters;

  // 详情面板里点击父提交：定位到图谱并切换详情（必要时切到全量范围）。
  const jumpToCommit = useGraphJump({
    scope,
    graph,
    setScope,
    setMode,
    setSelectedOid,
    setFocusTarget,
  });

  return (
    <main className="main">
      <Banners
        repo={repo}
        info={info}
        error={error}
        diagnostic={diagnostic}
        interruptionDisabled={write.interruptionDisabled}
        onInterruptionAction={(kind, interruption) => void write.startInterruption(kind, interruption)}
        onCopyDiagnostic={() => void copyText(diagnostic ?? "")}
        onDismissError={() => { setError(null); setDiagnostic(null); }}
      />

      {repo ? (
        mode === "compare" && slots.base && slots.compare ? (
          <CompareView
            repoGeneration={repo.generation}
            base={slots.base}
            compare={slots.compare}
            loader={compare}
            pathFilter={pathFilter}
            onPathFilterChange={setPathFilter}
            twoDot={twoDot}
            onTwoDotChange={setTwoDot}
            tools={tools}
            defaultTool={defaultTool}
            writeDisabled={write.disabled}
            onCherryPick={write.menuWriteActions.onCherryPick}
            onRevert={write.menuWriteActions.onRevert}
            onBatchCherryPick={write.menuWriteActions.onBatchCherryPick}
            onBatchRevert={write.menuWriteActions.onBatchRevert}
            commitMenu={(commit, selection) =>
              commitMenuWithBatch(
                commit,
                {
                  ...commitMenus.commitActions,
                  onBatchCherryPick: write.menuWriteActions.onBatchCherryPick,
                  onBatchRevert: write.menuWriteActions.onBatchRevert,
                },
                selection,
              )
            }
            onLocateCommit={jumpToCommit}
            onSwap={slots.swap}
            onExternalDiff={(toolIndex, path) => {
              if (slots.base && slots.compare) {
                void launchExternal(toolIndex, slots.base.oid, slots.compare.oid, path, !twoDot);
              }
            }}
            onExternalCommitFileDiff={(toolIndex, left, right, path) => {
              void launchExternal(toolIndex, left, right, path, false);
            }}
            onDirectoryDiff={launchDirectoryDiff}
            onBack={() => setMode("graph")}
          />
        ) : mode === "staging" ? (
          <StagingView
            repo={repo}
            changeTick={changeTick}
            writeDisabled={write.disabled}
            conflictWriteDisabled={write.interruptionDisabled}
            onBusyChange={setStagingBusy}
            onMutated={stagingMutated}
            onOpenStash={stash.openStash}
            onOpenTerminal={panel.openTerminal}
            onExit={() => setMode("graph")}
            actionHandlersRef={stagingActionHandlersRef}
            onSelectionChange={onStagingSelectionChange}
          />
        ) : (
          <>
            <CompareBar
              repo={repo}
              base={slots.base}
              compare={slots.compare}
              pending={slots.pending}
              invalidRef={compare.invalidRef}
              onClear={slots.clear}
              onSetSlot={slots.setSide}
              onSwap={slots.swap}
              onOpenCompare={() => setMode("compare")}
              onResolvePending={slots.resolvePending}
            />
            <div className={selectedOid ? "workspace detail-open" : "workspace"}>
              <GraphPane
                repo={repo}
                scope={scope}
                onScopeChange={(next) => {
                  setScope(next);
                  setSelectedOid(null);
                  setFocusTarget(null);
                }}
                graph={graph}
                selectedOid={selectedOid}
                focusedOid={focusTarget?.oid ?? null}
                focusSeq={focusTarget?.seq ?? null}
                scrollRestore={scrollRestore}
                onSelect={(oid) => {
                  setSelectedOid(oid);
                  setFocusTarget(null);
                }}
                onCtrlSelect={slots.ctrlSelect}
                onContextMenu={(event: MouseEvent, commit: CommitSummaryDto, selectedCommits: CommitSummaryDto[]) => {
                  setRowMenu({ x: event.clientX, y: event.clientY, commit, selection: selectedCommits });
                }}
                remote={remote}
                onOpenReflog={() => setReflogOpen(true)}
                writeDisabled={write.disabled}
                onSingleCherryPick={write.menuWriteActions.onCherryPick}
                onSingleRevert={write.menuWriteActions.onRevert}
                onBatchCherryPick={write.menuWriteActions.onBatchCherryPick}
                onBatchRevert={write.menuWriteActions.onBatchRevert}
                onCompareCommits={(left, right) => {
                  slots.setSide("base", commitSlot(left));
                  slots.setSide("compare", commitSlot(right));
                  setMode("compare");
                }}
                onMutated={stagingMutated}
              />
              {selectedOid && (
                <>
                  <PaneSplitter
                    label={t("shell.detailResizeLabel")}
                    width={panes.detailWidth}
                    min={DETAIL_WIDTH.min}
                    max={panes.detailMax}
                    defaultValue={DETAIL_WIDTH.reset}
                    invert
                    onChange={panes.setDetailWidth}
                  />
                  <CommitDetailPane
                    repo={repo}
                    oid={selectedOid}
                    tools={tools}
                    width={panes.detailWidth}
                    onClose={() => setSelectedOid(null)}
                    onBranchJump={(branch) => {
                      setScope({ kind: "branch", value: branch });
                      setSelectedOid(null);
                      setFocusTarget(null);
                    }}
                    onSelectCommit={jumpToCommit}
                    onExternalDiff={(toolIndex, path, left) =>
                      void launchExternal(toolIndex, left, selectedOid, path, false)
                    }
                  />
                </>
              )}
            </div>
          </>
        )
      ) : (
        <WelcomePane busy={busy} opening={opening} onPick={onPick} />
      )}

      {/* 文件历史 / Blame：目标由模块级 store 触发，定位复用同一个图谱跳转。 */}
      {repo && (
        <FileHistoryDialog
          generation={repo.generation}
          hasExternalTools={tools.length > 0}
          onExternalDiff={(left, right, filePath, isTwoDot) => {
            const idx = Math.max(
              0,
              tools.findIndex((tool) => tool.name === defaultTool),
            );
            void launchExternal(idx, left, right, filePath, !isTwoDot);
          }}
          onLocate={jumpToCommit}
        />
      )}

      {/* 重置确认框（ADR-0029）：目标由右键菜单经 useWriteFlow 传入，模式在框内选择。 */}
      {repo && write.resetTarget && (
        <ResetDialog
          commit={write.resetTarget}
          onCancel={write.closeReset}
          onMutated={stagingMutated}
        />
      )}

      {/* Reflog 恢复视图（ADR-0029）：只读列表，行内动作只派发既有写流程。 */}
      {repo && reflogOpen && (
        <ReflogDialog
          generation={repo.generation}
          writeDisabled={reflogWriteDisabled}
          onClose={() => setReflogOpen(false)}
          onLocate={(oid) => {
            setReflogOpen(false);
            jumpToCommit(oid);
          }}
          onCreateBranch={(commit) => {
            setReflogOpen(false);
            onCreateBranch(commit);
          }}
          onCherryPick={(commit) => {
            setReflogOpen(false);
            write.menuWriteActions.onCherryPick(commit);
          }}
          onToast={setToast}
        />
      )}
    </main>
  );
}
