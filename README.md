# Ajoure Rezervasiya Sistemi (Telegram)

Müştəri Instagram bio-dakı linkə keçib formu doldurur → rezervasiya **pending** statusunda yaranır → Ajoure işçisinə Telegram-da **[✅ Təsdiq et] / [❌ Ləğv et]** düymələri olan mesaj gedir → işçi müştəri ilə **özü** (zəng / mesaj) əlaqə saxlayır və düyməni basır → təsdiqlənən saat saytda **dolu** görünür.

Müştəriyə avtomatik mesaj **getmir** — sayt yalnız "Sorğunuz qəbul edildi. Sizinlə əlaqə saxlanılacaq." göstərir.

İşçi Telegram-dan **bütün günü** (qeyri-iş günü) və ya **ayrı saatları** (məs. saytdan kənar gələn müştəri) bağlaya bilər — bağlı gün/saat saytda seçilmir. Artıq təsdiqlənmiş rezervasiyanı **🗑 Ləğv et** düyməsi ilə ləğv etmək olar — saat saytda yenidən boşalır.

İş saatları: **10:00 – 18:00** (sonuncu slot 18:00). Siyahı `frontend/api/_lib/constants.ts` və `frontend/src/constants.ts`-dədir (ikisi eyni saxlanmalıdır).

**Backend: Vercel Serverless API Routes.** Firebase yalnız Firestore kimi istifadə olunur — **pulsuz Spark planı kifayətdir**. Telegram Bot API pulsuzdur.

> Köhnə WhatsApp inteqrasiyası silinməyib: `legacy/whatsapp/` (build-ə düşmür). Tam köhnə vəziyyət: git tag `backup/pre-telegram-2026-11-09`.

## Arxitektura

```
Müştəri (brauzer)                Vercel                                    Telegram
┌────────────────┐ GET  /api/availability ┌───────────────────────┐
│ Vite + React   │ ─────────────────────▶ │ dolu saatlar +        │ ◀── Firestore
│ (təqvim)       │                        │ bağlı günlər          │
│                │ POST /api/create-…     ├───────────────────────┤    mesaj + düymələr  ┌───────┐
│                │ ─────────────────────▶ │ create-reservation    │ ───────────────────▶ │ İşçi  │
└────────────────┘                        └───────────────────────┘                      └───┬───┘
                                          ┌───────────────────────┐  düymə / /bagla /ac      │
                                          │ /api/telegram-webhook │ ◀────────────────────────┘
                                          │  confirmed/declined,  │
                                          │  blocks/{tarix}       │
                                          └───────────────────────┘
                                          ┌───────────────────────┐
                                          │ /api/birthday-check   │  Vercel Cron, hər gün 09:00 Bakı
                                          └───────────────────────┘  → Telegram xatırlatma
```

## Qovluq strukturu

```
├── frontend/                    # Vercel-ə deploy olunan yeganə layihə
│   ├── api/
│   │   ├── _lib/                # Ortaq kod ("_" prefiksli — endpoint deyil)
│   │   │   ├── telegram.ts      # Telegram Bot API klienti
│   │   │   ├── bot.ts           # Düymələr (təsdiq/ləğv) və /bagla, /ac, /baglilar, /gun, /id əmrləri
│   │   │   ├── blocks.ts        # Gün/saat bloklama məntiqi (Firestore-suz)
│   │   │   ├── messages.ts      # Telegram mesaj mətnləri
│   │   │   ├── firebase.ts, constants.ts, utils.ts, types.ts, env.ts
│   │   ├── create-reservation.ts
│   │   ├── availability.ts      # İctimai: yalnız tarix/saat, şəxsi məlumat yox
│   │   ├── telegram-webhook.ts
│   │   ├── telegram-setup.ts    # Webhook-u bir dəfə qeyd etmək üçün
│   │   ├── birthday-check.ts
│   │   └── stats.ts
│   ├── src/                     # React (DatePicker təqvimi, forma)
│   ├── vercel.json              # Cron + region
│   └── .env.example
├── legacy/whatsapp/             # Köhnə WhatsApp kodu (arxiv)
├── firestore.rules              # Client girişi TAM bağlı
├── firestore.indexes.json
└── firebase.json
```

## Firestore

| Kolleksiya | Nə saxlayır |
|---|---|
| `reservations/{auto-id}` | Rezervasiyalar (`status`: pending / confirmed / declined / cancelled — sonuncu təsdiqdən sonra ləğv edilmiş, `cancelledBy`, `cancelledAt` ilə). Telegram mesajı üçün `telegramChatId`, `telegramMessageId` əlavə olunur |
| `blocks/{YYYY-MM-DD}` | Bağlı gün/saatlar: `{ date, allDay, times[], reason, updatedBy, updatedAt }` |
| `publicStats/summary` | İctimai sayğac |

Saytda **dolu** görünən saat = təsdiqlənmiş (`confirmed`) rezervasiya **və ya** bağlanmış saat. Gözləmədə (`pending`) olan sorğu saatı tutmur.

