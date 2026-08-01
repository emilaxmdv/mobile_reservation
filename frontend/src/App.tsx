import { useEffect, useState } from "react";
import ReservationForm from "./components/ReservationForm";
import SuccessView from "./components/SuccessView";
import { fetchTotalReservations } from "./lib/api";
import type { ReservationInput } from "./types";

export default function App() {
  const [submitted, setSubmitted] = useState<ReservationInput | null>(null);
  const [totalReservations, setTotalReservations] = useState<number | null>(
    null
  );

  useEffect(() => {
    fetchTotalReservations().then(setTotalReservations);
  }, []);

  return (
    <div className="page">
      <header className="header">
        <p className="eyebrow">Onlayn rezervasiya</p>
        <h1 className="title">Vaxtınızı ayırın</h1>
        <p className="subtitle">
          Formu doldurun — rezervasiyanız mütəxəssisimiz tərəfindən yoxlanılır
          və nəticə sizə WhatsApp vasitəsilə bildirilir.
        </p>
      </header>

      <main className="card">
        {submitted ? (
          <SuccessView
            reservation={submitted}
            onReset={() => setSubmitted(null)}
          />
        ) : (
          <ReservationForm onSuccess={setSubmitted} />
        )}
      </main>

      <footer className="footer">
        {totalReservations !== null && totalReservations > 0 && (
          <p className="footer-stat">
            İndiyədək <strong>{totalReservations}</strong> nəfər rezervasiya
            edib
          </p>
        )}
        <p className="footer-note">
          Təsdiq bildirişi WhatsApp ilə göndərilir · Məlumatlarınız üçüncü
          tərəflə paylaşılmır
        </p>
      </footer>
    </div>
  );
}
