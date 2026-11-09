import type { VercelRequest, VercelResponse } from "@vercel/node";
import * as crypto from "crypto";
import { BOT_COMMANDS } from "./_lib/bot";
import { requireEnv } from "./_lib/env";
import { setMyCommands, setWebhook, telegramConfigFromEnv } from "./_lib/telegram";

/**
 * GET /api/telegram-setup?secret=<TELEGRAM_WEBHOOK_SECRET>
 * Deploy-dan sonra BİR DƏFƏ brauzerdə açılır: webhook-u bu domenə yönəldir və
 * botun əmr menyusunu qeyd edir. Domen dəyişəndə təkrar açmaq kifayətdir.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const expected = requireEnv("TELEGRAM_WEBHOOK_SECRET");
  const given = typeof req.query.secret === "string" ? req.query.secret : "";
  const ok =
    given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) {
    res.status(401).json({ error: "secret düzgün deyil" });
    return;
  }

  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const webhookUrl = `https://${host}/api/telegram-webhook`;

  try {
    const cfg = telegramConfigFromEnv();
    await setWebhook(cfg, webhookUrl, expected);
    await setMyCommands(cfg, BOT_COMMANDS);
    res.status(200).json({ ok: true, webhookUrl });
  } catch (err) {
    console.error("telegram-setup xətası:", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
}
