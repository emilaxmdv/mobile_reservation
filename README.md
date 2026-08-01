# WhatsApp-native Rezervasiya Sistemi

Mağaza üçün tam funksional rezervasiya sistemi: müştəri Instagram bio-dakı linkə keçib formu doldurur → rezervasiya **pending** statusunda yaranır → mütəxəssisə WhatsApp-da **[Təsdiq et] / [Ləğv et]** düymələri olan mesaj gedir → mütəxəssis düyməyə basır → müştəriyə nəticə WhatsApp-la bildirilir.

**Backend: Vercel Serverless API Routes.** Firebase yalnız Firestore (data anbarı) kimi istifadə olunur — heç bir Cloud Function yoxdur, ona görə **Blaze planına ehtiyac YOXDUR, pulsuz Spark planı kifayətdir**.

## Arxitektura

```
Müştəri (brauzer)                     Vercel                            WhatsApp Cloud API
┌─────────────────┐  POST /api/   ┌─────────────────────────┐
│  Vite + React    │ ────────────▶ │ create-reservation      │ ─── Admin SDK ──▶ Firestore (pending)
│  (statik sayt)   │               │  · validasiya           │
└─────────────────┘               │  · yazı + sayğac        │   button mesajı   ┌────────────┐
                                   │  · dərhal WhatsApp ─────┼─────────────────▶ │ Mütəxəssis │
                                   └─────────────────────────┘                   └─────┬──────┘
                                                                                       │ düymə basır
                                   ┌─────────────────────────┐    webhook POST         │
                                   │ /api/whatsapp-webhook   │ ◀──────────────────────-┘
                                   │  status: confirmed/     │   nəticə mesajı   ┌────────────┐
                                   │          declined       │ ────────────────▶ │  Müştəri   │
                                   └─────────────────────────┘                   └────────────┘

                                   ┌─────────────────────────┐
                                   │ /api/birthday-check     │  Vercel Cron, hər gün
                                   │                         │  09:00 Bakı (05:00 UTC) —
                                   └─────────────────────────┘  7 gün sonrakı doğum günləri
```

Köhnə Firebase Cloud Functions arxitekturasından fərqlər:

| Əvvəl (Cloud Functions) | İndi (Vercel API Routes) |
|---|---|
| `createReservation` HTTPS Callable | `POST /api/create-reservation` |
| `onReservationCreated` Firestore trigger | Trigger yoxdur — WhatsApp bildirişi create route-un özündə göndərilir |
| `whatsappWebhook` HTTPS function | `/api/whatsapp-webhook` (GET handshake + POST) |
| `dailyBirthdayCheck` (Cloud Scheduler) | `/api/birthday-check` + Vercel Cron (`vercel.json`) |
| Sirlər: Firebase Secret Manager | Sirlər: Vercel Environment Variables |
| Blaze planı məcburi | **Spark (pulsuz) kifayətdir** |
| Frontend: Firebase client SDK (callable + App Check) | Frontend: adi `fetch` — heç bir Firebase SDK daşımır |

## Qovluq strukturu

```
├── frontend/                    # Vercel-ə deploy olunan yeganə layihə
│   ├── api/                     # Vercel Serverless API Routes (TypeScript)
│   │   ├── _lib/                # Ortaq kod ("_" prefiksli — endpoint deyil)
│   │   │   ├── firebase.ts      # Admin SDK init (service account env-dən)
│   │   │   ├── whatsapp.ts      # WhatsApp Cloud API klienti
│   │   │   ├── constants.ts     # Xidmətlər / slotlar (src ilə sinxron)
│   │   │   ├── utils.ts, types.ts, env.ts
│   │   ├── create-reservation.ts
│   │   ├── whatsapp-webhook.ts
│   │   ├── birthday-check.ts
│   │   └── stats.ts             # İctimai sayğac (yalnız bir rəqəm)
│   ├── src/                     # React frontend
│   │   ├── components/          # ReservationForm, SuccessView
│   │   └── lib/api.ts           # fetch wrapper — Firebase SDK YOXDUR
│   ├── vercel.json              # Cron + region konfiqurasiyası
│   └── .env.example             # Bütün server env dəyişənləri
├── firestore.rules              # Client girişi TAM bağlı (dəyişməyib)
├── firestore.indexes.json
└── firebase.json                # Yalnız Firestore (functions bölməsi silinib)
```

