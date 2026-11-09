/** /api/create-reservation-a göndərilən rezervasiya sorğusu. */
export interface ReservationInput {
  firstName: string;
  lastName: string;
  phone: string;
  service: string;
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:mm"
  birthDate?: string; // opsional, "YYYY-MM-DD"
}

export interface ReservationResult {
  reservationId: string;
}

/** /api/availability cavabı. */
export interface Availability {
  /** Bütün günü bağlı (qeyri-iş) günlər. */
  closedDays: string[];
  /** Gün → tutulmuş saatlar (təsdiqlənmiş rezervasiya və ya bağlanmış saat). */
  takenSlots: Record<string, string[]>;
}
