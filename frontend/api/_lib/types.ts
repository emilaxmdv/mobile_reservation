import { Timestamp } from "firebase-admin/firestore";

/** cancelled = əvvəl təsdiqlənmiş, sonra işçi tərəfindən ləğv edilmiş. */
export type ReservationStatus = "pending" | "confirmed" | "declined" | "cancelled";

/** Client-dən API-yə gələn xam giriş (etibarsız sayılır, tam yoxlanılır). */
export interface CreateReservationInput {
  firstName?: unknown;
  lastName?: unknown;
  phone?: unknown;
  service?: unknown;
  date?: unknown; // "YYYY-MM-DD"
  time?: unknown; // "HH:mm"
  birthDate?: unknown; // opsional, "YYYY-MM-DD"
}

/** Firestore-da saxlanan rezervasiya sənədi. Sənəd ID-si avtomatik generasiya olunur. */
export interface ReservationDoc {
  firstName: string;
  lastName: string;
  /** Normallaşdırılmış format: "994501234567" ("+" işarəsiz E.164). */
  phone: string;
  service: string;
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:mm"
  birthDate: string | null; // "YYYY-MM-DD"
  /** Doğum günü sorğusunu ucuzlaşdırmaq üçün əvvəlcədən hesablanmış "MM-DD". */
  birthMonthDay: string | null;
  status: ReservationStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  decidedAt: Timestamp | null;
  /** Qərarı verən işçi: "tg:<user id> <ad> (@username)". */
  decidedBy: string | null;
  cancelledAt?: Timestamp;
  cancelledBy?: string;
  /** İşçiyə gedən ilk bildiriş mesajı — ləğvdən sonra onu da yeniləmək üçün. */
  telegramChatId?: string;
  telegramMessageId?: number;
}

/** blocks/{YYYY-MM-DD}: işçinin Telegram-dan bağladığı gün və ya saatlar. */
export interface BlockDoc {
  date: string; // "YYYY-MM-DD" — sənəd ID-si ilə eyni, aralıq sorğuları üçün
  allDay: boolean;
  /** allDay=false olanda bağlı saatlar ("HH:mm"), sıralı. */
  times: string[];
  reason: string;
  updatedBy: string;
  updatedAt: Timestamp;
}