## Təhlükəsizlik modeli

| Prinsip | Necə həyata keçirilib |
|---|---|
| Frontend Firestore-a birbaşa yazmır | Frontend-də ümumiyyətlə Firebase SDK yoxdur; bütün əməliyyatlar `/api/*` üzərindən, Firestore-a yalnız Admin SDK toxunur |
| Client girişi bağlıdır | `firestore.rules`: hər şeyə `allow read, write: if false;` (dəyişməyib) — Admin SDK rules-a tabe deyil |
| Server-side validasiya | `create-reservation`: boş ad/soyad, yanlış telefon, keçmiş tarix, dolu slot tranzaksiya daxilində rədd edilir |
| Proqnozlaşdırıla bilməyən ID-lər | Sənəd ID-ləri Firestore-un avtomatik ID-ləridir |
| İctimai sayğac təcrid olunub | `/api/stats` yalnız bir rəqəm qaytarır; müştəri məlumatları heç vaxt public deyil |
| Webhook saxtakarlığı | `META_APP_SECRET` təyin olunanda hər POST-un `X-Hub-Signature-256` imzası yoxlanılır; düymələr yalnız mütəxəssisin nömrəsindən qəbul edilir |
| Cron endpoint qorunması | `CRON_SECRET` təyin olunanda `/api/birthday-check` yalnız Vercel Cron çağırışlarını qəbul edir |
| Sirlər kodda deyil | Hamısı Vercel Environment Variables-da; `VITE_` prefiksi olmadığı üçün heç biri brauzer bundle-ına düşmür |

> Qeyd: Köhnə arxitekturadakı Firebase App Check (reCAPTCHA v3) Callable funksiyalara bağlı idi və refactor ilə çıxarıldı. Spam/bot qorunması lazım olsa: Vercel-in daxili DDoS qorunması standartdır; əlavə olaraq Vercel WAF/rate-limit qaydaları və ya server tərəfdə reCAPTCHA yoxlaması sonradan asanlıqla əlavə oluna bilər.

---

## Quraşdırma

### 0. Tələblər

- Node.js 20+ və npm
- Vercel CLI (istəyə bağlı, lokal test üçün): `npm install -g vercel`
- Firebase CLI (yalnız rules deploy üçün): `npm install -g firebase-tools`
- Meta Business hesabı (WhatsApp Business Cloud API üçün)

### 1. Firebase layihəsi (yalnız Firestore — Spark planı)

