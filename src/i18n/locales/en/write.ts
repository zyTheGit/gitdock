import type { WriteMessages } from "../zh-CN/write";

/** write 域英文资源；用 satisfies 保证与 zh-CN 的 key 结构同构。 */
const write = {
  // Operation names: shared by the confirm dialog and outcome messages.
  labelCherryPick: "Cherry Pick",
  labelRevert: "Revert",
  labelSwitchBranch: "Switch branch",
  labelSetBranchDescription: "Update branch description",
  labelStageFiles: "Stage files",
  labelUnstageFiles: "Unstage files",
  labelContinueOperation: "Continue operation",
  labelAbortOperation: "Abort operation",
  labelCreateCommit: "Create commit",
  labelAmendCommit: "Amend commit",
  labelCreateBranch: "Create branch",
  labelDeleteBranch: "Delete branch",
  labelDeleteBranchRemote: "Delete local & remote branch",
  labelRenameBranch: "Rename branch",
  labelCreateTag: "Create tag",
  labelDeleteTag: "Delete tag",
  labelSetTagDescription: "Update tag description",
  labelStashSave: "Save stash",
  labelStashApply: "Apply stash",
  labelStashPop: "Pop stash",
  labelStashDrop: "Delete stash",
  labelFetch: "Fetch",
  labelPull: "Pull",
  labelPush: "Push",
  labelMerge: "Merge into current",
  labelRebase: "Rebase onto this branch",
  batchOrderHint: "Will run in this order, {{n}} commits",
  // Outcome messages (status-bar toast).
  outcomeSwitchedToBranch: "Switched to branch {{branch}}",
  outcomeContinueDone: "Operation continued and completed; graph refreshed",
  outcomeAbortDone: "Operation aborted and restored to the pre-operation state; graph refreshed",
  outcomeSucceeded: "{{label}} succeeded; graph refreshed",
  outcomeEmptyPick: "No changes (empty pick); operation state cleaned up",
  outcomeConflicted:
    "Conflicts occurred: resolve them in the terminal and run git add. This app only offers Continue / Abort for a single cherry-pick / revert, and only after you click and confirm; it never runs --abort / --quit / --skip automatically.",
  outcomeRejected: "Pre-write check failed; nothing was executed",
  outcomeFailed: "{{label}} failed: {{message}}",
  outcomeFailedWithSkip:
    "{{base}}; if Git reports an empty result, run {{skip}} in the terminal to skip this operation (this app never skips automatically)",
  // Confirm dialog: titles, action hints, and buttons.
  titleContinue: "Confirm continue",
  titleAbort: "Confirm abort",
  titleConfirm: "Confirm {{label}}",
  closeDialogAria: "Close confirmation dialog",
  interruptedOperation: "Interrupted operation",
  actionHintCherryPick:
    "Replays this commit on the current HEAD; for merge commits, pick the baseline parent below.",
  actionHintRevert:
    "Creates a reverse commit with a Git-generated message; for merge commits, pick the baseline parent below.",
  actionHintSwitchBranch:
    "Switches only to an existing local branch (git switch --no-guess); it never creates a branch or guesses a remote one, and never stashes, resets, or cleans when changes exist.",
  actionHintContinue:
    "Completes the interrupted operation. Resolve all conflicts in the terminal and run git add first; if the result is an empty commit, Git fails and keeps the interruption marker; run --skip in the terminal to skip this operation (this app never skips automatically).",
  actionHintAbort:
    "Restores the state from before the operation started; manually resolved conflict changes will be lost.",
  actionHintMerge:
    "Merges the selected branch into the current branch (--no-edit); this may create a merge commit.",
  actionHintRebase:
    "Rebases the current branch onto the selected branch; this rewrites history and can be restored with git rebase --abort.",
  stashBeforeSwitch: "Stash current changes first",
  confirmContinue: "Continue and complete",
  confirmAbort: "Abort and discard resolutions",
  confirmExecute: "Run {{label}}",
  // Pre-write check (shared by the confirm dialog and the branch description dialog).
  gateTitle: "Pre-write check",
  gateChecking: "Checking the working tree and repository state…",
  gateRechecking: "Re-checking with the current selection…",
  gateFailedPrefix: "Pre-write check failed:",
  affectedFiles: "Affected files ({{n}}):",
  affectedFilesTruncated: "Affected files ({{n}}), first {{m}} shown:",
  // Merge-commit baseline parent picker.
  mainlineLegend: "Baseline parent (-m N)",
  mainlineParent: "Parent {{n}}",
  parentNoSummary: "(no commit summary)",
  parentsSummary: "{{n}} parent commits; re-checking runs automatically after changing the selection.",
  mergeNoParents:
    "This commit is a merge commit, but no parent list was returned; run it with -m in the terminal.",
  // Shared buttons.
  cancel: "Cancel",
  executing: "Executing…",
  // Branch description dialog.
  descriptionTitle: "Edit branch description",
  descriptionCloseAria: "Close branch description editor",
  descriptionHintPrefix: "Writes ",
  descriptionHintSuffix: "; saving an empty value deletes the key.",
  descriptionLoading: "Reading the existing description…",
  descriptionPlaceholder: "Describe this branch (may be left empty)",
  descriptionSharedHint:
    "This repository is a linked worktree: the description is written to the shared repository-level local config, which other worktrees of the same repository also see.",
  // Tag description dialog: the description is the annotated tag message.
  descriptionTagTitle: "Edit tag description",
  descriptionTagCloseAria: "Close tag description editor",
  descriptionTagHintPrefix: "Writes ",
  descriptionTagHintSuffix: "; saving an empty value turns the tag into a lightweight tag.",
  descriptionTagRewriteHint:
    "Rewriting creates a new tag object; a tag already pushed to the remote is not updated automatically. Run git push --force origin <tag> in the terminal when needed.",
  descriptionTagPlaceholder: "Describe this tag (may be left empty)",
  saving: "Saving…",
  save: "Save",
} satisfies WriteMessages;

export default write;