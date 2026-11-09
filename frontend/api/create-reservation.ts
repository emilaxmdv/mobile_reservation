import type { VercelRequest, VercelResponse } from "@vercel/node";
import { FieldValue } from "firebase-admin/firestore";
import { isSlotBlocked } from "./_lib/blocks";
import {
  BLOCKS_COLLECTION,
  PUBLIC_STATS_DOC,
  RESERVATIONS_COLLECTION,
  SERVICES,
  TIME_SLOTS,
} from "./_lib/constants";
import { getDb } from "./_lib/firebase";
import { newReservationHtml } from "./_lib/messages";
import { notifyChatIdFromEnv, sendMessage, telegramConfigFromEnv } from "./_lib/telegram";
import { BlockDoc, CreateReservationInput } from "./_lib/types";
import {
  bakuDateString,
  bakuTimeString,
  isValidDateString,
  normalizePhone,
} from "./_lib/utils";

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
 * POST /api/create-reservation — yeganə yazı qapısı: frontend Firestore-a
 * BİRBAŞA yazmır. Sənəd yaranan kimi Ajoure işçisinə Telegram-da
 * Təsdiq/Ləğv düymələri ilə mesaj gedir. Müştəriyə avtomatik mesaj getmir —
 * işçi onunla özü əlaqə saxlayır.
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
      // İşçinin Telegram-dan bağladığı gün/saat
      const blockSnap = await tx.get(db.collection(BLOCKS_COLLECTION).doc(input.date));
      const block = blockSnap.data() as BlockDoc | undefined;
      if (isSlotBlocked(block, input.time)) {
        throw new ApiError(
          409,
          block?.allDay
            ? "Seçdiyiniz gün qeyri-iş günüdür. Zəhmət olmasa başqa tarix seçin."
            : "Seçdiyiniz saat doludur. Zəhmət olmasa başqa vaxt seçin."
        );
      }

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
          "Bu tarix və saat üçün artıq sorğunuz var. Sizinlə əlaqə saxlanılacaq."
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

    // ── İşçiyə Telegram bildirişi ────────────────────────────────────────────
    try {
      const cfg = telegramConfigFromEnv();
      const chatId = notifyChatIdFromEnv();
      const messageId = await sendMessage(cfg, chatId, newReservationHtml(input), [
        [
          // callback_data webhook-da geri açılır: "<əməliyyat>:<sənəd ID>"
          { text: "✅ Təsdiq et", callback_data: `confirm:${reservationId}` },
          { text: "❌ Ləğv et", callback_data: `decline:${reservationId}` },
        ],
      ]);
      await reservations.doc(reservationId).update({
        specialistNotifiedAt: FieldValue.serverTimestamp(),
        telegramChatId: chatId,
        telegramMessageId: messageId,
      });
    } catch (err) {
      // Bildiriş alınmasa belə rezervasiya Firestore-da qalır — xəta Vercel
      // loglarında görünür, sənəddə də qeyd olunur.
      console.error("İşçiyə Telegram bildirişi göndərilə bilmədi:", err);
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