1. [Firebase Console](https://console.firebase.google.com) → **Add project**.
2. **Build → Firestore Database → Create database** → region (məs. `europe-west1`) → **Production mode**.
3. **Blaze-ə keçməyə ehtiyac yoxdur** — Spark qalır.
4. **Service account açarı**: ⚙️ **Project settings → Service accounts → Generate new private key** → JSON faylı endirilir. Bu faylı base64-ə çevirin (PowerShell):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("serviceAccountKey.json")) | Set-Clipboard
```

   Nəticə `FIREBASE_SERVICE_ACCOUNT_KEY` dəyəri olacaq. JSON faylını heç yerə commit ETMƏYİN və işiniz bitəndən sonra diskdən silin.
5. `.firebaserc`-də `YOUR_FIREBASE_PROJECT_ID`-ni öz layihə ID-nizlə əvəz edin, sonra rules + indekslər deploy edin:

```bash
firebase login
```

```bash
firebase deploy --only firestore
```

### 2. WhatsApp Business Cloud API (Meta)

1. [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create App** → tip: **Business**.
2. App-a **WhatsApp** məhsulunu əlavə edin. **API Setup** səhifəsində test nömrəsi və **Phone number ID** verilir — qeyd edin.
3. **Test rejimində** mesaj yalnız icazəli siyahıdakı nömrələrə gedir: API Setup → **To** hissəsində mütəxəssisin və test müştərinin nömrələrini əlavə edib SMS kodu ilə təsdiqləyin.
4. **Daimi access token** (24 saatlıq müvəqqəti token production-a yaramır):
   - [business.facebook.com](https://business.facebook.com) → **Settings → Business settings → Users → System users** → yeni System User (rol: Admin).
   - System User-ə app-ı **Add Assets** ilə bağlayın (full control).
   - **Generate New Token** → icazələr: `whatsapp_business_messaging`, `whatsapp_business_management` → müddət: **Never expires**. Bu, `WHATSAPP_TOKEN` olacaq.
5. **App Secret** (webhook imzası üçün): App Dashboard → **Settings → Basic → App secret** → `META_APP_SECRET`.
6. Production üçün öz biznes nömrənizi əlavə edib app-ı **Live mode**-a keçirin (biznes verifikasiyası tələb oluna bilər).

### 3. Vercel layihəsi və mühit dəyişənləri

1. Repo-nu GitHub-a push edin → Vercel-də **New Project** → repo seçin.
2. **Root Directory**: `frontend` (Framework: Vite avtomatik tanınır). `api/` qovluğu `frontend/` içindədir, ona görə serverless funksiyalar avtomatik götürülür.
3. **Project Settings → Environment Variables** — `frontend/.env.example`-dakı bütün dəyişənləri əlavə edin:
   - `FIREBASE_SERVICE_ACCOUNT_KEY` (addım 1.4-dəki base64)
   - `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` (özünüz uydurun)
   - `SPECIALIST_WHATSAPP_NUMBER`, `OWNER_WHATSAPP_NUMBER`, `BOOKING_LINK`
   - Tövsiyə: `META_APP_SECRET`, `CRON_SECRET`
4. **Deploy** — hər `git push` avtomatik deploy edir (və ya `vercel --prod`).
5. Çıxan linki Instagram bio-ya qoyun və `BOOKING_LINK` dəyişəninə də yazın.

> **Vercel Cron qeydi:** `frontend/vercel.json`-dakı `"0 5 * * *"` UTC ilədir = **09:00 Bakı vaxtı** (Bakı UTC+4, yay/qış saatı yoxdur). Pulsuz Hobby planında cron dəstəklənir (gündə 1 dəfə kifayətdir); işə düşmə dəqiqliyi bir saatlıq pəncərə daxilindədir — doğum günü xatırlatması üçün problem deyil.

### 4. Webhook-un Meta-ya bağlanması

1. App Dashboard → **WhatsApp → Configuration → Webhook** → **Edit**:
   - **Callback URL**: `https://<sizin-domen>.vercel.app/api/whatsapp-webhook`
   - **Verify token**: Vercel-də təyin etdiyiniz `WHATSAPP_WEBHOOK_VERIFY_TOKEN` dəyəri
   - **Verify and save** — route GET sorğusuna `hub.challenge` qaytararaq təsdiqləyəcək.
2. **Webhook fields** hissəsində **messages** sahəsinə **Subscribe** edin.

### 5. Lokal inkişaf

Yalnız frontend (API-siz, dizayn üzərində işləmək üçün):

```bash
cd frontend && npm install && npm run dev
```

Frontend + API birlikdə (`vercel dev` API route-ları da lokal işə salır):

```bash
cd frontend && cp .env.example .env && vercel dev
```

`.env`-i doldurmağı unutmayın. Webhook-u lokal test etmək üçün Meta-ya çatan public URL lazımdır — bunun üçün preview deploy istifadə etmək (`vercel`) ən sadə yoldur.

---

## WhatsApp template-ləri (VACİB — mesajın çatması üçün)

WhatsApp qaydası: biznes bir istifadəçiyə **sərbəst mətn** mesajını yalnız həmin istifadəçi son 24 saatda biznesə yazıbsa göndərə bilər (service window). Bizim axında:

- **Mütəxəssis** — düymələri alması üçün pəncərə açıq olmalıdır. Ən sadə həll: mütəxəssis biznes nömrəsinə hərdənbir istənilən mesaj yazsın (pəncərə hər mesajla 24 saat uzanır). Daimi həll: quick-reply düyməli təsdiqlənmiş template (webhook hər iki düymə formatını emal edir).
- **Müştəri** — o, biznesə heç vaxt yazmayıb (veb formu doldurub), ona görə təsdiq/ləğv bildirişinin çatması üçün Meta-da təsdiqlənmiş **utility** template mütləqdir.

Template yaratmaq: Meta Business → **WhatsApp Manager → Message templates → Create template** → kateqoriya: **Utility**, dil: **Azerbaijani**. Nümunələr:

**`reservation_confirmed`**:
```
Rezervasiyanız təsdiqləndi! Tarix: {{1}} {{2}}, Xidmət: {{3}}. Görüşərik!
```

