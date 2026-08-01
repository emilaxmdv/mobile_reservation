/** Callable funksiyaya göndərilən rezervasiya sorğusu. */
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
