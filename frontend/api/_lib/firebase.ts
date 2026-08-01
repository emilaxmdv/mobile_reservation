import { cert, getApps, initializeApp, ServiceAccount } from "firebase-admin/app";
import { Firestore, getFirestore } from "firebase-admin/firestore";
import { requireEnv } from "./env";

let cachedDb: Firestore | null = null;

/**
 * FIREBASE_SERVICE_ACCOUNT_KEY iki formatda qəbul olunur:
 *  - birbaşa JSON string ({"type":"service_account",...})
 *  - base64 kodlanmış JSON (Vercel env-də çoxsətirli dəyərlərlə problem olmasın deyə)
 */
function parseServiceAccount(raw: string): ServiceAccount {
  const trimmed = raw.trim();
  const json = trimmed.startsWith("{")
    ? trimmed
    : Buffer.from(trimmed, "base64").toString("utf8");
  return JSON.parse(json) as ServiceAccount;
}

/**
 * Firebase Admin SDK ilə Firestore bağlantısı. Admin SDK Security Rules-a tabe
 * deyil — client-in tam bağlı olduğu bazaya yalnız server tərəf daxil olur.
 * Serverless mühitdə isti (warm) çağırışlar arasında bağlantı yenidən istifadə
 * olunur, ona görə init yalnız bir dəfə aparılır.
 */
export function getDb(): Firestore {
  if (cachedDb) return cachedDb;
  if (getApps().length === 0) {
    initializeApp({
      credential: cert(parseServiceAccount(requireEnv("FIREBASE_SERVICE_ACCOUNT_KEY"))),
    });
  }
  cachedDb = getFirestore();
  return cachedDb;
}
