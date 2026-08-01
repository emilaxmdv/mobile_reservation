import type { VercelRequest, VercelResponse } from "@vercel/node";
import { FieldValue } from "firebase-admin/firestore";
import {
  PUBLIC_STATS_DOC,
  RESERVATIONS_COLLECTION,
  SERVICES,
  TIME_SLOTS,
} from "./_lib/constants";
import { requireEnv } from "./_lib/env";
import { getDb } from "./_lib/firebase";
import { CreateReservationInput } from "./_lib/types";
import {
  bakuDateString,
  bakuTimeString,
  formatDateAz,
  isValidDateString,
  normalizePhone,
} from "./_lib/utils";
import { sendInteractiveButtons, whatsappConfigFromEnv } from "./_lib/whatsapp";

/** İstifadəçiyə göstərilən status kodu + Azərbaycan dilində mesaj daşıyan xəta. */
class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Sətri təhlükəsiz şəkildə oxu: yalnız string qəbul et, kəs və uzunluğu məhdudlaşdır. */
function cleanString(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLen);
}

interface ValidatedReservation {
  firstName: string;
  lastName: string;
  phone: string;
  service: string;
  date: string;
  time: string;
  birthDate: string | null;
  birthMonthDay: string | null;
}

/** Bütün server-side validasiya — client-ə etibar edilmir. */
function validateInput(data: CreateReservationInput): ValidatedReservation {
  // ── 1. Ad / soyad ──────────────────────────────────────────────────────────
  const firstName = cleanString(data.firstName, 50);
  const lastName = cleanString(data.lastName, 50);
  if (!firstName || !lastName) {
    throw new ApiError(400, "Ad və soyad boş ola bilməz.");
  }

  // ── 2. Telefon ─────────────────────────────────────────────────────────────
  const phone = normalizePhone(cleanString(data.phone, 30));
  if (!phone) {
    throw new ApiError(400, "Telefon nömrəsi düzgün deyil. Nümunə: +994 50 123 45 67");
  }

  // ── 3. Xidmət ──────────────────────────────────────────────────────────────
  const service = cleanString(data.service, 100);
  if (!(SERVICES as readonly string[]).includes(service)) {
    throw new ApiError(400, "Xidmət düzgün seçilməyib.");
  }

  // ── 4. Tarix + saat ────────────────────────────────────────────────────────
  const date = cleanString(data.date, 10);
  const time = cleanString(data.time, 5);
  if (!isValidDateString(date)) {
    throw new ApiError(400, "Tarix düzgün formatda deyil.");
  }
  if (!(TIME_SLOTS as readonly string[]).includes(time)) {
    throw new ApiError(400, "Saat düzgün seçilməyib.");
  }

  const today = bakuDateString();
  if (date < today) {
    throw new ApiError(400, "Keçmiş tarixə rezervasiya etmək olmaz.");
  }
  if (date === today && time <= bakuTimeString()) {
    throw new ApiError(400, "Bu saat artıq keçib. Zəhmət olmasa sonrakı saat seçin.");
  }

  // ── 5. Doğum tarixi (opsional) ─────────────────────────────────────────────
  let birthDate: string | null = null;
  let birthMonthDay: string | null = null;
  const rawBirth = cleanString(data.birthDate, 10);
  if (rawBirth) {
    if (!isValidDateString(rawBirth) || rawBirth >= today || rawBirth < "1900-01-01") {
      throw new ApiError(400, "Doğum tarixi düzgün deyil.");
    }
    birthDate = rawBirth;
    birthMonthDay = rawBirth.slice(5); // "MM-DD" — gündəlik yoxlamanı ucuzlaşdırır
  }

  return { firstName, lastName, phone, service, date, time, birthDate, birthMonthDay };
}

