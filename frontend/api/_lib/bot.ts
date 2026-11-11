// Telegram webhook-una gələn update-lərin emalı: Təsdiq/Ləğv düymələri,
// təsdiqlənmiş rezervasiyanın ləğvi və /bagla, /ac, /baglilar, /gun, /id, /komek əmrləri.

import { FieldValue, Firestore } from "firebase-admin/firestore";
import {
  applyBlock,
  applyUnblock,
  BlockState,
  isSlotBlocked,
  parseBlockArgs,
  parseDateToken,
  sameBlockState,
} from "./blocks";
import { BLOCKS_COLLECTION, RESERVATIONS_COLLECTION } from "./constants";
import { getDb } from "./firebase";
import {
  blockStateLabel,
  dateLabel,
  decidedReservationHtml,
  HELP_HTML,
  personLabel,
  shortReservationLabel,
} from "./messages";
import {
  adminIdsFromEnv,
  answerCallbackQuery,
  editMessageText,
  escapeHtml,
  InlineButton,
  isChatMember,
  optionalNotifyChatId,
  sendMessage,
  TelegramConfig,
} from "./telegram";
import type { BlockDoc, ReservationDoc } from "./types";
import { bakuDateString, formatPhoneDisplay } from "./utils";

// ── Telegram update tipləri (yalnız istifadə etdiyimiz sahələr) ──────────────
interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}
interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: TgUser;
  text?: string;
}
interface TgCallbackQuery {
  id: string;
  from: TgUser;
  data?: string;
  message?: TgMessage;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export const BOT_COMMANDS = [
  { command: "bagla", description: "Gün və ya saatı bağla: /bagla 15.11 14:00" },
  { command: "ac", description: "Bağlı gün/saatı aç: /ac 15.11 14:00" },
  { command: "baglilar", description: "Gələcək bağlı gün və saatlar" },
  { command: "gun", description: "Günün rezervasiyaları: /gun 15.11" },
  { command: "komek", description: "Əmrlərin izahı" },
  { command: "id", description: "Telegram ID-nizi göstərir" },
];

function userLabel(u: TgUser): string {
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || "İşçi";
  return `tg:${u.id} ${name}${u.username ? ` (@${u.username})` : ""}`;
}

/**
 * İcazə: TELEGRAM_ADMIN_IDS siyahısında olan VƏ YA bildiriş qrupunun
 * (TELEGRAM_CHAT_ID mənfidirsə) hazırkı üzvü olan istifadəçi.
 * Beləcə yeni işçini qrupa əlavə etmək kifayətdir; qrupdan çıxan icazəni itirir.
 */
async function isAdmin(u: TgUser | undefined, cfg: TelegramConfig): Promise<boolean> {
  if (!u) return false;
  if (adminIdsFromEnv().has(String(u.id))) return true;
  const groupId = optionalNotifyChatId();
  if (!groupId || !groupId.startsWith("-")) return false;
  try {
    return await isChatMember(cfg, groupId, u.id);
  } catch (err) {
    // "user not found", bot qrupdan çıxarılıb və s. — icazə vermirik
    console.warn("Qrup üzvlüyü yoxlanmadı:", err);
    return false;
  }
}

export async function handleUpdate(update: TgUpdate, cfg: TelegramConfig): Promise<void> {
  if (update.callback_query) {
    await handleCallback(update.callback_query, cfg);
  } else if (update.message?.text?.startsWith("/")) {
    await handleCommand(update.message, cfg);
  }
}

// ── Təsdiq / Ləğv düymələri ─────────────────────────────────────────────────

type DecisionOutcome =
  | { kind: "not-found" }
  | { kind: "already"; r: ReservationDoc }
  | { kind: "slot-conflict"; r: ReservationDoc }
  | { kind: "slot-blocked"; r: ReservationDoc }
  | { kind: "updated"; r: ReservationDoc };

async function decide(
  db: Firestore,
  reservationId: string,
  newStatus: "confirmed" | "declined",
  decidedBy: string
): Promise<DecisionOutcome> {
  const ref = db.collection(RESERVATIONS_COLLECTION).doc(reservationId);
  // Tranzaksiya: eyni düyməyə iki dəfə basılması / paralel təsdiq münaqişələri üçün.
  return db.runTransaction(async (tx): Promise<DecisionOutcome> => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { kind: "not-found" };
    const r = snap.data() as ReservationDoc;
    if (r.status !== "pending") return { kind: "already", r };

    if (newStatus === "confirmed") {
      const conflictSnap = await tx.get(
        db
          .collection(RESERVATIONS_COLLECTION)
          .where("date", "==", r.date)
          .where("time", "==", r.time)
          .where("status", "==", "confirmed")
          .limit(1)
      );
      if (!conflictSnap.empty) return { kind: "slot-conflict", r };

      const blockSnap = await tx.get(db.collection(BLOCKS_COLLECTION).doc(r.date));
      if (isSlotBlocked(blockSnap.data() as BlockDoc | undefined, r.time)) {
        return { kind: "slot-blocked", r };
      }
    }

    tx.update(ref, {
      status: newStatus,
      updatedAt: FieldValue.serverTimestamp(),
      decidedAt: FieldValue.serverTimestamp(),
      decidedBy,
    });
    return { kind: "updated", r: { ...r, status: newStatus, decidedBy } };
  });
}

