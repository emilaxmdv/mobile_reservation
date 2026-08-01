import { Timestamp } from "firebase-admin/firestore";

export type ReservationStatus = "pending" | "confirmed" | "declined";

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
  /** Qərarı verən mütəxəssisin WhatsApp nömrəsi (webhook-dan gəlir). */
  decidedBy: string | null;
}