/**
 * POST /api/create-reservation — köhnə HTTPS Callable funksiyanın yerini tutur.
 * Yeganə yazı qapısı: frontend Firestore-a BİRBAŞA yazmır. Sənəd yaranan kimi
 * (trigger gözləmədən) mütəxəssisə WhatsApp Təsdiq/Ləğv düymələri elə burada
 * göndərilir — köhnə onCreate trigger-in işini indi bu route özü görür.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Yalnız POST qəbul olunur." });
    return;
  }

  try {
    // Vercel JSON body-ni avtomatik parse edir; string gələrsə özümüz açırıq
    let data: CreateReservationInput;
    try {
      data =
        typeof req.body === "string"
          ? (JSON.parse(req.body || "{}") as CreateReservationInput)
          : ((req.body ?? {}) as CreateReservationInput);
    } catch {
      throw new ApiError(400, "Sorğu formatı düzgün deyil.");
    }

    const input = validateInput(data);

    const db = getDb();
    const reservations = db.collection(RESERVATIONS_COLLECTION);

    // ── Slot münaqişəsi yoxlaması + yazı (tranzaksiya daxilində) ─────────────
    const reservationId = await db.runTransaction(async (tx) => {
      // Eyni tarix+saat slotunda artıq TƏSDİQLƏNMİŞ rezervasiya varsa — rədd et.
      const confirmedSnap = await tx.get(
        reservations
          .where("date", "==", input.date)
          .where("time", "==", input.time)
          .where("status", "==", "confirmed")
          .limit(1)
      );
      if (!confirmedSnap.empty) {
        throw new ApiError(
          409,
          "Seçdiyiniz tarix və saat artıq doludur. Zəhmət olmasa başqa vaxt seçin."
        );
      }

      // Eyni nömrədən eyni slot üçün təkrar "pending" sorğunun qarşısını al.
      const duplicateSnap = await tx.get(
        reservations
          .where("phone", "==", input.phone)
          .where("date", "==", input.date)
          .where("time", "==", input.time)
          .where("status", "==", "pending")
          .limit(1)
      );
      if (!duplicateSnap.empty) {
        throw new ApiError(
          409,
          "Bu tarix və saat üçün artıq sorğunuz var. WhatsApp təsdiqini gözləyin."
        );
      }

      // Avtomatik generasiya olunan sənəd ID-si — ad/tarix/saatdan düzəldilmiş
      // proqnozlaşdırıla bilən ID QƏTİYYƏN istifadə edilmir.
      const ref = reservations.doc();
      tx.create(ref, {
        ...input,
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        decidedAt: null,
        decidedBy: null,
      });

      // İctimai sayğac: TƏKCƏ rəqəm saxlayan ayrıca sənəd. Müştəri məlumatları
      // (ad, telefon və s.) heç vaxt public-oxunan sənədə yazılmır.
      tx.set(
        db.doc(PUBLIC_STATS_DOC),
        { totalReservations: FieldValue.increment(1) },
        { merge: true }
      );

      return ref.id;
    });

    // ── Mütəxəssisə dərhal WhatsApp bildirişi (trigger yoxdur, birbaşa) ──────
    const bodyText =
      `Yeni rezervasiya\n` +
      `Tarix: ${formatDateAz(input.date)} ${input.time}\n` +
      `Müştəri: ${input.firstName} ${input.lastName}\n` +
      `Xidmət: ${input.service}\n` +
      `Telefon: +${input.phone}\n\n` +
      `Zəhmət olmasa yoxlayın.`;

    try {
      const messageId = await sendInteractiveButtons(
        whatsappConfigFromEnv(),
        requireEnv("SPECIALIST_WHATSAPP_NUMBER"),
        bodyText,
        [
          // Düymə ID-ləri webhook-da geri açılır: "<əməliyyat>:<sənəd ID>"
          { id: `confirm:${reservationId}`, title: "Təsdiq et" },
          { id: `decline:${reservationId}`, title: "Ləğv et" },
        ]
      );
      await reservations
        .doc(reservationId)
        .update({ specialistNotifiedAt: new Date(), specialistMessageId: messageId });
    } catch (err) {
      // Bildiriş alınmasa belə rezervasiya Firestore-da qalır — xəta Vercel
      // loglarında görünür, sənəddə də qeyd olunur.
      console.error("Mütəxəssisə WhatsApp bildirişi göndərilə bilmədi:", err);
      await reservations
        .doc(reservationId)
        .update({ specialistNotifyError: String(err) })
        .catch(() => undefined);
    }

    res.status(200).json({ reservationId });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error("create-reservation xətası:", err);
    res.status(500).json({ error: "Xəta baş verdi. Zəhmət olmasa bir azdan yenidən cəhd edin." });
  }
}
