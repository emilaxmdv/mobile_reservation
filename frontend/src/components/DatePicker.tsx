import {
  daysInMonth,
  isoDate,
  mondayIndexOfFirst,
  MONTHS_AZ,
  WEEKDAYS_SHORT_AZ,
} from "../lib/dates";

export type DayState = "available" | "past" | "closed" | "full";

export interface YearMonth {
  y: number;
  m: number; // 1–12
}

interface Props {
  value: string;
  onChange: (date: string) => void;
  today: string;
  month: YearMonth;
  onMonthChange: (month: YearMonth) => void;
  dayState: (date: string) => DayState;
  loading: boolean;
}

const STATE_TITLE: Record<DayState, string | undefined> = {
  available: undefined,
  past: undefined,
  closed: "Qeyri-iş günü",
  full: "Bütün saatlar doludur",
};

export default function DatePicker({
  value,
  onChange,
  today,
  month,
  onMonthChange,
  dayState,
  loading,
}: Props) {
  const { y, m } = month;
  const [ty, tm] = today.split("-").map(Number);
  const canGoBack = y > ty || (y === ty && m > tm);

  const shift = (delta: number) => {
    const idx = y * 12 + (m - 1) + delta;
    onMonthChange({ y: Math.floor(idx / 12), m: (idx % 12) + 1 });
  };

  const cells: Array<string | null> = [
    ...Array<null>(mondayIndexOfFirst(y, m)).fill(null),
    ...Array.from({ length: daysInMonth(y, m) }, (_, i) => isoDate(y, m, i + 1)),
  ];

  return (
    <div className={`calendar ${loading ? "calendar-loading" : ""}`}>
      <div className="calendar-head">
        <button
          type="button"
          className="calendar-nav"
          onClick={() => shift(-1)}
          disabled={!canGoBack}
          aria-label="Əvvəlki ay"
        >
          ‹
        </button>
        <span className="calendar-title">
          {MONTHS_AZ[m - 1]} {y}
        </span>
        <button
          type="button"
          className="calendar-nav"
          onClick={() => shift(1)}
          aria-label="Növbəti ay"
        >
          ›
        </button>
      </div>

      <div className="calendar-grid" role="grid">
        {WEEKDAYS_SHORT_AZ.map((w) => (
          <span key={w} className="calendar-weekday">
            {w}
          </span>
        ))}
        {cells.map((date, i) => {
          if (!date) return <span key={`e${i}`} />;
          const state = dayState(date);
          const classes = [
            "calendar-day",
            `calendar-day-${state}`,
            date === value ? "calendar-day-selected" : "",
            date === today ? "calendar-day-today" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={date}
              type="button"
              className={classes}
              disabled={state !== "available"}
              onClick={() => onChange(date)}
              title={STATE_TITLE[state]}
              aria-pressed={date === value}
              aria-label={`${Number(date.slice(8))} ${MONTHS_AZ[m - 1]}${STATE_TITLE[state] ? ` — ${STATE_TITLE[state]}` : ""}`}
            >
              {Number(date.slice(8))}
            </button>
          );
        })}
      </div>

      <div className="calendar-legend">
        <span>
          <i className="legend-swatch legend-closed" /> Qeyri-iş günü
        </span>
        <span>
          <i className="legend-swatch legend-full" /> Dolu
        </span>
      </div>
    </div>
  );
}
