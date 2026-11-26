import type { SearchDateRange } from "../../shared/types";

export interface SearchDateDraft {
  from: string;
  to: string;
}

export const EMPTY_DATE_DRAFT: SearchDateDraft = { from: "", to: "" };

function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function formatLocalDate(epochSeconds: number, inclusiveEnd: boolean): string {
  const date = new Date(epochSeconds * 1000 - (inclusiveEnd ? 1 : 0));
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateDraftFromRange(range: SearchDateRange | null | undefined): SearchDateDraft {
  return {
    from: range?.from == null ? "" : formatLocalDate(range.from, false),
    to: range?.to == null ? "" : formatLocalDate(range.to, true),
  };
}

export function searchDateRangeFromDraft(draft: SearchDateDraft): SearchDateRange | null {
  const fromDate = draft.from ? parseLocalDate(draft.from) : null;
  const toDate = draft.to ? parseLocalDate(draft.to) : null;
  if (!draft.from && !draft.to) {
    return null;
  }
  if ((draft.from && !fromDate) || (draft.to && !toDate)) {
    return null;
  }
  const toExclusive = toDate ? new Date(toDate) : null;
  toExclusive?.setDate(toExclusive.getDate() + 1);
  return {
    from: fromDate ? Math.floor(fromDate.getTime() / 1000) : null,
    to: toExclusive ? Math.floor(toExclusive.getTime() / 1000) : null,
  };
}

export function isDateDraftValid(draft: SearchDateDraft): boolean {
  const from = draft.from ? parseLocalDate(draft.from) : null;
  const to = draft.to ? parseLocalDate(draft.to) : null;
  if ((draft.from && !from) || (draft.to && !to)) {
    return false;
  }
  return !from || !to || from.getTime() <= to.getTime();
}

export function dateDraftsEqual(left: SearchDateDraft, right: SearchDateDraft): boolean {
  return left.from === right.from && left.to === right.to;
}
