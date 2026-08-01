import type { VercelRequest, VercelResponse } from "@vercel/node";
import { PUBLIC_STATS_DOC } from "./_lib/constants";
import { getDb } from "./_lib/firebase";

/**
 * GET /api/stats — ictimai sayğac. Frontend footer-dəki "İndiyədək N nəfər
 * rezervasiya edib" yazısı üçün. Yalnız BİR rəqəm qaytarır — müştəri
 * məlumatları (ad, telefon, tarix) bu endpoint-dən heç vaxt çıxmır.
 *
 * Əvvəl frontend bu rəqəmi Firestore client SDK ilə birbaşa oxuyurdu; indi
 * client SDK tamam çıxarıldığı üçün oxu da server üzərindən gedir.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Yalnız GET qəbul olunur." });
    return;
  }

  try {
    const snap = await getDb().doc(PUBLIC_STATS_DOC).get();
    const total = snap.data()?.totalReservations;
    // CDN keşi: sayğac üçün 5 dəqiqəlik gecikmə problem deyil, Firestore
    // oxunuşlarına qənaət edir.
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({ totalReservations: typeof total === "number" ? total : 0 });
  } catch (err) {
    console.error("stats xətası:", err);
    res.status(500).json({ totalReservations: null });
  }
}
