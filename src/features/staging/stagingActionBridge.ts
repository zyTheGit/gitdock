export interface StagingActionSelection {
  path: string;
  side: "staged" | "unstaged";
}

export interface StagingActionHandlers {
  refresh: () => void;
  stageFile: (path: string) => void;
  unstageFile: (path: string) => void;
  discardFile: (path: string) => void;
}

export interface StagingActionBridgeRef {
  current: StagingActionHandlers | null;
}
