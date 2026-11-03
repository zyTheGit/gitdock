// 展示层共用的时间与 OID 格式化；语义统一后各 feature 不再各写一份。
import { currentLocale } from "../i18n";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(): Intl.DateTimeFormat {
  const locale = currentLocale();
  let cached = formatters.get(locale);
  if (!cached) {
    cached = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatters.set(locale, cached);
  }
  return cached;
}

/** 秒级时间戳 → 当前语言的本地日期时间；0 视为未知。 */
export function formatDate(seconds: number): string {
  return seconds ? formatter().format(new Date(seconds * 1000)) : "—";
}

export function shortOid(oid: string): string {
  return oid.slice(0, 8);
}
