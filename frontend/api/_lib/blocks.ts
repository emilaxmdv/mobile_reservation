// Gün/saat bloklama: Telegram əmrlərinin arqumentlərini oxumaq və blok
// vəziyyətini dəyişmək üçün təmiz (Firestore-suz) funksiyalar.

import { MAX_RANGE_DAYS, TIME_SLOTS } from "./constants";
import { addDaysToDateString, enumerateDates, isValidDateString } from "./utils";

export interface BlockState {
  allDay: boolean;
  times: string[];
}

export function isSlotBlocked(block: BlockState | null | undefined, time: string): boolean {
  if (!block) return false;
  return block.allDay || block.times.includes(time);
}

/**
 * Tarix sözünü "YYYY-MM-DD"-yə çevirir. Qəbul olunur:
 *   2026-11-15 · 15.11.2026 · 15.11 (ən yaxın gələcək) · bugün/bugun · sabah
 */
export function parseDateToken(token: string, today: string): string | null {
  const t = token.toLowerCase();
  if (t === "bugün" || t === "bugun" || t === "bu_gün") return today;
  if (t === "sabah") return addDaysToDateString(today, 1);

  let iso: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    iso = t;
  } else {
    const full = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(t);
    const short = /^(\d{1,2})[./](\d{1,2})$/.exec(t);
    if (full) {
      iso = `${full[3]}-${full[2].padStart(2, "0")}-${full[1].padStart(2, "0")}`;
    } else if (short) {
      const year = Number(today.slice(0, 4));
      const md = `${short[2].padStart(2, "0")}-${short[1].padStart(2, "0")}`;
      iso = `${year}-${md}`;
      if (isValidDateString(iso) && iso < today) iso = `${year + 1}-${md}`;
    }
  }
  return iso && isValidDateString(iso) ? iso : null;
}

/** "14", "14:00", "14.00", "9:00" → TIME_SLOTS-dakı uyğun slot, yoxdursa null. */
export function parseTimeToken(token: string): string | null {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(token);
  if (!m) return null;
  const slot = `${m[1].padStart(2, "0")}:${m[2] ?? "00"}`;
  return (TIME_SLOTS as readonly string[]).includes(slot) ? slot : null;
}

/** "14:00-16:00" → ["14:00","15:00","16:00"] (hər iki uc daxil). */
export function parseTimeRangeToken(token: string): string[] | null {
  const parts = token.split(/[-–]/);
  if (parts.length !== 2) return null;
  const from = parseTimeToken(parts[0]);
  const to = parseTimeToken(parts[1]);
  if (!from || !to || to < from) return null;
  return TIME_SLOTS.filter((s) => s >= from && s <= to);
}

export type ParsedBlockArgs =
  | { ok: true; dates: string[]; times: string[] | null; reason: string }
  | { ok: false; error: string };

/**
 * /bagla və /ac əmrlərinin arqumentləri:
 *   <tarix> [<son tarix>] [<saat> | <saat-saat> ...] [səbəb...]
 * times=null → bütün gün.
 */
export function parseBlockArgs(args: string[], today: string): ParsedBlockArgs {
  if (args.length === 0) {
    return { ok: false, error: "Tarix yazın. Nümunə: /bagla 15.11 və ya /bagla 15.11 14:00" };
  }

  let i = 0;
  const first = parseDateToken(args[i], today);
  if (!first) {
    return { ok: false, error: `"${args[i]}" tarix kimi tanınmadı. Nümunə: 15.11 və ya 2026-11-15` };
  }
  i++;

  let last = first;
  if (i < args.length) {
    const second = parseDateToken(args[i], today);
    if (second) {
      last = second;
      i++;
    }
  }
  if (last < first) {
    return { ok: false, error: "Son tarix başlanğıc tarixdən əvvəl ola bilməz." };
  }
  if (first < today) {
    return { ok: false, error: "Keçmiş tarixi dəyişmək olmaz." };
  }
  const dates = enumerateDates(first, last);
  if (dates.length > MAX_RANGE_DAYS) {
    return { ok: false, error: `Bir dəfəyə ən çox ${MAX_RANGE_DAYS} gün seçmək olar.` };
  }

  const times = new Set<string>();
  for (; i < args.length; i++) {
    const tok = args[i];
    const single = parseTimeToken(tok);
    if (single) {
      times.add(single);
      continue;
    }
    const range = parseTimeRangeToken(tok);
    if (range) {
      range.forEach((t) => times.add(t));
      continue;
    }
    // Saata oxşayır, amma slot deyil — səbəb kimi qəbul etmək əvəzinə xəbər ver
    if (/^\d{1,2}([:.]\d{2})?([-–]\d{1,2}([:.]\d{2})?)?$/.test(tok)) {
      return {
        ok: false,
        error: `"${tok}" mövcud saat deyil. Saatlar: ${TIME_SLOTS.join(", ")}`,
      };
    }
    break;
  }

  const reason = args.slice(i).join(" ").slice(0, 200);
  const sortedTimes = times.size ? TIME_SLOTS.filter((t) => times.has(t)) : null;
  return { ok: true, dates, times: sortedTimes, reason };
}

/** Bağlama: times=null → bütün gün. */
export function applyBlock(existing: BlockState | null, times: string[] | null): BlockState {
  if (times === null) return { allDay: true, times: [] };
  if (existing?.allDay) return existing;
  const merged = new Set([...(existing?.times ?? []), ...times]);
  if (merged.size >= TIME_SLOTS.length) return { allDay: true, times: [] };
  return { allDay: false, times: TIME_SLOTS.filter((t) => merged.has(t)) };
}

/** Açma: times=null → günü tam aç. Nəticə null-dırsa sənəd silinməlidir. */
export function applyUnblock(existing: BlockState | null, times: string[] | null): BlockState | null {
  if (!existing || times === null) return null;
  const current = existing.allDay ? [...TIME_SLOTS] : existing.times;
  const remaining = current.filter((t) => !times.includes(t));
  if (remaining.length === 0) return null;
  return { allDay: false, times: remaining };
}

export function sameBlockState(a: BlockState | null, b: BlockState | null): boolean {
  if (!a || !b) return a === b;
  return a.allDay === b.allDay && a.times.join(",") === b.times.join(",");
}
