import type { ErrorsMessages } from "../zh-CN/errors";

/** errors 域英文资源；用 satisfies 保证与 zh-CN 的 key 结构同构。 */
const errors = {
  sha256Repository: "This repository uses the SHA-256 object format; make sure all your Git tooling supports it",
  shallowRepository: "Shallow clone: only the fetched portion of history is shown",
  gitMissing: "System Git not detected; write operations are unavailable. Read-only features are unaffected",
  gitVersionTooOld: "System Git is older than {{minimum}}; write operations are disabled. Please upgrade Git",
  bareRepository: "Bare repository: worktree-related write operations are unavailable",
  noMergeBase: "The two refs share no common ancestor; comparison fell back to a two-endpoint snapshot diff",
  diffTruncated: "Too many changed files; the file list has been truncated",
  emptyRepository: "No commits to show in this view",
  changedFilesTruncated: "Too many changed files; showing the first {{n}} only",
  worktreeDirty:
    "{{total}} files have local changes ({{parts}}). Nothing is auto-stashed, reset or cleaned: changes stay in the worktree and may carry over to the target branch; if the target branch would overwrite them, Git will refuse the switch and leave things as they are.",
  stagingBareEmpty: "Bare repository has no worktree; the staging area is empty",
  conflictedIndex: "{{n}} unresolved conflict files; staging operations are disabled. Resolve them in the terminal first",
  interruptionDetected: "Unfinished Git operation detected: {{names}}",
  kindMerge: "unfinished merge",
  kindCherryPick: "unfinished cherry-pick",
  kindRevert: "unfinished revert",
  kindRebase: "unfinished rebase",
  kindSequencer: "unfinished sequencer",
  kindIndexLock: "index.lock held",
  kindSeparator: ", ",
  hintIndexLock: "After confirming no other Git process is running, delete index.lock manually in the terminal; this app never removes lock files",
  hintCherryPick: "Resolve conflicts in the terminal, then run git cherry-pick --continue (or --abort)",
  hintRevert: "Resolve conflicts in the terminal, then run git revert --continue (or --abort)",
  hintRebase: "Run git rebase --continue (or --abort) in the terminal",
  hintMerge: "Run git merge --continue (or git merge --abort) in the terminal",
  hintGeneral: "Finish or abandon the current operation in the terminal",
} satisfies ErrorsMessages;

export default errors;