## Təhlükəsizlik

| Prinsip | Necə |
|---|---|
| Frontend Firestore-a toxunmur | Bütün əməliyyatlar `/api/*` üzərindən, yalnız Admin SDK |
| Client girişi bağlı | `firestore.rules`: `allow read, write: if false;` |
| Webhook saxtakarlığı | Telegram hər sorğuda `X-Telegram-Bot-Api-Secret-Token` göndərir; `TELEGRAM_WEBHOOK_SECRET` ilə uyğun gəlməyən sorğu 401 alır |
| Kim düymə basa bilər | `TELEGRAM_CHAT_ID` qrupdursa — **həmin qrupun hər hazırkı üzvü** (bot `getChatMember` ilə yoxlayır; qrupdan çıxan icazəni dərhal itirir). Əlavə olaraq `TELEGRAM_ADMIN_IDS` siyahısındakılar. Başqaları üçün düymə xəbərdarlıq verir, əmrlər susur (`/id` istisna). Qrupu bağlı saxlayın: kimi əlavə etsəniz, onun səlahiyyəti olur |
| Şəxsi məlumat | `/api/availability` yalnız tarix və saat qaytarır — ad/telefon heç vaxt |
| Server-side validasiya | Keçmiş tarix, dolu/bağlı slot, yanlış telefon tranzaksiya daxilində rədd edilir |
| Sirlər | Vercel Environment Variables; `VITE_` prefiksi yoxdur, brauzerə düşmür |

---

## Quraşdırma

### 1. Telegram botu

1. Telegram-da **@BotFather** → `/newbot` → ad və username (məs. `AjoureRezervBot`) → **token** verilir. Bu, `TELEGRAM_BOT_TOKEN`-dir. Heç kimlə paylaşmayın.
2. Bildirişlər hara getsin?
   - **Bir işçi:** botu açıb **Start** basın.
   - **Bir neçə işçi:** Telegram qrupu yaradın, botu qrupa əlavə edin.
3. ID-ləri öyrənmək üçün addım 3-dən (deploy + webhook) sonra botda və ya qrupda `/id` yazın:
   - "Bu çatın ID-si" → `TELEGRAM_CHAT_ID` (qrupda mənfi rəqəm olur, məs. `-1001234567890`)
   - Qrup istifadə edirsinizsə, işçilərin ID-lərini yığmaq **lazım deyil** — qrup üzvü avtomatik icazəlidir. Yeni işçi = qrupa əlavə et.
   - `TELEGRAM_ADMIN_IDS` — qrupdan kənar da icazə lazım olanlar (məs. sahib), vergüllə: `123456,789012`

   > Adi qrup "supergroup"a çevrilsə (Telegram bəzi ayarlarda bunu avtomatik edir), qrupun ID-si dəyişir (`-100…`). Onda qrupda yenidən `/id` yazıb `TELEGRAM_CHAT_ID`-ni yeniləyin.

   ID-ləri Vercel-ə yazandan sonra **Redeploy** edin.

### 2. Vercel mühit dəyişənləri

**Project → Settings → Environment Variables** (`frontend/.env.example`-a baxın):

