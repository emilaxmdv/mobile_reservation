import type { VercelRequest, VercelResponse } from "@vercel/node";
import * as crypto from "crypto";
import { handleUpdate, TgUpdate } from "./_lib/bot";
import { requireEnv } from "./_lib/env";
import { telegramConfigFromEnv } from "./_lib/telegram";

function secretMatches(received: unknown, expected: string): boolean {
  if (typeof received !== "string") return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * POST /api/telegram-webhook — Telegram Bot API webhook-u.
 * setWebhook zamanı verilən secret_token hər sorğuda
 * X-Telegram-Bot-Api-Secret-Token header-i ilə gəlir; uyğun gəlməyən sorğular
 * rədd edilir, beləliklə saxta sorğu ilə rezervasiya statusunu dəyişmək olmur.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  if (!secretMatches(req.headers["x-telegram-bot-api-secret-token"], requireEnv("TELEGRAM_WEBHOOK_SECRET"))) {
    console.warn("Telegram webhook: secret uyğun gəlmədi");
    res.status(401).send("Unauthorized");
    return;
  }

  const update = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) as TgUpdate;

  try {
    await handleUpdate(update, telegramConfigFromEnv());
  } catch (err) {
    console.error("Telegram update emal olunmadı:", update?.update_id, err);
  }

  // Həmişə 200 — əks halda Telegram eyni update-i dəfələrlə təkrar göndərir.
  res.status(200).send("OK");
}
