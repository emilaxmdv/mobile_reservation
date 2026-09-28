import { requireEnv } from "./env";

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

export function twilioConfigFromEnv(): TwilioConfig {
  return {
    accountSid: requireEnv("TWILIO_ACCOUNT_SID"),
    authToken: requireEnv("TWILIO_AUTH_TOKEN"),
    fromNumber: requireEnv("TWILIO_WHATSAPP_FROM"),
  };
}

async function callTwilioApi(
  cfg: TwilioConfig,
  params: URLSearchParams
): Promise<string | null> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`;
  const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Twilio API xətası (HTTP ${res.status}): ${body}`);
  }

  try {
    const json = JSON.parse(body) as { sid?: string };
    return json.sid ?? null;
  } catch {
    return null;
  }
}

function toWhatsApp(phone: string): string {
  return `whatsapp:+${phone}`;
}

export async function twilioSendText(
  cfg: TwilioConfig,
  to: string,
  body: string
): Promise<string | null> {
  const params = new URLSearchParams();
  params.set("From", cfg.fromNumber);
  params.set("To", toWhatsApp(to));
  params.set("Body", body);
  return callTwilioApi(cfg, params);
}

export interface TwilioReplyButton {
  id: string;
  title: string;
}

/**
 * Twilio WhatsApp-da interactive buttons yoxdur (Content Template lazımdır).
 * Əvəzinə, düymələri mətn formatında göndəririk:
 *
 *   Yeni rezervasiya
 *   ...
 *   Cavab verin:
 *   T ab3f12 — Təsdiq et
 *   L ab3f12 — Ləğv et
 *
 * Mütəxəssis "T ab3f12" və ya "L ab3f12" yazaraq cavab verir.
 */
export async function twilioSendButtons(
  cfg: TwilioConfig,
  to: string,
  bodyText: string,
  buttons: TwilioReplyButton[]
): Promise<string | null> {
  const reservationId = buttons[0]?.id.split(":")[1] ?? "";
  const shortId = reservationId.slice(0, 6);

  const instructions = buttons
    .map((b) => {
      const prefix = b.id.startsWith("confirm") ? "T" : "L";
      return `${prefix} ${shortId} — ${b.title}`;
    })
    .join("\n");

  const fullBody = `${bodyText}\n\n📩 Cavab verin:\n${instructions}`;
  return twilioSendText(cfg, to, fullBody);
}

export async function twilioSendTemplate(
  cfg: TwilioConfig,
  to: string,
  contentSid: string,
  contentVariables: Record<string, string>
): Promise<string | null> {
  const params = new URLSearchParams();
  params.set("From", cfg.fromNumber);
  params.set("To", toWhatsApp(to));
  params.set("ContentSid", contentSid);
  params.set("ContentVariables", JSON.stringify(contentVariables));
  return callTwilioApi(cfg, params);
}

export async function twilioNotifyCustomer(
  cfg: TwilioConfig,
  to: string,
  freeText: string,
  contentSid: string | undefined,
  contentVariables: Record<string, string>
): Promise<void> {
  try {
    if (contentSid) {
      await twilioSendTemplate(cfg, to, contentSid, contentVariables);
    } else {
      await twilioSendText(cfg, to, freeText);
    }
  } catch (err) {
    console.error("Twilio: müştəriyə bildiriş göndərilə bilmədi:", to, err);
  }
}