const cancelButton = (id: string): InlineButton[][] => [
  [{ text: "🗑 Ləğv et", callback_data: `cancel:${id}` }],
];

/** Rezervasiya mesajının statusa uyğun mətni və düymələri. */
function statusView(id: string, r: ReservationDoc): { html: string; buttons?: InlineButton[][] } {
  const by = r.status === "cancelled" ? r.cancelledBy : r.decidedBy;
  return {
    html: decidedReservationHtml(r, r.status, by),
    buttons: r.status === "confirmed" ? cancelButton(id) : undefined,
  };
}

/** Bildiriş mesajını yeniləyir; "message is not modified" kimi xətalar əməliyyatı pozmur. */
async function safeEdit(
  cfg: TelegramConfig,
  chatId: string | number | undefined,
  messageId: number | undefined,
  html: string,
  buttons?: InlineButton[][]
): Promise<void> {
  if (chatId === undefined || messageId === undefined) return;
  await editMessageText(cfg, chatId, messageId, html, buttons).catch((err) =>
    console.warn("Mesaj redaktə olunmadı:", err)
  );
}

async function handleCallback(cq: TgCallbackQuery, cfg: TelegramConfig): Promise<void> {
  if (!(await isAdmin(cq.from, cfg))) {
    await answerCallbackQuery(cfg, cq.id, "Bu əməliyyat üçün icazəniz yoxdur.", true);
    return;
  }

  const [action, reservationId] = (cq.data ?? "").split(":");
  if (!reservationId) {
    await answerCallbackQuery(cfg, cq.id);
    return;
  }
  if (action === "cancel" || action === "cancel_yes" || action === "cancel_no") {
    await handleCancelCallback(cq, cfg, action, reservationId);
    return;
  }
  if (action !== "confirm" && action !== "decline") {
    await answerCallbackQuery(cfg, cq.id);
    return;
  }

  const outcome = await decide(
    getDb(),
    reservationId,
    action === "confirm" ? "confirmed" : "declined",
    userLabel(cq.from)
  );

  const msg = cq.message;
  const refreshMessage = async (r: ReservationDoc) => {
    const view = statusView(reservationId, r);
    await safeEdit(cfg, msg?.chat.id, msg?.message_id, view.html, view.buttons);
  };

  switch (outcome.kind) {
    case "not-found":
      await answerCallbackQuery(cfg, cq.id, "Rezervasiya tapılmadı (silinib?).", true);
      return;
    case "already":
      await refreshMessage(outcome.r);
      await answerCallbackQuery(
        cfg,
        cq.id,
        outcome.r.status === "confirmed" ? "Artıq təsdiqlənib." : "Artıq ləğv edilib."
      );
      return;
    case "slot-conflict":
      await answerCallbackQuery(
        cfg,
        cq.id,
        `${outcome.r.time} saatında artıq başqa təsdiqlənmiş rezervasiya var. Bu sorğunu ləğv edin və ya müştəri ilə başqa vaxt razılaşın.`,
        true
      );
      return;
    case "slot-blocked":
      await answerCallbackQuery(
        cfg,
        cq.id,
        `${outcome.r.time} saatı /bagla ilə bağlanıb. Təsdiq üçün əvvəlcə /ac ilə açın.`,
        true
      );
      return;
    case "updated":
      await refreshMessage(outcome.r);
      await answerCallbackQuery(
        cfg,
        cq.id,
        outcome.r.status === "confirmed" ? "Təsdiqləndi ✅ Saat saytda dolu göstərilir." : "Ləğv edildi ❌"
      );
      return;
  }
}

