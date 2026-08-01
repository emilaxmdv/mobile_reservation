import type { VercelRequest, VercelResponse } from "@vercel/node";
import * as crypto from "crypto";
import { RESERVATIONS_COLLECTION } from "./_lib/constants";
import { optionalEnv, requireEnv } from "./_lib/env";
import { getDb } from "./_lib/firebase";
import { ReservationDoc } from "./_lib/types";
import { formatDateAz } from "./_lib/utils";
import {
  notifyCustomer,
  sendTextMessage,
  whatsappConfigFromEnv,
  WhatsAppClientConfig,
} from "./_lib/whatsapp";

// İmza yoxlaması üçün xam body lazımdır — Vercel-in avtomatik JSON parser-i
// söndürülür, body-ni özümüz oxuyuruq.
export const config = {
  api: { bodyParser: false },
};

/** Sorğunun xam body-sini Buffer kimi oxuyur. */
async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/** Meta webhook sorğusunun həqiqiliyini X-Hub-Signature-256 imzası ilə yoxlayır. */
function isSignatureValid(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const received = signatureHeader.slice("sha256=".length);
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
}

interface ButtonPress {
  action: "confirm" | "decline";
  reservationId: string;
  /** Düyməni basan nömrə (mütəxəssis). */
  from: string;
}

/** Webhook payload-ından basılmış düymələri çıxarır. */
function extractButtonPresses(body: unknown): ButtonPress[] {
  const presses: ButtonPress[] = [];
  const entries = (body as { entry?: unknown[] })?.entry ?? [];
  for (const entry of entries as Array<{ changes?: unknown[] }>) {
    for (const change of (entry.changes ?? []) as Array<{ value?: { messages?: unknown[] } }>) {
      for (const msg of (change.value?.messages ?? []) as Array<Record<string, unknown>>) {
        let payload: string | undefined;
        // İnteraktiv reply düyməsi (bizim göndərdiyimiz format)
        if (msg.type === "interactive") {
          const interactive = msg.interactive as {
            type?: string;
            button_reply?: { id?: string };
          };
          if (interactive?.type === "button_reply") payload = interactive.button_reply?.id;
        }
        // Template quick-reply düyməsi (template istifadə olunarsa)
        if (msg.type === "button") {
          payload = (msg.button as { payload?: string })?.payload;
        }
        if (!payload) continue;

        const [action, reservationId] = payload.split(":");
        if ((action === "confirm" || action === "decline") && reservationId) {
          presses.push({ action, reservationId, from: String(msg.from ?? "") });
        }
      }
    }
  }
  return presses;
}

