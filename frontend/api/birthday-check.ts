import type { VercelRequest, VercelResponse } from "@vercel/node";
import { RESERVATIONS_COLLECTION } from "./_lib/constants";
import { optionalEnv, requireEnv } from "./_lib/env";
import { getDb } from "./_lib/firebase";
import { ReservationDoc } from "./_lib/types";
import { addDaysToDateString, bakuDateString, formatDateAz } from "./_lib/utils";
import { sendTextMessage, whatsappConfigFromEnv } from "./_lib/whatsapp";

/**
 * /api/birthday-check — köhnə scheduled Cloud Function-un yerini tutur.
 * Vercel Cron tərəfindən gündə bir dəfə çağırılır (bax: vercel.json —
 * "0 5 * * *" UTC = 09:00 Bakı vaxtı): düz 7 gün sonra doğum günü olan
 * müştəriləri tapır və mağaza sahibinin/mütəxəssisin nömrəsinə daxili
 * xatırlatma göndərir.
 *
 * Sorğu ucuzdur: rezervasiya yaradılarkən hesablanmış "birthMonthDay" ("MM-DD")
 * sahəsi üzrə bərabərlik sorğusu — bütün kolleksiyanı skan etmirik.
 *
 * QEYD: Gələcəkdə birbaşa MÜŞTƏRİYƏ avtomatik təbrik mesajı göndərilmək
 * istənsə, bu, 24 saatlıq service-window-dan kənar biznes-təşəbbüslü mesaj
 * olduğu üçün Meta-da əvvəlcədən təsdiqlənmiş "utility" kateqoriyalı template
 * tələb olunur və conversation-based qiymətləndirməyə görə hər mesaj başına
 * kiçik xərc yaranacaq. Hazır kod üçün _lib/whatsapp.ts-dəki
 * sendTemplateMessage funksiyasından istifadə edin.
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

    const cfg = whatsappConfigFromEnv();
    // Xatırlatma sahibin nömrəsinə gedir; təyin olunmayıbsa mütəxəssisə.
    const recipientNumber =
      optionalEnv("OWNER_WHATSAPP_NUMBER") ?? requireEnv("SPECIALIST_WHATSAPP_NUMBER");

    let sent = 0;
    for (const r of uniqueByPhone.values()) {
      const message =
        `Xatırlatma: ${r.firstName} ${r.lastName}-ın doğum günü ` +
        `${formatDateAz(targetDate)}-dir (7 gün qalıb).`;
      try {
        await sendTextMessage(cfg, recipientNumber, message);
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
