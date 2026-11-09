import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  BLOCKS_COLLECTION,
  MAX_RANGE_DAYS,
  RESERVATIONS_COLLECTION,
  TIME_SLOTS,
} from "./_lib/constants";
import { getDb } from "./_lib/firebase";
import type { BlockDoc, ReservationDoc } from "./_lib/types";
import { addDaysToDateString, isValidDateString } from "./_lib/utils";

/**
 * GET /api/availability?from=YYYY-MM-DD&to=YYYY-MM-DD — ictimai.
 * Saytdakı təqvim üçün: bütün gün bağlı günlər və hər gündə tutulmuş saatlar
 * (təsdiqlənmiş rezervasiyalar + Telegram-dan bağlanmış saatlar).
 * Müştəri məlumatı (ad, telefon) heç vaxt qaytarılmır — yalnız tarix və saat.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Yalnız GET qəbul olunur." });
    return;
  }

  const from = typeof req.query.from === "string" ? req.query.from : "";
  const to = typeof req.query.to === "string" ? req.query.to : "";
  if (!isValidDateString(from) || !isValidDateString(to) || to < from) {
    res.status(400).json({ error: "from/to düzgün deyil." });
    return;
  }
  if (to > addDaysToDateString(from, MAX_RANGE_DAYS)) {
    res.status(400).json({ error: `Aralıq ${MAX_RANGE_DAYS} gündən çox ola bilməz.` });
    return;
  }

  try {
    const db = getDb();
    // Yalnız "date" üzrə aralıq sorğusu — Firestore-un avtomatik indeksi kifayətdir,
    // status kodda süzülür (bir neçə həftəlik rezervasiya azdır).
    const [reservationsSnap, blocksSnap] = await Promise.all([
      db
        .collection(RESERVATIONS_COLLECTION)
        .where("date", ">=", from)
        .where("date", "<=", to)
        .select("date", "time", "status")
        .get(),
      db.collection(BLOCKS_COLLECTION).where("date", ">=", from).where("date", "<=", to).get(),
    ]);

    const closedDays: string[] = [];
    const taken = new Map<string, Set<string>>();
    const add = (date: string, time: string) => {
      if (!taken.has(date)) taken.set(date, new Set());
      taken.get(date)!.add(time);
    };

    for (const d of blocksSnap.docs) {
      const b = d.data() as BlockDoc;
      if (b.allDay) closedDays.push(b.date);
      else b.times.forEach((t) => add(b.date, t));
    }
    for (const d of reservationsSnap.docs) {
      const r = d.data() as Pick<ReservationDoc, "date" | "time" | "status">;
      if (r.status === "confirmed") add(r.date, r.time);
    }

    const takenSlots: Record<string, string[]> = {};
    for (const [date, times] of taken) {
      if (closedDays.includes(date)) continue;
      takenSlots[date] = TIME_SLOTS.filter((t) => times.has(t));
    }

    // Qısa CDN keşi: Telegram-da təsdiq/bağlamadan sonra ən çox ~30 san gecikmə
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    res.status(200).json({ closedDays: closedDays.sort(), takenSlots });
  } catch (err) {
    console.error("availability xətası:", err);
    res.status(500).json({ error: "Daxili xəta" });
  }
}