**`reservation_declined`**:
```
Rezervasiya Ləğv Edildi
Tarix: {{1}} {{2}}
Müştəri: {{3}}
Xidmət: {{4}}

Rezervasiya ləğv edildi. Zəhmət olmasa başqa tarix seçin: {{5}}
```

Təsdiqlənəndən sonra adları Vercel env-də `WHATSAPP_CONFIRM_TEMPLATE` / `WHATSAPP_DECLINE_TEMPLATE` kimi yazın — sistem avtomatik template ilə göndərəcək. Boş qalsa sərbəst mətn cəhd edilir (yalnız açıq pəncərədə çatır — testlər üçün müştəri nömrəsindən biznes nömrəsinə bir mesaj yazmaq kifayətdir).

Qeyd: template mesajları conversation-based qiymətləndirmə ilə mesaj başına kiçik xərc yaradır (utility söhbətləri ən ucuz kateqoriyadır) — bu, Meta-nın xərcidir, Firebase/Vercel planlarına aidiyyəti yoxdur.

## Doğum günü xatırlatması

`/api/birthday-check` Vercel Cron ilə hər gün **09:00 Bakı vaxtı** çağırılır: düz 7 gün sonra doğum günü olan müştəriləri tapıb sahibin (təyin olunmayıbsa mütəxəssisin) nömrəsinə yazır:

> Xatırlatma: Ayan Məmmədova-nın doğum günü 07.08.2026-dir (7 gün qalıb).

Sorğu ucuzdur — rezervasiya yaradılarkən hesablanan `birthMonthDay` ("MM-DD") sahəsi üzrə bərabərlik sorğusu. Birbaşa müştəriyə avtomatik təbrik göndərmək istəsəniz, kod şərhində qeyd olunduğu kimi təsdiqlənmiş utility template + mesaj başına xərc lazımdır.

Cron-u əl ilə test etmək (CRON_SECRET təyin etmisinizsə):

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" https://<sizin-domen>.vercel.app/api/birthday-check
```

## Test ssenarisi

1. Saytı açın, formu doldurun (telefon: Meta test siyahısındakı nömrə) → "Sorğunuz qəbul edildi".
2. Mütəxəssisin WhatsApp-ına düymələri olan mesaj gəlməlidir (gəlmirsə: mütəxəssis əvvəlcə biznes nömrəsinə bir mesaj yazsın — 24 saat pəncərəsi).
3. **Təsdiq et** basın → müştəri nömrəsinə təsdiq mesajı gəlməlidir; Firestore-da status `confirmed`.
4. Eyni tarix+saat üçün ikinci rezervasiya cəhdi → "Seçdiyiniz tarix və saat artıq doludur".
5. **Ləğv et** ssenarisi → müştəriyə ləğv mesajı + yenidən-rezervasiya linki.

## Problemlərin həlli

| Simptom | Səbəb / Həll |
|---|---|
| Error 131030 | Alıcı nömrə test icazə siyahısında deyil → API Setup-da əlavə edin |
| Error 131047 | 24 saatlıq pəncərə bağlıdır → template istifadə edin (yuxarıdakı bölmə) |
| Error 190 | Access token bitib → daimi System User token yaradın (addım 2.4) |
| Webhook verify alınmır | Verify token uyğun gəlmir → Vercel env-dəki dəyərlə Meta-dakı eyni olmalıdır |
| Webhook 401 qaytarır | `META_APP_SECRET` yanlışdır → App Dashboard → Settings → Basic-dən yenidən köçürün |
| "Mühit dəyişəni çatışmır: ..." | Vercel Environment Variables natamamdır → `.env.example` ilə tutuşdurun; dəyişənləri əlavə edəndən sonra **yenidən deploy** lazımdır |
| `FIREBASE_SERVICE_ACCOUNT_KEY` parse xətası | Base64 tam köçürülməyib və ya JSON zədələnib → açarı yenidən çevirib köçürün |
| Cron işləmir | Vercel → Project → Settings → Cron Jobs bölməsində görünməlidir; Hobby planda dəqiqlik ±1 saatdır |
| Firestore sorğusu index xətası verir | `firebase deploy --only firestore` işlədin (indexes.json daxildir) |

## Xidmətlər və saat slotlarını dəyişmək

`frontend/src/constants.ts` **və** `frontend/api/_lib/constants.ts` fayllarında `SERVICES` / `TIME_SLOTS` siyahılarını eyni cür dəyişin (server son sözü deyir) — adi git push hər ikisini birlikdə deploy edir.
