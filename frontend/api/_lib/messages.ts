// İşçiyə gedən Telegram mesajlarının mətnləri (HTML parse_mode).

import type { BlockState } from "./blocks";
import { escapeHtml } from "./telegram";
import type { ReservationDoc, ReservationStatus } from "./types";
import { formatDateAz, formatPhoneDisplay, weekdayAz } from "./utils";

type ReservationView = Pick<
  ReservationDoc,
  "firstName" | "lastName" | "phone" | "service" | "date" | "time" | "birthDate"
>;

export function dateLabel(iso: string): string {
  return `${formatDateAz(iso)} (${weekdayAz(iso)})`;
}

export function reservationHtml(r: ReservationView): string {
  const lines = [
    `📅 <b>${dateLabel(r.date)} · ${r.time}</b>`,
    `👤 ${escapeHtml(`${r.firstName} ${r.lastName}`)}`,
    `✨ ${escapeHtml(r.service)}`,
    `📞 ${formatPhoneDisplay(r.phone)}`,
  ];
  if (r.birthDate) lines.push(`🎂 ${formatDateAz(r.birthDate)}`);
  return lines.join("\n");
}

export function newReservationHtml(r: ReservationView): string {
  return `🆕 <b>Yeni rezervasiya</b>\n\n${reservationHtml(r)}\n\nMüştəri ilə əlaqə saxlayıb qərar verin.`;
}

const STATUS_HEAD: Record<ReservationStatus, string> = {
  pending: "⏳ <b>Gözləmədə</b>",
  confirmed: "✅ <b>Təsdiqləndi</b>",
  declined: "❌ <b>Ləğv edildi</b>",
  cancelled: "🗑 <b>Təsdiqdən sonra ləğv edildi</b>",
};

export function personLabel(by: string | null | undefined): string {
  return by ? escapeHtml(by.replace(/^tg:\d+\s*/, "")) : "";
}

export function decidedReservationHtml(
  r: ReservationView,
  status: ReservationStatus,
  by: string | null | undefined
): string {
  const who = personLabel(by);
  return `${STATUS_HEAD[status]}${who ? ` — ${who}` : ""}\n\n${reservationHtml(r)}`;
}

export function shortReservationLabel(r: Pick<ReservationDoc, "date" | "time" | "firstName" | "lastName">): string {
  return `${dateLabel(r.date)} ${r.time} — ${escapeHtml(`${r.firstName} ${r.lastName}`)}`;
}

export function blockStateLabel(state: BlockState | null): string {
  if (!state) return "açıq";
  return state.allDay ? "bütün gün bağlı" : `bağlı saatlar: ${state.times.join(", ")}`;
}

export const HELP_HTML = [
  "<b>Ajoure rezervasiya botu</b>",
  "",
  "Saytdan gələn hər rezervasiya bura düşür. <b>Təsdiq et</b> basanda həmin saat saytda dolu görünür.",
  "",
  "<b>Bağlamaq</b> (saytda seçilə bilməz):",
  "<code>/bagla 15.11</code> — bütün gün",
  "<code>/bagla 15.11 14:00</code> — bir saat",
  "<code>/bagla 15.11 14:00 17:00</code> — ayrı-ayrı saatlar (14:00 və 17:00)",
  "<code>/bagla 15.11 14:00-16:00</code> — saat aralığı (14:00, 15:00, 16:00)",
  "<code>/bagla 15.11 20.11</code> — gün aralığı",
  "<code>/bagla sabah 12:00 kənar müştəri</code> — sonda səbəb yazmaq olar",
  "",
  "<b>Açmaq</b> — eyni formatla:",
  "<code>/ac 15.11</code> · <code>/ac 15.11 14:00</code>",
  "",
  "<code>/baglilar</code> — gələcək bağlı gün və saatlar",
  "<code>/gun 15.11</code> — həmin günün rezervasiyaları (təsdiqlənmişləri buradan ləğv etmək olar)",
  "",
  "Təsdiqlənmiş rezervasiyanın mesajındakı <b>🗑 Ləğv et</b> düyməsi saatı saytda yenidən boşaldır.",
  "<code>/id</code> — Telegram ID-nizi göstərir",
  "",
  "Tarix formatları: <code>15.11</code>, <code>15.11.2026</code>, <code>2026-11-15</code>, <code>bugun</code>, <code>sabah</code>",
].join("\n");
