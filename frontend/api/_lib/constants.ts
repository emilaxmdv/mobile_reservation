// ─────────────────────────────────────────────────────────────────────────────
// Server-side validasiya üçün sabitlər.
// DİQQƏT: Bu siyahılar frontend/src/constants.ts ilə SİNXRON saxlanmalıdır —
// server həmişə son sözü deyir, frontend yalnız istifadəçi rahatlığı üçündür.
// ─────────────────────────────────────────────────────────────────────────────

export const TIMEZONE = "Asia/Baku";

/** Mağazanın təklif etdiyi xidmətlər — öz xidmətlərinizi buraya yazın. */
export const SERVICES = [
  "Fərdi portret sifarişi",
  "Ailəvi portret sifarişi",
  "Konsultasiya",
  "Hazır işin təhvili",
] as const;

/** Rezervasiya üçün mümkün saat slotları. */
export const TIME_SLOTS = [
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
] as const;

/** Firestore kolleksiya/sənəd adları. */
export const RESERVATIONS_COLLECTION = "reservations";
export const PUBLIC_STATS_DOC = "publicStats/summary";
/** Bağlı gün/saatlar: sənəd ID-si "YYYY-MM-DD". */
export const BLOCKS_COLLECTION = "blocks";

/** /api/availability və /bagla aralıq əmrləri üçün maksimum gün sayı. */
export const MAX_RANGE_DAYS = 62;
