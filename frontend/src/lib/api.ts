import type { ReservationInput, ReservationResult } from "../types";

// Frontend Firestore-a birbaşa toxunmur və heç bir Firebase SDK daşımır —
// bütün əməliyyatlar eyni domendəki Vercel API route-ları üzərindən gedir.

/**
 * Rezervasiya sorğusunu göndərir. Server (api/create-reservation.ts) bütün
 * validasiyanı aparır və Azərbaycan dilində aydın xəta mesajları qaytarır —
 * uğursuzluqda həmin mesajla Error atılır.
 */
export async function createReservation(
  input: ReservationInput
): Promise<ReservationResult> {
  const res = await fetch("/api/create-reservation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const body = (await res.json().catch(() => null)) as
    | (ReservationResult & { error?: string })
    | null;

  if (!res.ok) {
    throw new Error(
      body?.error ?? "Xəta baş verdi. Zəhmət olmasa bir azdan yenidən cəhd edin."
    );
  }
  return body as ReservationResult;
}

/**
 * İctimai sayğac — footer-dəki "İndiyədək N nəfər rezervasiya edib" üçün.
 * Alına bilməsə null qaytarır (footer sadəcə gizlənir).
 */
export async function fetchTotalReservations(): Promise<number | null> {
  try {
    const res = await fetch("/api/stats");
    if (!res.ok) return null;
    const body = (await res.json()) as { totalReservations?: unknown };
    return typeof body.totalReservations === "number"
      ? body.totalReservations
      : null;
  } catch {
    return null;
  }
}
