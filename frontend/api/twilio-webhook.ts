import type { VercelRequest, VercelResponse } from "@vercel/node";
import * as crypto from "crypto";
import { RESERVATIONS_COLLECTION } from "./_lib/constants";
import { optionalEnv, requireEnv } from "./_lib/env";
import { getDb } from "./_lib/firebase";
import { messagingConfigFromEnv, notifyCustomerMessage, sendText } from "./_lib/messaging";
import { ReservationDoc } from "./_lib/types";
import { formatDateAz } from "./_lib/utils";

/**
 * /api/twilio-webhook — Twilio WhatsApp webhook.
 *
 * Twilio POST göndərir (application/x-www-form-urlencoded):
 *   From=whatsapp:+994501234567
 *   To=whatsapp:+14155238886
 *   Body=T ab3f12
 *
 * Mütəxəssis cavab formatı:
 *   T <shortId> — Təsdiq et
 *   L <shortId> — Ləğv et
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  // Twilio imza yoxlaması (opsional, amma tövsiyə olunur)
  const authToken = optionalEnv("TWILIO_AUTH_TOKEN");
  if (authToken) {
    const signature = req.headers["x-twilio-signature"] as string | undefined;
    if (!signature || !validateTwilioSignature(req, authToken, signature)) {
      console.warn("Twilio webhook: imza yoxlaması alınmadı");
      res.status(401).send("Invalid signature");
      return;
    }
  }

  const body = req.body as Record<string, string>;
  const from = (body.From ?? "").replace("whatsapp:+", "");
  const messageBody = (body.Body ?? "").trim();

  if (!from || !messageBody) {
    res.status(200).send("<Response></Response>");
    return;
  }

  const specialistNumber = requireEnv("SPECIALIST_WHATSAPP_NUMBER");
  if (from !== specialistNumber) {
    res.status(200).send("<Response></Response>");
    return;
  }

  const parsed = parseReply(messageBody);
  if (!parsed) {
    res.status(200).send("<Response></Response>");
    return;
  }

  try {
    await processReply(parsed.action, parsed.shortId, from);
  } catch (err) {
    console.error("Twilio webhook emal xətası:", err);
  }

  // Twilio TwiML cavab gözləyir (boş Response = cavab yoxdur)
  res.status(200).send("<Response></Response>");
}

interface ParsedReply {
  action: "confirm" | "decline";
  shortId: string;
}

function parseReply(text: string): ParsedReply | null {
  const match = text.match(/^([TtLl])\s+([a-zA-Z0-9]{4,8})$/);
  if (!match) return null;
  const letter = match[1].toUpperCase();
  return {
    action: letter === "T" ? "confirm" : "decline",
    shortId: match[2].toLowerCase(),
  };
}

async function processReply(
  action: "confirm" | "decline",
  shortId: string,
  from: string
): Promise<void> {
  const db = getDb();
  const cfg = messagingConfigFromEnv();
  const newStatus = action === "confirm" ? "confirmed" : "declined";

  // Short ID ilə pending rezervasiya tap (doc ID-nin ilk 6 simvolu)
  const allPending = await db
    .collection(RESERVATIONS_COLLECTION)
    .where("status", "==", "pending")
    .get();

  const matchDoc = allPending.docs.find((d) =>
    d.id.toLowerCase().startsWith(shortId)
  );

  if (!matchDoc) {
    await sendText(cfg, from, `"${shortId}" ID-li gözləyən rezervasiya tapılmadı.`);
    return;
  }

  const reservationId = matchDoc.id;
  const r = matchDoc.data() as ReservationDoc;
  const dateAz = formatDateAz(r.date);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(matchDoc.ref);
    if (!snap.exists) return "not-found";

    const current = snap.data() as ReservationDoc;
    if (current.status !== "pending") return "already-processed";

    if (newStatus === "confirmed") {
      const conflictSnap = await tx.get(
        db
          .collection(RESERVATIONS_COLLECTION)
          .where("date", "==", current.date)
          .where("time", "==", current.time)
          .where("status", "==", "confirmed")
          .limit(1)
      );
      if (!conflictSnap.empty) return "slot-conflict";
    }

    tx.update(matchDoc.ref, {
      status: newStatus,
      updatedAt: new Date(),
      decidedAt: new Date(),
      decidedBy: from,
    });
    return "updated";
  });

  if (result === "not-found") {
    await sendText(cfg, from, "Bu rezervasiya tapılmadı.");
    return;
  }

  if (result === "already-processed") {
    const statusAz = r.status === "confirmed" ? "təsdiqlənib" : "ləğv edilib";
    await sendText(
      cfg,
      from,
      `Bu rezervasiya artıq ${statusAz} (${dateAz} ${r.time}, ${r.firstName} ${r.lastName}).`
    );
    return;
  }

  if (result === "slot-conflict") {
    await sendText(
      cfg,
      from,
      `Diqqət: ${dateAz} ${r.time} slotu üçün artıq başqa təsdiqlənmiş rezervasiya var.`
    );
    return;
  }

  if (newStatus === "confirmed") {
    const confirmTemplate = optionalEnv("TWILIO_CONFIRM_CONTENT_SID");
    const freeText = `Rezervasiyanız təsdiqləndi! Tarix: ${dateAz} ${r.time}, Xidmət: ${r.service}. Görüşərik!`;
    await notifyCustomerMessage(cfg, r.phone, freeText, confirmTemplate, [dateAz, r.time, r.service]);
  } else {
    const bookingLink = requireEnv("BOOKING_LINK");
    const declineTemplate = optionalEnv("TWILIO_DECLINE_CONTENT_SID");
    const freeText =
      `Rezervasiya ləğv edildi.\nTarix: ${dateAz} ${r.time}\nXidmət: ${r.service}\n\nBaşqa tarix seçin: ${bookingLink}`;
    await notifyCustomerMessage(cfg, r.phone, freeText, declineTemplate, [dateAz, r.time, r.firstName, r.service, bookingLink]);
  }

  const ackAz = newStatus === "confirmed" ? "✅ Təsdiqləndi" : "❌ Ləğv edildi";
  await sendText(
    cfg,
    from,
    `${ackAz}: ${dateAz} ${r.time} — ${r.firstName} ${r.lastName}. Müştəriyə bildiriş göndərildi.`
  );
}

function validateTwilioSignature(
  req: VercelRequest,
  authToken: string,
  signature: string
): boolean {
  const protocol = req.headers["x-forwarded-proto"] ?? "https";
  const host = req.headers["host"] ?? "";
  const url = `${protocol}://${host}${req.url}`;

  const params = req.body as Record<string, string>;
  const sortedKeys = Object.keys(params).sort();
  let dataStr = url;
  for (const key of sortedKeys) {
    dataStr += key + params[key];
  }

  const expected = crypto
    .createHmac("sha1", authToken)
    .update(dataStr)
    .digest("base64");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
