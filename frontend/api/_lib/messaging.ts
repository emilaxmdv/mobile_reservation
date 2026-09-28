/**
 * Unified messaging abstraction — MESSAGING_PROVIDER env ilə Meta / Twilio
 * arasında keçid edir. Default: "meta" (mövcud davranış, geriyə uyğun).
 *
 * İstifadə: create-reservation, birthday-check, webhook-lar bu modulu import edir.
 * whatsapp.ts (Meta) və twilio.ts (Twilio) xüsusi implementasiyalar kimi qalır.
 */
import { optionalEnv } from "./env";
import {
  twilioConfigFromEnv,
  twilioNotifyCustomer,
  twilioSendButtons,
  twilioSendText,
  TwilioConfig,
  TwilioReplyButton,
} from "./twilio";
import {
  notifyCustomer as metaNotifyCustomer,
  ReplyButton,
  sendInteractiveButtons as metaSendButtons,
  sendTextMessage as metaSendText,
  whatsappConfigFromEnv,
  WhatsAppClientConfig,
} from "./whatsapp";

export type MessagingProvider = "meta" | "twilio";

export function getProvider(): MessagingProvider {
  const p = optionalEnv("MESSAGING_PROVIDER");
  if (p === "twilio") return "twilio";
  return "meta";
}

export type MessagingConfig = WhatsAppClientConfig | TwilioConfig;

export function messagingConfigFromEnv(): MessagingConfig {
  return getProvider() === "twilio" ? twilioConfigFromEnv() : whatsappConfigFromEnv();
}

export async function sendText(
  cfg: MessagingConfig,
  to: string,
  body: string
): Promise<string | null> {
  if (getProvider() === "twilio") {
    return twilioSendText(cfg as TwilioConfig, to, body);
  }
  return metaSendText(cfg as WhatsAppClientConfig, to, body);
}

export async function sendButtons(
  cfg: MessagingConfig,
  to: string,
  bodyText: string,
  buttons: ReplyButton[]
): Promise<string | null> {
  if (getProvider() === "twilio") {
    return twilioSendButtons(
      cfg as TwilioConfig,
      to,
      bodyText,
      buttons as TwilioReplyButton[]
    );
  }
  return metaSendButtons(cfg as WhatsAppClientConfig, to, bodyText, buttons);
}

export async function notifyCustomerMessage(
  cfg: MessagingConfig,
  to: string,
  freeText: string,
  templateNameOrSid: string | undefined,
  templateParams: string[]
): Promise<void> {
  if (getProvider() === "twilio") {
    const vars: Record<string, string> = {};
    templateParams.forEach((v, i) => {
      vars[String(i + 1)] = v;
    });
    return twilioNotifyCustomer(cfg as TwilioConfig, to, freeText, templateNameOrSid, vars);
  }
  return metaNotifyCustomer(cfg as WhatsAppClientConfig, to, freeText, templateNameOrSid, templateParams);
}
