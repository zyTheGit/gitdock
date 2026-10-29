// 展示层共用的时间与 OID 格式化；语义统一后各 feature 不再各写一份。

const dateTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** 秒级时间戳 → 本地日期时间；0 视为未知。 */
export function formatDate(seconds: number): string {
  return seconds ? dateTimeFormat.format(new Date(seconds * 1000)) : "—";
}

export function shortOid(oid: string): string {
  return oid.slice(0, 8);
}
