import { FormEvent, useMemo, useState } from "react";
import { SERVICES, TIME_SLOTS } from "../constants";
import { createReservation } from "../lib/api";
import type { ReservationInput } from "../types";

interface Props {
  onSuccess: (reservation: ReservationInput) => void;
}

/** Bu günün tarixi "YYYY-MM-DD" formatında (date input-un min dəyəri üçün). */
function todayString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function ReservationForm({ onSuccess }: Props) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [service, setService] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = useMemo(todayString, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // Yüngül client-side yoxlama — əsl validasiya server tərəfdədir
    if (!firstName.trim() || !lastName.trim()) {
      setError("Ad və soyad boş ola bilməz.");
      return;
    }
    if (!/^\+?[\d\s()-]{9,20}$/.test(phone.trim())) {
      setError("Telefon nömrəsi düzgün deyil. Nümunə: +994 50 123 45 67");
      return;
    }
    if (!service) {
      setError("Zəhmət olmasa xidmət seçin.");
      return;
    }
    if (!date || !time) {
      setError("Zəhmət olmasa tarix və saat seçin.");
      return;
    }

    const input: ReservationInput = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone.trim(),
      service,
      date,
      time,
      ...(birthDate ? { birthDate } : {}),
    };

    setSubmitting(true);
    try {
      await createReservation(input);
      onSuccess(input);
    } catch (err) {
      // Server Azərbaycan dilində aydın mesajlar qaytarır — birbaşa göstəririk
      if (err instanceof Error && err.message) {
        setError(err.message);
      } else {
        setError("Xəta baş verdi. Zəhmət olmasa bir azdan yenidən cəhd edin.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <div className="field-row">
        <div className="field">
          <label htmlFor="firstName">Ad</label>
          <input
            id="firstName"
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Adınız"
            autoComplete="given-name"
            maxLength={50}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="lastName">Soyad</label>
          <input
            id="lastName"
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Soyadınız"
            autoComplete="family-name"
            maxLength={50}
            required
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="phone">Telefon (WhatsApp)</label>
        <input
          id="phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+994 50 123 45 67"
          autoComplete="tel"
          required
        />
        <p className="hint">Təsdiq bildirişi bu nömrəyə göndəriləcək.</p>
      </div>

      <div className="field">
        <label htmlFor="service">Xidmət</label>
        <select
          id="service"
          value={service}
          onChange={(e) => setService(e.target.value)}
          required
        >
          <option value="" disabled>
            Xidmət seçin…
          </option>
          {SERVICES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="date">Tarix</label>
        <input
          id="date"
          type="date"
          value={date}
          min={today}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </div>

      <div className="field">
        <label>Saat</label>
        <div className="slot-grid" role="radiogroup" aria-label="Saat seçimi">
          {TIME_SLOTS.map((slot) => (
            <button
              key={slot}
              type="button"
              role="radio"
              aria-checked={time === slot}
              className={`slot ${time === slot ? "slot-active" : ""}`}
              onClick={() => setTime(slot)}
            >
              {slot}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="birthDate">
          Doğum tarixi <span className="optional">(istəyə bağlı)</span>
        </label>
        <input
          id="birthDate"
          type="date"
          value={birthDate}
          max={today}
          onChange={(e) => setBirthDate(e.target.value)}
        />
        <p className="hint">Doğum günü sürprizlərimizdən yararlanmaq üçün.</p>
      </div>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <button className="submit" type="submit" disabled={submitting}>
        {submitting ? "Göndərilir…" : "Rezervasiya et"}
      </button>
    </form>
  );
}
