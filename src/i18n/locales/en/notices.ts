import type { NoticeMessages } from "../zh-CN/notices";

/** notices domain: structured operation feedback and recovery entries. */
const notices = {
  closeAria: "Dismiss notification",
  stderrDetails: "Show stderr details",
  locateHead: "Locate new HEAD",
  openReflog: "Open Reflog recovery",
  openConflicts: "View conflicted files",
  fetch: "Fetch",
  pull: "Pull",
  operationSucceededTitle: "{{label}} succeeded",
  operationFailedTitle: "{{label}} failed",
  operationConflictedTitle: "{{label}} conflicted",
  remoteDeletePartialTitle: "Remote deletion incomplete",
  remoteDeletePartialSummary: "The local {{kind}} was deleted; remote deletion failed.",
  remoteDeleteLocalResult: "Local result: {{message}}",
  remoteDeleteRemoteResult: "Remote result: {{message}}",
  actionBusy: "An operation is running; unavailable for now",
  actionUnavailable: "Unavailable for now",
  actionNoHead: "There is no HEAD to locate",
  actionNoConflicts: "There are no conflicted files",
} satisfies NoticeMessages;

export default notices;
