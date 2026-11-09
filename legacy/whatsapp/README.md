# WhatsApp inteqrasiyası (arxiv)

Sistem Telegram-a keçəndə (2026-11) WhatsApp kodu silinmədi, bura köçürüldü.
Bu qovluq **build-ə düşmür** — Vercel yalnız `frontend/` qovluğunu deploy edir,
`frontend/api/` xaricindəki fayllar route olmur.

| Fayl | Nə idi |
|---|---|
| `whatsapp.ts` | WhatsApp Cloud API klienti (`frontend/api/_lib/whatsapp.ts` idi) |
| `whatsapp-webhook.ts` | Təsdiq/Ləğv düymələrinin webhook-u (`frontend/api/whatsapp-webhook.ts` idi) |
| `create-reservation.whatsapp.ts` | WhatsApp bildirişli köhnə `create-reservation.ts` |
| `birthday-check.whatsapp.ts` | WhatsApp-a xatırlatma göndərən köhnə `birthday-check.ts` |
| `env.example.whatsapp` | Köhnə `.env.example` (bütün `WHATSAPP_*` dəyişənləri) |
| `README.whatsapp.md` | Köhnə README (Meta quraşdırması, template-lər) |

## Geri qaytarmaq lazım olsa

1. `whatsapp.ts` → `frontend/api/_lib/`, `whatsapp-webhook.ts` → `frontend/api/` köçürün.
2. `_lib/constants.ts`-ə `export const GRAPH_API_VERSION = "v23.0";` əlavə edin.
3. Mesaj göndərmə hissələrini `create-reservation.whatsapp.ts` və
   `birthday-check.whatsapp.ts`-dən götürün.
4. `env.example.whatsapp`-dakı dəyişənləri Vercel-də təyin edin.

Tam köhnə vəziyyət git-də də var: tag `backup/pre-telegram-2026-11-09`.
