"use client";

import { ChevronDown, ChevronUp } from "lucide-react";

/* -------------------------------------------------------------------------
   Touch-friendly date and time pickers for the kiosk.

   Both are driven by a list of *allowed* values worked out by the page
   (dates that still have free times, and start times inside opening hours
   that haven't passed and still fit a duration). Every column only steps
   through values that exist in that list, so the visitor can freely pick
   day / month / year or hour / minute / AM-PM without ever landing on a
   time the booking would reject.
   ------------------------------------------------------------------------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function uniq<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

/** Next/previous item in `list` after `current`, wrapping around. */
function step<T>(list: T[], current: T | undefined, direction: 1 | -1): T | undefined {
  if (list.length === 0) return undefined;
  const index = current === undefined ? -1 : list.indexOf(current);
  if (index === -1) return direction === 1 ? list[0] : list[list.length - 1];
  return list[(index + direction + list.length) % list.length];
}

function Column({
  label,
  display,
  onUp,
  onDown,
  disabled,
  wide = false,
}: {
  label: string;
  display: string;
  onUp: () => void;
  onDown: () => void;
  disabled?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "dt-col wide" : "dt-col"} role="group" aria-label={label}>
      <span className="dt-col-label">{label}</span>
      <button aria-label={`Next ${label.toLowerCase()}`} className="dt-step" disabled={disabled} onClick={onUp} type="button">
        <ChevronUp aria-hidden />
      </button>
      <span aria-live="polite" className={display === "--" ? "dt-value empty" : "dt-value"}>
        {display}
      </span>
      <button aria-label={`Previous ${label.toLowerCase()}`} className="dt-step" disabled={disabled} onClick={onDown} type="button">
        <ChevronDown aria-hidden />
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- date */

export function DatePicker({
  label = "Date",
  value,
  validDates,
  onChange,
}: {
  label?: string;
  /** YYYY-MM-DD */
  value: string;
  /** Sorted YYYY-MM-DD values that can be booked. */
  validDates: string[];
  onChange: (value: string) => void;
}) {
  const parts = validDates.map((date) => {
    const [y, m, d] = date.split("-").map(Number);
    return { date, y, m, d };
  });
  const current = parts.find((part) => part.date === value);

  const years = uniq(parts.map((p) => p.y));
  const monthsIn = (y: number) => uniq(parts.filter((p) => p.y === y).map((p) => p.m));
  const daysIn = (y: number, m: number) => parts.filter((p) => p.y === y && p.m === m).map((p) => p.d);

  // Keep the day (or the closest one after it) when month/year changes.
  function pick(y: number, m: number, preferredDay: number) {
    const days = daysIn(y, m);
    const day = days.find((d) => d >= preferredDay) ?? days[days.length - 1];
    onChange(`${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }

  function stepYear(direction: 1 | -1) {
    const y = step(years, current?.y, direction);
    if (y === undefined) return;
    const months = monthsIn(y);
    const m = current && months.includes(current.m) ? current.m : months[0];
    pick(y, m, current?.d ?? 1);
  }

  function stepMonth(direction: 1 | -1) {
    const y = current?.y ?? years[0];
    const m = step(monthsIn(y), current?.m, direction);
    if (m === undefined) return;
    pick(y, m, current?.d ?? 1);
  }

  function stepDay(direction: 1 | -1) {
    const y = current?.y ?? years[0];
    const m = current?.m ?? monthsIn(y)[0];
    const d = step(daysIn(y, m), current?.d, direction);
    if (d !== undefined) pick(y, m, d);
  }

  const summary = current
    ? new Date(Date.UTC(current.y, current.m - 1, current.d)).toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : "Choose a day";

  const none = validDates.length === 0;

  return (
    <div className="dt-field">
      <div className="dt-head">
        <span className="field-label">{label}</span>
        <span className="dt-summary">{none ? "No dates available right now." : summary}</span>
      </div>
      <div className="dt-box">
        <div className="dt-columns">
          <Column disabled={none} display={current ? String(current.d) : "--"} label="Day" onDown={() => stepDay(-1)} onUp={() => stepDay(1)} />
          <Column disabled={none} display={current ? MONTHS[current.m - 1] : "--"} label="Month" onDown={() => stepMonth(-1)} onUp={() => stepMonth(1)} />
          <Column disabled={none} display={current ? String(current.y) : "--"} label="Year" onDown={() => stepYear(-1)} onUp={() => stepYear(1)} wide />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- time */

type Period = "AM" | "PM";

function to12h(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return { value: hhmm, hour: h % 12 || 12, minute: m, period: (h < 12 ? "AM" : "PM") as Period };
}

export function TimePicker({
  label = "Time",
  value,
  validTimes,
  onChange,
  disabled = false,
}: {
  label?: string;
  /** HH:MM (24-hour), or "" when nothing is chosen yet. */
  value: string;
  /** Sorted HH:MM start times that can be booked on the chosen date. */
  validTimes: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const times = validTimes.map(to12h);
  const current = times.find((t) => t.value === value);
  const periods = uniq(times.map((t) => t.period));
  const activePeriod: Period | undefined = current?.period ?? periods[0];

  const hoursIn = (period: Period) => uniq(times.filter((t) => t.period === period).map((t) => t.hour));
  const minutesIn = (period: Period, hour: number) =>
    times.filter((t) => t.period === period && t.hour === hour).map((t) => t.minute);

  function pick(period: Period, hour: number, preferredMinute: number) {
    const minutes = minutesIn(period, hour);
    const minute = minutes.includes(preferredMinute) ? preferredMinute : minutes.find((m) => m >= preferredMinute) ?? minutes[0];
    const match = times.find((t) => t.period === period && t.hour === hour && t.minute === minute);
    if (match) onChange(match.value);
  }

  function stepHour(direction: 1 | -1) {
    if (!activePeriod) return;
    const hour = step(hoursIn(activePeriod), current?.hour, direction);
    if (hour !== undefined) pick(activePeriod, hour, current?.minute ?? 0);
  }

  function stepMinute(direction: 1 | -1) {
    if (!activePeriod) return;
    const hour = current?.hour ?? hoursIn(activePeriod)[0];
    const minute = step(minutesIn(activePeriod, hour), current?.minute, direction);
    if (minute !== undefined) pick(activePeriod, hour, minute);
  }

  function choosePeriod(period: Period) {
    const hours = hoursIn(period);
    if (hours.length === 0) return;
    const hour = current && hours.includes(current.hour) ? current.hour : hours[0];
    pick(period, hour, current?.minute ?? 0);
  }

  const none = validTimes.length === 0;
  const off = disabled || none;

  return (
    <div className="dt-field">
      <div className="dt-head">
        <span className="field-label">{label}</span>
        <span className="dt-summary">
          {disabled
            ? "Choose a day first"
            : none
              ? "No free times left on this day"
              : current
                ? `Starts at ${current.hour}:${String(current.minute).padStart(2, "0")} ${current.period}`
                : "Use the arrows to set a start time"}
        </span>
      </div>
      <div className={off ? "dt-box off" : "dt-box"}>
        <div className="dt-columns">
          <Column disabled={off} display={current ? String(current.hour) : "--"} label="Hour" onDown={() => stepHour(-1)} onUp={() => stepHour(1)} />
          <span aria-hidden className="dt-colon">:</span>
          <Column
            disabled={off}
            display={current ? String(current.minute).padStart(2, "0") : "--"}
            label="Minute"
            onDown={() => stepMinute(-1)}
            onUp={() => stepMinute(1)}
          />
          <div className="dt-period" role="radiogroup" aria-label="AM or PM">
            {(["AM", "PM"] as const).map((period) => (
              <button
                aria-checked={current?.period === period}
                className={current?.period === period ? "dt-period-btn active" : "dt-period-btn"}
                disabled={off || !periods.includes(period)}
                key={period}
                onClick={() => choosePeriod(period)}
                role="radio"
                type="button"
              >
                {period}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}