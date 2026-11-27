import type { CommandMessages } from "../zh-CN/commands";

const commands = {
  title: "Command palette",
  placeholder: "Search actions…",
  empty: "No matching actions",
  hint: "↑↓ select · Enter run · Esc close",
  listLabel: "Available actions",
  contextGlobal: "Global",
  contextGraph: "Graph",
  contextCompare: "Compare",
  contextStaging: "Staging",
  contextRefs: "References",
  disabledNoRepo: "Open a repository first",
  disabledBusy: "An operation is running; unavailable for now",
  disabledBare: "Bare repositories have no working tree",
  disabledSelection: "Select a commit or file first",
  disabledCompare: "Select Base and Compare first",
  disabledCompareRefs: "At least two comparable refs are required",
  disabledWrite: "Resolve the current interruption or write operation first",
  disabledNoConflicts: "There are no conflicts",
  disabledNoHead: "The repository has no commits yet",
  disabledSelectRef: "Select a ref first",
  disabledSelectRepository: "Select a repository tab first",
  disabledInvalidTarget: "The action target is invalid",
  disabledStagingSide: "The file is not on the side required by this action",
  disabledRefWithoutCommit: "This ref does not resolve to a commit",
  disabledLocalBranchOnly: "Only local branches can be switched",
  disabledAlreadyHead: "This is already the current branch",
  disabledRepositoryActive: "This is already the current repository",
} satisfies CommandMessages;

export default commands;