| Dəyişən | Məcburi | Qeyd |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT_KEY` | ✅ | Artıq var (dəyişmir) |
| `TELEGRAM_BOT_TOKEN` | ✅ | @BotFather-dən |
| `TELEGRAM_WEBHOOK_SECRET` | ✅ | Təsadüfi sətir, yalnız `A-Z a-z 0-9 _ -` |
| `TELEGRAM_CHAT_ID` | ✅ | `/id` ilə (qrupda mənfi rəqəm). Qrupun üzvləri avtomatik icazəlidir |
| `TELEGRAM_ADMIN_IDS` | — | Qrupdan kənar icazəli ID-lər, vergüllə |
| `TELEGRAM_OWNER_CHAT_ID` | — | Doğum günü xatırlatmaları ayrıca çata getsin deyə |
| `CRON_SECRET` | tövsiyə | Cron endpoint-ini qoruyur |

Köhnə `WHATSAPP_*`, `META_APP_SECRET`, `SPECIALIST_WHATSAPP_NUMBER`, `OWNER_WHATSAPP_NUMBER`, `BOOKING_LINK` dəyişənləri artıq istifadə olunmur — silmək olar.

### 3. Webhook-u qeyd etmək (bir dəfə)

Deploy-dan sonra brauzerdə açın:

```
https://<sizin-domen>/api/telegram-setup?secret=<TELEGRAM_WEBHOOK_SECRET>
```

Cavab `{"ok":true,"webhookUrl":"…"}` olmalıdır. Bu, webhook-u həmin domenə yönəldir və botun əmr menyusunu (`/bagla`, `/ac`, …) qeyd edir. Domen dəyişəndə təkrar açın.

> Firestore-da əl ilə heç nə etmək lazım deyil: `blocks` kolleksiyası ilk `/bagla`-da avtomatik yaranır, yeni sorğular yalnız `date` sahəsinin avtomatik indeksindən istifadə edir.

---

## Telegram əmrləri

| Əmr | Nə edir |
|---|---|
| `/bagla 15.11` | Bütün günü bağlayır (qeyri-iş günü) |
| `/bagla 15.11 14:00` | Bir saatı bağlayır |
| `/bagla 15.11 14:00 17:00` | Ayrı-ayrı saatlar (14:00 və 17:00) |
| `/bagla 15.11 14:00-16:00` | Saat aralığı (14:00, 15:00, 16:00) |
| `/bagla 15.11 20.11` | Gün aralığı (ən çox 62 gün) |
| `/bagla sabah 12:00 kənar müştəri` | Sonda səbəb yazmaq olar |
| `/ac …` | Eyni formatla açır. Bütün gün bağlıdırsa `/ac 15.11 14:00` yalnız 14:00-ı açır |
| `/baglilar` | Gələcək bağlı gün və saatlar |
| `/gun 15.11` | Həmin günün rezervasiyaları (✅ təsdiqlənmiş, ⏳ gözləmədə) və bağlı saatlar; təsdiqlənmişlər üçün 🗑 düymələri. Tarixsiz `/gun` — bu gün |
| `/id` | Telegram ID-ni göstərir (hamı üçün) |
| `/komek` | Əmrlərin izahı |

Tarix formatları: `15.11`, `15.11.2026`, `2026-11-15`, `bugun`, `sabah`. Saat: `14`, `14:00`, `14.00`.

Bağlanan vaxtda gözləmədə və ya təsdiqlənmiş rezervasiya varsa, bot xəbərdarlıq edir. Bağlı saatdakı sorğunu təsdiqləmək olmur (əvvəlcə `/ac`).

### Təsdiqlənmiş rezervasiyanı ləğv etmək

Təsdiqdən sonra bildiriş mesajında **🗑 Ləğv et** düyməsi qalır (köhnə mesajı tapmaq çətindirsə — `/gun 15.11`). Basanda bot ayrıca soruşur: **✅ Bəli, ləğv et / ↩️ Xeyr**. "Bəli"dən sonra status `cancelled` olur, ilk bildiriş mesajı "Təsdiqdən sonra ləğv edildi" kimi yenilənir və saat saytda yenidən boş görünür. Müştəriyə avtomatik heç nə getmir — onunla özünüz əlaqə saxlayın.

## Doğum günü xatırlatması

`/api/birthday-check` Vercel Cron ilə hər gün **09:00 Bakı vaxtı** çağırılır və 7 gün sonra doğum günü olan müştəriləri Telegram-a yazır (`TELEGRAM_OWNER_CHAT_ID` varsa ora, yoxdursa `TELEGRAM_CHAT_ID`-yə).

## Lokal inkişaf

```bash
cd frontend && npm install && npm run dev
```

Frontend + API (`.env` doldurulmalıdır):

```bash
cd frontend && cp .env.example .env && vercel dev
```

Telegram webhook-u lokal ünvana çata bilmir — botu test etmək üçün deploy olunmuş domen lazımdır.

## Test ssenarisi

1. Saytda rezervasiya edin → "Sorğunuz qəbul edildi. Sizinlə əlaqə saxlanılacaq."
2. Telegram-a düymələri olan mesaj gəlir → **Təsdiq et** → mesaj "✅ Təsdiqləndi — <ad>" olur.
3. Saytı yeniləyin (≤30 san keş) → həmin saat **dolu** görünür.
4. `/bagla <tarix>` → həmin gün təqvimdə qeyri-iş günü kimi görünür; `/ac <tarix>` → yenidən açılır.
5. `/bagla <tarix> 15:00` → yalnız 15:00 dolu görünür.

## Problemlərin həlli

| Simptom | Səbəb / Həll |
|---|---|
| Telegram-a mesaj gəlmir | Vercel logları → "İşçiyə Telegram bildirişi göndərilə bilmədi". `chat not found` → `TELEGRAM_CHAT_ID` yanlışdır və ya botda Start basılmayıb / bot qrupda deyil. `Unauthorized` → token yanlışdır |
| Düymələr "yüklənir" qalır | Webhook qeyd olunmayıb → addım 3 |
| Düymə "icazəniz yoxdur" deyir | Basan işçi bildiriş qrupunun üzvü deyil (və `TELEGRAM_ADMIN_IDS`-də də yoxdur) → qrupa əlavə edin |
| Əmrlərə cavab yoxdur | Eyni səbəb (admin deyil) və ya webhook qeyd olunmayıb |
| "Mühit dəyişəni çatışmır: …" | Env natamamdır; dəyişəndən sonra **yenidən deploy** lazımdır |
| Cron işləmir | Vercel → Settings → Cron Jobs; Hobby planda dəqiqlik ±1 saatdır |

## Xidmətlər və saat slotlarını dəyişmək

`frontend/src/constants.ts` **və** `frontend/api/_lib/constants.ts`-də `SERVICES` / `TIME_SLOTS`-u eyni cür dəyişin.