// ── Təsdiqlənmiş rezervasiyanın ləğvi ───────────────────────────────────────
// "🗑 Ləğv et" → ayrıca təsdiq mesajı (Bəli / Xeyr) → status "cancelled",
// saat saytda yenidən boşalır.

async function handleCancelCallback(
  cq: TgCallbackQuery,
  cfg: TelegramConfig,
  action: "cancel" | "cancel_yes" | "cancel_no",
  reservationId: string
): Promise<void> {
  const db = getDb();
  const ref = db.collection(RESERVATIONS_COLLECTION).doc(reservationId);
  const msg = cq.message;

  if (action === "cancel_no") {
    await safeEdit(cfg, msg?.chat.id, msg?.message_id, "↩️ Ləğv edilmədi, rezervasiya qüvvədədir.");
    await answerCallbackQuery(cfg, cq.id);
    return;
  }

  if (action === "cancel") {
    const snap = await ref.get();
    if (!snap.exists) {
      await answerCallbackQuery(cfg, cq.id, "Rezervasiya tapılmadı (silinib?).", true);
      return;
    }
    const r = snap.data() as ReservationDoc;
    if (r.status !== "confirmed") {
      await answerCallbackQuery(cfg, cq.id, "Bu rezervasiya təsdiqlənmiş deyil — ləğv ediləcək bir şey yoxdur.", true);
      return;
    }
    await sendMessage(
      cfg,
      msg?.chat.id ?? r.telegramChatId!,
      `🗑 <b>Ləğv edilsin?</b>\n${shortReservationLabel(r)}\n\nSaat saytda yenidən boş görünəcək.`,
      [
        [
          { text: "✅ Bəli, ləğv et", callback_data: `cancel_yes:${reservationId}` },
          { text: "↩️ Xeyr", callback_data: `cancel_no:${reservationId}` },
        ],
      ]
    );
    await answerCallbackQuery(cfg, cq.id);
    return;
  }

  // cancel_yes
  const by = userLabel(cq.from);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { kind: "not-found" as const };
    const r = snap.data() as ReservationDoc;
    if (r.status !== "confirmed") return { kind: "not-confirmed" as const, r };
    tx.update(ref, {
      status: "cancelled",
      updatedAt: FieldValue.serverTimestamp(),
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: by,
    });
    return { kind: "cancelled" as const, r: { ...r, status: "cancelled" as const, cancelledBy: by } };
  });

  if (result.kind === "not-found") {
    await answerCallbackQuery(cfg, cq.id, "Rezervasiya tapılmadı (silinib?).", true);
    return;
  }
  if (result.kind === "not-confirmed") {
    await safeEdit(
      cfg,
      msg?.chat.id,
      msg?.message_id,
      `Dəyişiklik yoxdur — rezervasiya artıq ${result.r.status === "cancelled" ? "ləğv edilib" : "təsdiqlənmiş deyil"}.\n${shortReservationLabel(result.r)}`
    );
    await answerCallbackQuery(cfg, cq.id);
    return;
  }

  const r = result.r;
  await safeEdit(
    cfg,
    msg?.chat.id,
    msg?.message_id,
    `🗑 <b>Ləğv edildi</b> — ${personLabel(by)}\n${shortReservationLabel(r)}\nSaat saytda yenidən boşdur.`
  );
  // İlk bildiriş mesajını da yenilə ki, orada köhnə "Təsdiqləndi" + düymə qalmasın
  const view = statusView(reservationId, r);
  await safeEdit(cfg, r.telegramChatId, r.telegramMessageId, view.html, view.buttons);
  await answerCallbackQuery(cfg, cq.id, "Ləğv edildi. Saat yenidən boşdur.");
}

