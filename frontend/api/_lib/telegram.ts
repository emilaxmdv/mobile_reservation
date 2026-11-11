import { optionalEnv, requireEnv } from "./env";

export interface TelegramConfig {
  token: string;
}

export function telegramConfigFromEnv(): TelegramConfig {
  return { token: requireEnv("TELEGRAM_BOT_TOKEN") };
}

/**
 * Yeni rezervasiya bildirişlərinin getdiyi çat (şəxsi çat və ya qrup).
 * Webhook bundan asılı deyil — quraşdırma zamanı /id bu dəyər olmadan da işləyir.
 */
export function notifyChatIdFromEnv(): string {
  return requireEnv("TELEGRAM_CHAT_ID");
}

/** Bildiriş çatı varsa onu qaytarır (webhook quraşdırma zamanı da işləsin deyə xətasız). */
export function optionalNotifyChatId(): string | undefined {
  return optionalEnv("TELEGRAM_CHAT_ID");
}

/**
 * Düymələri basmağa və əmrləri işlətməyə icazəsi olan Telegram user ID-ləri.
 * Bundan əlavə, TELEGRAM_CHAT_ID qrupdursa, həmin qrupun hər üzvü icazəlidir (bot.ts).
 */
export function adminIdsFromEnv(): Set<string> {
  const raw = optionalEnv("TELEGRAM_ADMIN_IDS") ?? "";
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

export interface InlineButton {
  text: string;
  /** Webhook-a callback_query.data kimi qayıdır. Maks 64 bayt. */
  callback_data: string;
}

async function callApi<T>(
  cfg: TelegramConfig,
  method: string,
  payload: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${cfg.token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => null)) as
    | { ok: boolean; result?: T; description?: string }
    | null;
  if (!res.ok || !body?.ok) {
    // Token heç vaxt xəta mətninə düşmür — yalnız metod adı və Telegram-ın cavabı
    throw new Error(
      `Telegram API xətası (${method}, HTTP ${res.status}): ${body?.description ?? "cavab yoxdur"}`
    );
  }
  return body.result as T;
}

/** Telegram HTML parse_mode üçün istifadəçi mətnini təhlükəsiz edir. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** HTML mesaj göndərir; message_id qaytarır. */
export async function sendMessage(
  cfg: TelegramConfig,
  chatId: string | number,
  html: string,
  buttons?: InlineButton[][]
): Promise<number> {
  const result = await callApi<{ message_id: number }>(cfg, "sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
  return result.message_id;
}

/** Mesajın mətnini dəyişir. buttons verilmədikdə inline düymələr silinir. */
export async function editMessageText(
  cfg: TelegramConfig,
  chatId: string | number,
  messageId: number,
  html: string,
  buttons?: InlineButton[][]
): Promise<void> {
  await callApi(cfg, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

/** Düymə basılışına cavab — Telegram-da "yüklənir" saatını dayandırır. */
export async function answerCallbackQuery(
  cfg: TelegramConfig,
  callbackQueryId: string,
  text?: string,
  showAlert = false
): Promise<void> {
  await callApi(cfg, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text, show_alert: showAlert } : {}),
  });
}

export async function setWebhook(
  cfg: TelegramConfig,
  url: string,
  secretToken: string
): Promise<void> {
  await callApi(cfg, "setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
}

/**
 * İstifadəçi qrupun hazırkı üzvüdürmü? (bot həmin qrupda olmalıdır)
 * Çıxmış / qovulmuş / tapılmayan → false.
 */
export async function isChatMember(
  cfg: TelegramConfig,
  chatId: string | number,
  userId: number
): Promise<boolean> {
  const m = await callApi<{ status: string; is_member?: boolean }>(cfg, "getChatMember", {
    chat_id: chatId,
    user_id: userId,
  });
  return (
    m.status === "creator" ||
    m.status === "administrator" ||
    m.status === "member" ||
    (m.status === "restricted" && m.is_member === true)
  );
}

export async function setMyCommands(
  cfg: TelegramConfig,
  commands: Array<{ command: string; description: string }>
): Promise<void> {
  await callApi(cfg, "setMyCommands", { commands });
}
