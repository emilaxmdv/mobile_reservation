import { GRAPH_API_VERSION } from "./constants";
import { requireEnv } from "./env";

export interface WhatsAppClientConfig {
  accessToken: string;
  phoneNumberId: string;
}

/** Vercel env dəyişənlərindən WhatsApp klient konfiqurasiyası. */
export function whatsappConfigFromEnv(): WhatsAppClientConfig {
  return {
    accessToken: requireEnv("WHATSAPP_TOKEN"),
    phoneNumberId: requireEnv("WHATSAPP_PHONE_NUMBER_ID"),
  };
}

export interface ReplyButton {
  /** Webhook-a qayıdan payload, məs: "confirm:<reservationId>". Maks 256 simvol. */
  id: string;
  /** Düymə üzərindəki mətn. Maks 20 simvol. */
  title: string;
}

/** WhatsApp Cloud API /messages endpoint-inə sorğu göndərir. */
async function callMessagesApi(
  cfg: WhatsAppClientConfig,
  payload: Record<string, unknown>
): Promise<string | null> {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${cfg.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });

  const body = await res.text();
  if (!res.ok) {
    // Tez-tez rast gəlinən xətalar: 131030 (nömrə icazəli siyahıda deyil),
    // 131047 (24 saatlıq pəncərə bağlıdır — template lazımdır), 190 (token bitib)
    throw new Error(`WhatsApp API xətası (HTTP ${res.status}): ${body}`);
  }

  try {
    const json = JSON.parse(body) as { messages?: Array<{ id: string }> };
    return json.messages?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

/** Sadə mətn mesajı göndərir (yalnız açıq 24 saatlıq pəncərədə çatır). */
export async function sendTextMessage(
  cfg: WhatsAppClientConfig,
  to: string,
  body: string
): Promise<string | null> {
  return callMessagesApi(cfg, {
    to,
    type: "text",
    text: { body, preview_url: true },
  });
}

/** İnteraktiv reply-button mesajı göndərir (maksimum 3 düymə). */
export async function sendInteractiveButtons(
  cfg: WhatsAppClientConfig,
  to: string,
  bodyText: string,
  buttons: ReplyButton[]
): Promise<string | null> {
  return callMessagesApi(cfg, {
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: buttons.map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.title },
        })),
      },
    },
  });
}

/**
 * Meta-da əvvəlcədən təsdiqlənmiş template ilə mesaj göndərir.
 * Biznes-təşəbbüslü mesajlar (müştəri son 24 saatda bizə yazmayıbsa) YALNIZ
 * template ilə çatdırıla bilər. bodyParams template-dəki {{1}}, {{2}}, ...
 * yerlərini sıra ilə doldurur.
 */
export async function sendTemplateMessage(
  cfg: WhatsAppClientConfig,
  to: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[]
): Promise<string | null> {
  return callMessagesApi(cfg, {
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      components: [
        {
          type: "body",
          parameters: bodyParams.map((text) => ({ type: "text", text })),
        },
      ],
    },
  });
}

/**
 * Müştəriyə status bildirişi: template adı verilibsə template ilə (etibarlı yol),
 * verilməyibsə sərbəst mətn cəhd edilir. Sərbəst mətn yalnız müştəri son 24
 * saatda biznesə yazıbsa çatır — bizim axında müştəri veb formu doldurur və
 * adətən heç vaxt yazmayıb, ona görə production üçün template mütləqdir
 * (bax: README → "WhatsApp template-ləri").
 */
export async function notifyCustomer(
  cfg: WhatsAppClientConfig,
  to: string,
  freeText: string,
  templateName: string | undefined,
  templateParams: string[]
): Promise<void> {
  try {
    if (templateName) {
      await sendTemplateMessage(cfg, to, templateName, "az", templateParams);
    } else {
      await sendTextMessage(cfg, to, freeText);
    }
  } catch (err) {
    // Müştəri bildirişinin uğursuzluğu rezervasiya statusunu pozmamalıdır —
    // xəta Vercel funksiya loglarında görünəcək.
    console.error("Müştəriyə WhatsApp bildirişi göndərilə bilmədi:", to, err);
  }
}
