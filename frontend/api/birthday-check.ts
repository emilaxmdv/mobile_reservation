import type { VercelRequest, VercelResponse } from "@vercel/node";
import { RESERVATIONS_COLLECTION } from "./_lib/constants";
import { optionalEnv } from "./_lib/env";
import { getDb } from "./_lib/firebase";
import {
  escapeHtml,
  notifyChatIdFromEnv,
  sendMessage,
  telegramConfigFromEnv,
} from "./_lib/telegram";
import { ReservationDoc } from "./_lib/types";
import {
  addDaysToDateString,
  bakuDateString,
  formatDateAz,
  formatPhoneDisplay,
} from "./_lib/utils";

/**
 * /api/birthday-check — Vercel Cron tərəfindən gündə bir dəfə çağırılır
 * (bax: vercel.json — "0 5 * * *" UTC = 09:00 Bakı vaxtı): düz 7 gün sonra
 * doğum günü olan müştəriləri tapır və Telegram-a daxili xatırlatma göndərir
 * (TELEGRAM_OWNER_CHAT_ID varsa ora, yoxdursa TELEGRAM_CHAT_ID-yə).
 *
 * Sorğu ucuzdur: rezervasiya yaradılarkən hesablanmış "birthMonthDay" ("MM-DD")
 * sahəsi üzrə bərabərlik sorğusu — bütün kolleksiyanı skan etmirik.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // CRON_SECRET təyin olunubsa, yalnız Vercel Cron-un öz çağırışları qəbul
  // edilir (Vercel avtomatik "Authorization: Bearer <CRON_SECRET>" göndərir).
  // Bunsuz endpoint-i bilən hər kəs xatırlatmaları təkrar işə sala bilər.
  const cronSecret = optionalEnv("CRON_SECRET");
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    // Bakı vaxtı ilə bu gündən düz 7 gün sonranın "MM-DD" açarı
    const targetDate = addDaysToDateString(bakuDateString(), 7);
    const targetMonthDay = targetDate.slice(5);
    // Qeyd: 29 fevral doğumlular yalnız uyğun ildə (hədəf tarix 29 fevral
    // olanda) tapılır — sadə və proqnozlaşdırıla bilən davranış.

    const db = getDb();
    const snap = await db
      .collection(RESERVATIONS_COLLECTION)
      .where("birthMonthDay", "==", targetMonthDay)
      .get();

    if (snap.empty) {
      res.status(200).json({ targetMonthDay, reminders: 0 });
      return;
    }

    // Eyni müştəri bir neçə dəfə rezervasiya edibsə, telefon üzrə təkrarları çıxar.
    const uniqueByPhone = new Map<string, ReservationDoc>();
    for (const doc of snap.docs) {
      const r = doc.data() as ReservationDoc;
      if (!uniqueByPhone.has(r.phone)) uniqueByPhone.set(r.phone, r);
    }

    const cfg = telegramConfigFromEnv();
    const recipientChat = optionalEnv("TELEGRAM_OWNER_CHAT_ID") ?? notifyChatIdFromEnv();

    let sent = 0;
    for (const r of uniqueByPhone.values()) {
      const message =
        `🎂 <b>Xatırlatma:</b> ${escapeHtml(`${r.firstName} ${r.lastName}`)}-ın doğum günü ` +
        `${formatDateAz(targetDate)}-dir (7 gün qalıb).\n📞 ${formatPhoneDisplay(r.phone)}`;
      try {
        await sendMessage(cfg, recipientChat, message);
        sent++;
      } catch (err) {
        console.error("Doğum günü xatırlatması göndərilə bilmədi:", r.phone, err);
      }
    }

    res.status(200).json({ targetMonthDay, matches: uniqueByPhone.size, sent });
  } catch (err) {
    console.error("birthday-check xətası:", err);
    res.status(500).json({ error: "Daxili xəta" });
  }
}
