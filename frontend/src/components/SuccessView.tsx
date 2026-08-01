import type { ReservationInput } from "../types";

interface Props {
  reservation: ReservationInput;
  onReset: () => void;
}

/** "YYYY-MM-DD" → "DD.MM.YYYY" */
function formatDateAz(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}.${m}.${y}`;
}

export default function SuccessView({ reservation, onReset }: Props) {
  return (
    <div className="success">
      <div className="success-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" width="28" height="28">
          <path
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <h2 className="success-title">Sorğunuz qəbul edildi</h2>
      <p className="success-text">
        Rezervasiyanız mütəxəssisimizə göndərildi. Təsdiq və ya dəyişiklik
        barədə nəticə sizə <strong>WhatsApp</strong> vasitəsilə bildiriləcək.
      </p>

      <dl className="summary">
        <div className="summary-row">
          <dt>Müştəri</dt>
          <dd>
            {reservation.firstName} {reservation.lastName}
          </dd>
        </div>
        <div className="summary-row">
          <dt>Xidmət</dt>
          <dd>{reservation.service}</dd>
        </div>
        <div className="summary-row">
          <dt>Tarix</dt>
          <dd>
            {formatDateAz(reservation.date)} · {reservation.time}
          </dd>
        </div>
        <div className="summary-row">
          <dt>Telefon</dt>
          <dd>{reservation.phone}</dd>
        </div>
      </dl>

      <button className="submit secondary" type="button" onClick={onReset}>
        Yeni rezervasiya
      </button>
    </div>
  );
}
