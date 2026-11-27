import type { WorktreeMessages } from "../zh-CN/worktree";

/** worktree 域英文资源；用 satisfies 保证与 zh-CN 的 key 结构同构。 */
const worktree = {
  title: "Worktrees",
  refreshTitle: "Reload the worktree list",
  create: "New",
  openTitle: "Open {{path}} in a tab",
  loading: "Reading worktrees…",
  empty: "No worktrees were returned.",
  mainBadge: "main",
  linkedBadge: "linked",
  mainRemoveTitle: "The main worktree cannot be removed",
  lockedBadge: "locked",
  lockedTitle: "Locked: {{reason}}",
  lockedNoReason: "Locked (no reason recorded)",
  prunableBadge: "prunable",
  prunableTitle: "The directory is gone or unreadable; this app never prunes automatically",
  detached: "detached",
  detachedBadge: "detached",
  detachedTitle: "This worktree has no branch checked out (detached HEAD)",
  remove: "Remove",
  createTitle: "New worktree",
  createSubtitle:
    "Check out an existing local branch into a target directory as a linked worktree; no branch is created.",
  branchLabel: "Source branch",
  branchPlaceholder: "Choose a local branch",
  noBranches: "This repository has no local branch to check out.",
  pathLabel: "Target directory",
  pathPlaceholder: "No directory selected",
  pickDirectory: "Choose directory…",
  pickDialogTitle: "Choose the worktree target directory",
  commandPreview: "git worktree add {{path}} {{branch}}",
  createHint:
    "The target must be missing or empty and its parent must exist; this app never creates parent directories.",
  createSubmit: "Create",
  creating: "Creating…",
  removeTitle: "Remove worktree",
  removeSubtitle: "Only linked worktrees in the list can be removed; the main worktree is never removed.",
  removeWarning:
    "The directory is deleted from disk and uncommitted changes in it are lost. Git refuses to remove a dirty worktree; this app never uses --force.",
  removeConfirm: "Remove worktree",
  removing: "Removing…",
} satisfies WorktreeMessages;

export default worktree;