// ── Əmrlər ───────────────────────────────────────────────────────────────────

async function handleCommand(msg: TgMessage, cfg: TelegramConfig): Promise<void> {
  const [rawCmd, ...args] = (msg.text ?? "").trim().split(/\s+/);
  // Qrupda "/bagla@AjoureBot" formatında gəlir
  const cmd = rawCmd.slice(1).split("@")[0].toLowerCase();
  const reply = (html: string) => sendMessage(cfg, msg.chat.id, html);

  if (cmd === "id") {
    await reply(
      `Sizin Telegram ID: <code>${msg.from?.id ?? "?"}</code>\nBu çatın ID-si: <code>${msg.chat.id}</code>`
    );
    return;
  }

  if (!(await isAdmin(msg.from, cfg))) {
    // Naməlum istifadəçilərə yalnız /start-a cavab veririk ki, bot "susmuş" görünməsin
    if (cmd === "start") {
      await reply("Bu bot yalnız Ajoure işçiləri üçündür. Sizi Ajoure işçi qrupuna əlavə etmələrini xahiş edin.");
    }
    return;
  }

  const today = bakuDateString();
  switch (cmd) {
    case "start":
    case "komek":
    case "help":
      await reply(HELP_HTML);
      return;
    case "bagla":
      await reply(await changeBlocks(args, today, "block", userLabel(msg.from!)));
      return;
    case "ac":
      await reply(await changeBlocks(args, today, "unblock", userLabel(msg.from!)));
      return;
    case "baglilar":
      await reply(await listBlocks(today));
      return;
    case "gun": {
      const day = await dayOverview(args, today);
      await sendMessage(cfg, msg.chat.id, day.html, day.buttons);
      return;
    }
    default:
      await reply("Naməlum əmr. /komek yazın.");
  }
}

