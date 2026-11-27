import type { MessageShape } from "../messages";

/** notices 域：应用级结构化操作通知与恢复入口。 */
const notices = {
  closeAria: "关闭通知",
  stderrDetails: "查看 stderr 详情",
  locateHead: "定位新 HEAD",
  openReflog: "打开 Reflog 恢复",
  openConflicts: "查看冲突文件",
  fetch: "Fetch",
  pull: "Pull",
  operationSucceededTitle: "{{label}} 成功",
  operationFailedTitle: "{{label}} 失败",
  operationConflictedTitle: "{{label}} 产生冲突",
  remoteDeletePartialTitle: "远程删除未完成",
  remoteDeletePartialSummary: "本地{{kind}}已删除；远程删除失败。",
  remoteDeleteLocalResult: "本地结果：{{message}}",
  remoteDeleteRemoteResult: "远程结果：{{message}}",
  actionBusy: "操作进行中，暂不可用",
  actionUnavailable: "当前不可用",
  actionNoHead: "当前没有可定位的 HEAD",
  actionNoConflicts: "当前没有冲突文件",
} as const;

export default notices;
export type NoticeMessages = MessageShape<typeof notices>;
