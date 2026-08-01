import { TIMEZONE } from "./constants";

/** Verilən anın Bakı vaxtı ilə tarixini "YYYY-MM-DD" formatında qaytarır. */
export function bakuDateString(d: Date = new Date()): string {
  // en-CA locale ISO-yaxın "YYYY-MM-DD" formatı verir
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Verilən anın Bakı vaxtı ilə saatını "HH:mm" formatında qaytarır. */
export function bakuTimeString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

/** "YYYY-MM-DD" sətrinin həqiqi təqvim tarixi olduğunu yoxlayır. */
export function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, day] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === day
  );
}

/** "YYYY-MM-DD" → "DD.MM.YYYY" (istifadəçiyə göstərmək üçün). */
export function formatDateAz(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}.${m}.${y}`;
}

/**
 * Telefonu normallaşdırır → "994501234567" (E.164, "+" işarəsiz — WhatsApp API
 * məhz bu formatı qəbul edir). Qəbul olunan girişlər:
 *   "+994 50 123 45 67", "0501234567", "994501234567"
 * Etibarsızdırsa null qaytarır.
 */
export function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[^\d+]/g, "");
  let digits = cleaned.startsWith("+") ? cleaned.slice(1) : cleaned;
  if (digits.startsWith("0") && digits.length === 10) {
    digits = "994" + digits.slice(1);
  }
  return /^994\d{9}$/.test(digits) ? digits : null;
}

/** "YYYY-MM-DD" tarixinə n gün əlavə edib "YYYY-MM-DD" qaytarır (UTC hesabı). */
export function addDaysToDateString(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