async function changeBlocks(
  args: string[],
  today: string,
  mode: "block" | "unblock",
  by: string
): Promise<string> {
  const parsed = parseBlockArgs(args, today);
  if (!parsed.ok) return `⚠️ ${escapeHtml(parsed.error)}`;

  const db = getDb();
  const col = db.collection(BLOCKS_COLLECTION);
  const { dates, times, reason } = parsed;

  const changes = await db.runTransaction(async (tx) => {
    const snaps = await Promise.all(dates.map((d) => tx.get(col.doc(d))));
    const result: Array<{ date: string; before: BlockState | null; after: BlockState | null }> = [];
    snaps.forEach((snap, idx) => {
      const date = dates[idx];
      const doc = snap.exists ? (snap.data() as BlockDoc) : null;
      const before: BlockState | null = doc ? { allDay: doc.allDay, times: doc.times } : null;
      const after = mode === "block" ? applyBlock(before, times) : applyUnblock(before, times);
      result.push({ date, before, after });
      if (sameBlockState(before, after)) return;
      if (after === null) {
        tx.delete(col.doc(date));
      } else {
        tx.set(col.doc(date), {
          date,
          allDay: after.allDay,
          times: after.times,
          reason: reason || doc?.reason || "",
          updatedBy: by,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });
    return result;
  });

  const changed = changes.filter((c) => !sameBlockState(c.before, c.after));
  const head = mode === "block" ? "🔒 <b>Bağlandı</b>" : "🔓 <b>Açıldı</b>";
  const lines: string[] = [];
  if (changed.length === 0) {
    lines.push(mode === "block" ? "Dəyişiklik yoxdur — artıq bağlı idi." : "Dəyişiklik yoxdur — artıq açıq idi.");
  } else {
    lines.push(head);
    for (const c of changed) lines.push(`• ${dateLabel(c.date)} — ${blockStateLabel(c.after)}`);
    if (reason && mode === "block") lines.push(`Səbəb: ${escapeHtml(reason)}`);
  }

  if (mode === "block" && changed.length > 0) {
    const warnings = await reservationsInBlockedSlots(db, changed.map((c) => c.date), times);
    if (warnings.length) {
      lines.push("", "⚠️ <b>Bu vaxtlarda rezervasiya var:</b>", ...warnings);
      lines.push("Lazımdırsa müştəri ilə əlaqə saxlayın.");
    }
  }
  return lines.join("\n");
}

async function reservationsInBlockedSlots(
  db: Firestore,
  dates: string[],
  times: string[] | null
): Promise<string[]> {
  const snap = await db
    .collection(RESERVATIONS_COLLECTION)
    .where("date", ">=", dates[0])
    .where("date", "<=", dates[dates.length - 1])
    .get();
  const dateSet = new Set(dates);
  return snap.docs
    .map((d) => d.data() as ReservationDoc)
    .filter(
      (r) =>
        (r.status === "pending" || r.status === "confirmed") &&
        dateSet.has(r.date) &&
        (times === null || times.includes(r.time))
    )
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    .map(
      (r) =>
        `• ${dateLabel(r.date)} ${r.time} — ${escapeHtml(`${r.firstName} ${r.lastName}`)} ` +
        `(${r.status === "confirmed" ? "təsdiqlənib" : "gözləmədə"})`
    );
}

/** /gun <tarix>: həmin günün rezervasiyaları + bağlı saatlar; təsdiqlənmişlər üçün 🗑 düymələri. */
async function dayOverview(
  args: string[],
  today: string
): Promise<{ html: string; buttons?: InlineButton[][] }> {
  const date = args.length ? parseDateToken(args[0], today) : today;
  if (!date) {
    return { html: "⚠️ Tarixi anlamadım. Nümunə: <code>/gun 15.11</code>, <code>/gun bugun</code>, <code>/gun sabah</code>" };
  }

  const db = getDb();
  const [resSnap, blockSnap] = await Promise.all([
    db.collection(RESERVATIONS_COLLECTION).where("date", "==", date).get(),
    db.collection(BLOCKS_COLLECTION).doc(date).get(),
  ]);
  const block = blockSnap.exists ? (blockSnap.data() as BlockDoc) : null;
  const items = resSnap.docs
    .map((d) => ({ id: d.id, r: d.data() as ReservationDoc }))
    .filter(({ r }) => r.status === "pending" || r.status === "confirmed")
    .sort((a, b) => a.r.time.localeCompare(b.r.time));

  const lines = [`📅 <b>${dateLabel(date)}</b>`];
  if (block) {
    const reason = block.reason ? ` — <i>${escapeHtml(block.reason)}</i>` : "";
    lines.push(`🔒 ${blockStateLabel({ allDay: block.allDay, times: block.times })}${reason}`);
  }
  if (items.length === 0) {
    lines.push("", "Aktiv rezervasiya yoxdur.");
    return { html: lines.join("\n") };
  }
  lines.push("");
  for (const { r } of items) {
    const mark = r.status === "confirmed" ? "✅" : "⏳";
    lines.push(
      `${mark} ${r.time} — ${escapeHtml(`${r.firstName} ${r.lastName}`)} · ${escapeHtml(r.service)} · ${formatPhoneDisplay(r.phone)}`
    );
  }
  const confirmed = items.filter(({ r }) => r.status === "confirmed");
  if (confirmed.length) lines.push("", "Təsdiqlənmişi ləğv etmək üçün aşağıdakı düyməni basın.");
  return {
    html: lines.join("\n"),
    buttons: confirmed.length
      ? confirmed.map(({ id, r }) => [
          { text: `🗑 ${r.time} ${r.firstName} ${r.lastName}`.slice(0, 60), callback_data: `cancel:${id}` },
        ])
      : undefined,
  };
}

async function listBlocks(today: string): Promise<string> {
  const snap = await getDb()
    .collection(BLOCKS_COLLECTION)
    .where("date", ">=", today)
    .orderBy("date")
    .limit(60)
    .get();
  if (snap.empty) return "Gələcəkdə bağlı gün və ya saat yoxdur.";
  const lines = ["🔒 <b>Bağlı gün və saatlar</b>"];
  for (const d of snap.docs) {
    const b = d.data() as BlockDoc;
    const reason = b.reason ? ` — <i>${escapeHtml(b.reason)}</i>` : "";
    lines.push(`• ${dateLabel(b.date)}: ${b.allDay ? "bütün gün" : b.times.join(", ")}${reason}`);
  }
  return lines.join("\n");
}
