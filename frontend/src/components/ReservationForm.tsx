import { FormEvent, useEffect, useMemo, useState } from "react";
import { SERVICES, TIME_SLOTS } from "../constants";
import { createReservation, fetchAvailability } from "../lib/api";
import { bakuNowTime, bakuToday, daysInMonth, isoDate } from "../lib/dates";
import type { Availability, ReservationInput } from "../types";
import DatePicker, { DayState, YearMonth } from "./DatePicker";

interface Props {
  onSuccess: (reservation: ReservationInput) => void;
}

const monthKeyOf = (date: string) => date.slice(0, 7);

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

  const today = useMemo(bakuToday, []);
  const [month, setMonth] = useState<YearMonth>(() => {
    const [y, m] = today.split("-").map(Number);
    return { y, m };
  });
  // "YYYY-MM" → həmin ayın dolu/bağlı vaxtları
  const [availability, setAvailability] = useState<Record<string, Availability>>({});
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    const monthStart = isoDate(month.y, month.m, 1);
    const from = monthStart < today ? today : monthStart;
    const to = isoDate(month.y, month.m, daysInMonth(month.y, month.m));
    let cancelled = false;
    setLoadingMonth(true);
    fetchAvailability(from, to).then((a) => {
      if (cancelled) return;
      setLoadingMonth(false);
      if (a) setAvailability((prev) => ({ ...prev, [monthKeyOf(monthStart)]: a }));
    });
    return () => {
      cancelled = true;
    };
  }, [month, today, reloadTick]);

  const nowTime = bakuNowTime();

  const slotUnavailable = (d: string, slot: string): boolean => {
    if (d === today && slot <= nowTime) return true;
    return availability[monthKeyOf(d)]?.takenSlots[d]?.includes(slot) ?? false;
  };

  const dayState = (d: string): DayState => {
    if (d < today) return "past";
    if (availability[monthKeyOf(d)]?.closedDays.includes(d)) return "closed";
    if (TIME_SLOTS.every((s) => slotUnavailable(d, s))) return "full";
    return "available";
  };

  // Seçilmiş gün/saat sonradan dolu çıxsa (yeni məlumat gəldi) seçimi təmizlə
  useEffect(() => {
    if (date && dayState(date) !== "available") {
      setDate("");
      setTime("");
    } else if (date && time && slotUnavailable(date, time)) {
      setTime("");
    }
  }, [availability]);

  function selectDate(d: string) {
    setDate(d);
    if (time && slotUnavailable(d, time)) setTime("");
  }

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
      // Bu arada vaxt tutulmuş ola bilər — təqvimi yenilə
      setReloadTick((t) => t + 1);
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
        <label htmlFor="phone">Telefon</label>
        <input
          id="phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+994 50 123 45 67"
          autoComplete="tel"
          required
        />
        <p className="hint">Bu nömrə ilə sizinlə əlaqə saxlanılacaq.</p>
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
        <label>Tarix</label>
        <DatePicker
          value={date}
          onChange={selectDate}
          today={today}
          month={month}
          onMonthChange={setMonth}
          dayState={dayState}
          loading={loadingMonth}
        />
      </div>

      <div className="field">
        <label>Saat</label>
        {!date && <p className="hint">Əvvəlcə tarix seçin.</p>}
        <div className="slot-grid" role="radiogroup" aria-label="Saat seçimi">
          {TIME_SLOTS.map((slot) => {
            const unavailable = !date || slotUnavailable(date, slot);
            return (
              <button
                key={slot}
                type="button"
                role="radio"
                aria-checked={time === slot}
                disabled={unavailable}
                aria-label={date && unavailable ? `${slot} — dolu` : slot}
                className={`slot ${time === slot ? "slot-active" : ""} ${date && unavailable ? "slot-taken" : ""}`}
                onClick={() => setTime(slot)}
              >
                {slot}
              </button>
            );
          })}
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
