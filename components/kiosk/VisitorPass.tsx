"use client";

import { Check } from "lucide-react";
import { MARK_SRC, WORDMARK_SRC } from "./Brand";
import { PhotoImg } from "./RoomPhoto";
import { useLang } from "./i18n";

export type VisitorPassDetails = {
  /** "Booking confirmed" / "Registered for event" */
  status: string;
  name: string;
  placeLabel: string; // "Room" or "Event"
  place: string;
  date: string;
  time: string;
  /** Smaller line under the time (duration, or the event's location). */
  timeDetail?: string;
  /** One line of what to do next. */
  note: string;
  /** Room photo shown under the header (bookings). */
  photo?: string;
};

/**
 * Branded pass shown when a booking or event registration is confirmed.
 * Brand-gradient header with the logo, the visit details, a ticket-style
 * perforation, and a next-step note. Room for a QR code is left in the
 * footer layout for later (see .pass-foot in globals.css).
 */
export function VisitorPass({ pass }: { pass: VisitorPassDetails }) {
  const { t } = useLang();
  return (
    <article className="visitor-pass" aria-label={`Visitor pass: ${pass.status}`}>
      <header className="pass-head">
        <span className="pass-brand">
          <img alt="" className="pass-mark" src={MARK_SRC} />
          <img alt="Innovation City" className="pass-wordmark" src={WORDMARK_SRC} />
        </span>
        <span className="pass-kind">{t("Visitor pass")}</span>
      </header>

      {pass.photo ? (
        <div className="pass-photo">
          <PhotoImg alt="" aria-hidden className="room-photo-fill" src={pass.photo} />
          <PhotoImg alt={pass.place} className="room-photo-img" src={pass.photo} />
        </div>
      ) : null}

      <div className="pass-status">
        <span className="pass-check">
          <Check aria-hidden />
        </span>
        {pass.status}
      </div>

      <dl className="pass-grid">
        <div>
          <dt>{t("Name")}</dt>
          <dd>{pass.name}</dd>
        </div>
        <div>
          <dt>{pass.placeLabel}</dt>
          <dd>{t(pass.place)}</dd>
        </div>
        <div>
          <dt>{t("Date")}</dt>
          <dd>{pass.date}</dd>
        </div>
        <div>
          <dt>{t("Time")}</dt>
          <dd>
            {pass.time}
            {pass.timeDetail ? <small>{t(pass.timeDetail)}</small> : null}
          </dd>
        </div>
      </dl>

      <div aria-hidden className="pass-cut" />

      <footer className="pass-foot">
        <p>{pass.note}</p>
      </footer>
    </article>
  );
}