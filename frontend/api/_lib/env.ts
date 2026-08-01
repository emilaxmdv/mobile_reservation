/** Mühit dəyişənini oxu; yoxdursa aydın xəta ilə dayan. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Mühit dəyişəni çatışmır: ${name}. ` +
        `Vercel → Project Settings → Environment Variables bölməsində təyin edin ` +
        `(lokal üçün: frontend/.env, bax: .env.example).`
    );
  }
  return value;
}

/** Opsional mühit dəyişəni — boşdursa undefined qaytarır. */
export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}