/** Bir düymə basılışını emal edir: statusu dəyişir, müştəriyə və mütəxəssisə xəbər verir. */
async function processButtonPress(press: ButtonPress, cfg: WhatsAppClientConfig): Promise<void> {
  // Əlavə sərtləşdirmə: qərar düymələri yalnız mütəxəssisin nömrəsindən qəbul
  // edilir — başqa nömrədən gələn düymə payload-ları emal olunmur.
  const specialistNumber = requireEnv("SPECIALIST_WHATSAPP_NUMBER");
  if (press.from !== specialistNumber) {
    console.warn("Düymə basılışı mütəxəssis olmayan nömrədən gəldi — iqnor edilir:", press.from);
    return;
  }

  const db = getDb();
  const ref = db.collection(RESERVATIONS_COLLECTION).doc(press.reservationId);
  const newStatus = press.action === "confirm" ? "confirmed" : "declined";

  // Tranzaksiya: eyni düyməyə iki dəfə basılması / paralel təsdiq münaqişələri
  // üçün təhlükəsizdir.
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { outcome: "not-found" as const, reservation: null };

    const r = snap.data() as ReservationDoc;
    if (r.status !== "pending") {
      return { outcome: "already-processed" as const, reservation: r };
    }

    if (newStatus === "confirmed") {
      // Bu slot üçün başqa təsdiqlənmiş rezervasiya varsa, ikinci təsdiqi blokla.
      const conflictSnap = await tx.get(
        db
          .collection(RESERVATIONS_COLLECTION)
          .where("date", "==", r.date)
          .where("time", "==", r.time)
          .where("status", "==", "confirmed")
          .limit(1)
      );
      if (!conflictSnap.empty) {
        return { outcome: "slot-conflict" as const, reservation: r };
      }
    }

    tx.update(ref, {
      status: newStatus,
      updatedAt: new Date(),
      decidedAt: new Date(),
      decidedBy: press.from,
    });
    return { outcome: "updated" as const, reservation: r };
  });

  // Tranzaksiyadan SONRA mesajlar göndərilir (tranzaksiya təkrarlana bilər,
  // ona görə yan təsirlər onun içində olmamalıdır).
  if (result.outcome === "not-found") {
    await sendTextMessage(cfg, press.from, "Bu rezervasiya tapılmadı və ya artıq silinib.");
    return;
  }

  const r = result.reservation as ReservationDoc;
  const dateAz = formatDateAz(r.date);

  if (result.outcome === "already-processed") {
    const statusAz = r.status === "confirmed" ? "təsdiqlənib" : "ləğv edilib";
    await sendTextMessage(
      cfg,
      press.from,
      `Bu rezervasiya artıq ${statusAz} (${dateAz} ${r.time}, ${r.firstName} ${r.lastName}).`
    );
    return;
  }

  if (result.outcome === "slot-conflict") {
    await sendTextMessage(
      cfg,
      press.from,
      `Diqqət: ${dateAz} ${r.time} slotu üçün artıq başqa təsdiqlənmiş rezervasiya var. ` +
        `${r.firstName} ${r.lastName}-ın sorğusu gözləmədə qaldı — istəsəniz onu ləğv edin.`
    );
    return;
  }

  // ── Status uğurla dəyişdi → müştəriyə bildiriş ─────────────────────────────
  if (newStatus === "confirmed") {
    await notifyCustomer(
      cfg,
      r.phone,
      `Rezervasiyanız təsdiqləndi! Tarix: ${dateAz} ${r.time}, Xidmət: ${r.service}. Görüşərik!`,
      optionalEnv("WHATSAPP_CONFIRM_TEMPLATE"),
      [dateAz, r.time, r.service]
    );
  } else {
    const bookingLink = requireEnv("BOOKING_LINK");
    await notifyCustomer(
      cfg,
      r.phone,
      `Rezervasiya Ləğv Edildi\n` +
        `Tarix: ${dateAz} ${r.time}\n` +
        `Müştəri: ${r.firstName}\n` +
        `Xidmət: ${r.service}\n\n` +
        `Rezervasiya ləğv edildi. Zəhmət olmasa başqa tarix seçin: ${bookingLink}`,
      optionalEnv("WHATSAPP_DECLINE_TEMPLATE"),
      [dateAz, r.time, r.firstName, r.service, bookingLink]
    );
  }

  // Mütəxəssisə qısa təsdiq
  const ackAz = newStatus === "confirmed" ? "✅ Təsdiqləndi" : "❌ Ləğv edildi";
  await sendTextMessage(
    cfg,
    specialistNumber,
    `${ackAz}: ${dateAz} ${r.time} — ${r.firstName} ${r.lastName}. Müştəriyə bildiriş göndərildi.`
  );
}

/**
 * /api/whatsapp-webhook — WhatsApp Cloud API webhook-u.
 *  - GET: Meta-nın birdəfəlik yoxlama sorğusu (hub.challenge qaytarılır)
 *  - POST: mesaj hadisələri — mütəxəssisin basdığı Təsdiq/Ləğv düymələri
 *
 * META_APP_SECRET təyin olunubsa hər POST sorğusunun imzası yoxlanılır —
 * saxta sorğularla rezervasiya statusunu dəyişmək mümkün olmur.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // ── Webhook qeydiyyatının yoxlanması (Meta konsolunda "Verify and save") ───
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === requireEnv("WHATSAPP_WEBHOOK_VERIFY_TOKEN")) {
      res.status(200).send(String(challenge));
    } else {
      res.status(403).send("Forbidden");
    }
    return;
  }

  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const rawBody = await readRawBody(req);

  // İmza yoxlaması (ciddi tövsiyə olunur — README-yə baxın)
  const appSecret = optionalEnv("META_APP_SECRET");
  if (appSecret) {
    if (!isSignatureValid(rawBody, req.headers["x-hub-signature-256"] as string | undefined, appSecret)) {
      console.warn("Webhook: imza yoxlaması alınmadı");
      res.status(401).send("Invalid signature");
      return;
    }
  } else {
    console.warn("META_APP_SECRET təyin olunmayıb — webhook imzası yoxlanılmır!");
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString("utf8"));
  } catch {
    res.status(400).send("Invalid JSON");
    return;
  }

  const cfg = whatsappConfigFromEnv();

  // Status update-ləri (sent/delivered/read) və digər hadisələr sakitcə ötürülür;
  // yalnız düymə basılışları emal olunur.
  const presses = extractButtonPresses(body);
  for (const press of presses) {
    try {
      await processButtonPress(press, cfg);
    } catch (err) {
      console.error("Düymə basılışının emalı alınmadı:", press, err);
    }
  }

  // Meta 200 gözləyir — əks halda sorğunu təkrar göndərəcək.
  res.status(200).send("OK");
}
