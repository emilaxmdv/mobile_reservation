const TIMEZONE = "Asia/Baku";

/** Bakı vaxtı ilə bu gün, "YYYY-MM-DD". */
export function bakuToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Bakı vaxtı ilə indiki saat, "HH:mm". */
export function bakuNowTime(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
}

export function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Ayın 1-i həftənin neçənci günüdür (Bazar ertəsi = 0). */
export function mondayIndexOfFirst(y: number, m: number): number {
  return (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
}

/** "YYYY-MM-DD" → "DD.MM.YYYY" */
export function formatDateAz(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export const MONTHS_AZ = [
  "Yanvar",
  "Fevral",
  "Mart",
  "Aprel",
  "May",
  "İyun",
  "İyul",
  "Avqust",
  "Sentyabr",
  "Oktyabr",
  "Noyabr",
  "Dekabr",
] as const;

export const WEEKDAYS_SHORT_AZ = ["B.e", "Ç.a", "Ç", "C.a", "C", "Ş", "B"] as const;
