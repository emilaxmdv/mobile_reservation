// Telegram webhook-una gələn update-lərin emalı: Təsdiq/Ləğv düymələri və
// /bagla, /ac, /baglilar, /id, /komek əmrləri.

import { FieldValue, Firestore } from "firebase-admin/firestore";
import {
  applyBlock,
  applyUnblock,
  BlockState,
  isSlotBlocked,
  parseBlockArgs,
  sameBlockState,
} from "./blocks";
import { BLOCKS_COLLECTION, RESERVATIONS_COLLECTION } from "./constants";
import { getDb } from "./firebase";
import {
  blockStateLabel,
  dateLabel,
  decidedReservationHtml,
  HELP_HTML,
} from "./messages";
import {
  adminIdsFromEnv,
  answerCallbackQuery,
  editMessageText,
  escapeHtml,
  sendMessage,
  TelegramConfig,
} from "./telegram";
import type { BlockDoc, ReservationDoc } from "./types";
import { bakuDateString } from "./utils";

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
  { command: "komek", description: "Əmrlərin izahı" },
  { command: "id", description: "Telegram ID-nizi göstərir" },
];

function userLabel(u: TgUser): string {
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || "İşçi";
  return `tg:${u.id} ${name}${u.username ? ` (@${u.username})` : ""}`;
}

function isAdmin(u: TgUser | undefined): boolean {
  return !!u && adminIdsFromEnv().has(String(u.id));
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

async function handleCallback(cq: TgCallbackQuery, cfg: TelegramConfig): Promise<void> {
  if (!isAdmin(cq.from)) {
    await answerCallbackQuery(cfg, cq.id, "Bu əməliyyat üçün icazəniz yoxdur.", true);
    return;
  }

  const [action, reservationId] = (cq.data ?? "").split(":");
  if ((action !== "confirm" && action !== "decline") || !reservationId) {
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
    if (!msg) return;
    // "message is not modified" kimi xətalar qərarı pozmur
    await editMessageText(
      cfg,
      msg.chat.id,
      msg.message_id,
      decidedReservationHtml(r, r.status, r.decidedBy)
    ).catch((err) => console.warn("Mesaj redaktə olunmadı:", err));
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

  if (!isAdmin(msg.from)) {
    // Naməlum istifadəçilərə yalnız /start-a cavab veririk ki, bot "susmuş" görünməsin
    if (cmd === "start") {
      await reply("Bu bot yalnız Ajoure işçiləri üçündür. /id ilə ID-nizi öyrənib administratora göndərin.");
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
    .where("status", "in", ["pending", "confirmed"])
    .where("date", ">=", dates[0])
    .where("date", "<=", dates[dates.length - 1])
    .get();
  const dateSet = new Set(dates);
  return snap.docs
    .map((d) => d.data() as ReservationDoc)
    .filter((r) => dateSet.has(r.date) && (times === null || times.includes(r.time)))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    .map(
      (r) =>
        `• ${dateLabel(r.date)} ${r.time} — ${escapeHtml(`${r.firstName} ${r.lastName}`)} ` +
        `(${r.status === "confirmed" ? "təsdiqlənib" : "gözləmədə"})`
    );
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
