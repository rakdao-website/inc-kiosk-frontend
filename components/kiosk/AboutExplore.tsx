"use client";

/* -------------------------------------------------------------------------
   Explore: what Innovation City is and what it offers. Information only
   (booking lives in the services, locations in Find a place).

   Tabs: About us · Offices · Amenities & hours · Coming soon

   Live from the backend knowledge base (backend/knowledge_base.md, the same
   text Sky uses, via GET /voice-agent/knowledge-base):
     - office availability per floor ("Ground Floor: 1 office available (out of 19)")
     - common area capacity ("Common Area: comfortably fits up to 25 people")
     - working hours (the "## Working Hours" list)
   Edit those lines in knowledge_base.md and this screen follows. The rest
   of the wording is written from the knowledge base and
   room_question_service.py (office contents); edit it below.
   ------------------------------------------------------------------------- */

import { useEffect, useState, type ComponentType } from "react";
import { ArrowRight, Clock3 } from "lucide-react";
import { formatClock, localDigits, useLang } from "./i18n";
import { PhotoImg, ROOM_PHOTOS } from "./RoomPhoto";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

type Tab = "about" | "offices" | "amenities" | "soon";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "about", label: "About us" },
  { id: "offices", label: "Offices" },
  { id: "amenities", label: "Amenities & hours" },
  { id: "soon", label: "Coming soon" },
];

/* ---------------- live facts from the knowledge base ---------------- */

type Facts = {
  offices: Array<{ floor: string; free: number; total: number }>;
  commonArea: number | null;
  hours: Array<{ days: string; ranges: Array<[string, string]> }>;
};

/** "8:00 AM" -> "08:00" */
function to24(clock: string): string {
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(clock);
  if (!m) return clock;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

export function parseKnowledgeBase(text: string): Facts {
  const offices = Array.from(text.matchAll(/^\s*-\s*([^:\n]+?):\s*(\d+)\s+offices?\s+available\s*\(out of\s*(\d+)\)/gim)).map((m) => ({
    floor: m[1].trim(),
    free: Number(m[2]),
    total: Number(m[3]),
  }));
  const common = /common area[^\n]*?up to\s+(\d+)\s+people/i.exec(text);
  const hoursBlock = /##\s*Working Hours\s*\n([\s\S]*?)(?=\n##|$)/i.exec(text)?.[1] ?? "";
  const hours = Array.from(hoursBlock.matchAll(/^\s*-\s*([^:\n]+):\s*(.+)$/gm))
    .map((m) => ({
      days: m[1].trim(),
      ranges: Array.from(m[2].matchAll(/(\d{1,2}:\d{2}\s*[AP]M)\s*[-–]\s*(\d{1,2}:\d{2}\s*[AP]M)/gi)).map(
        (r) => [to24(r[1]), to24(r[2])] as [string, string],
      ),
    }))
    .filter((row) => row.ranges.length > 0);
  return { offices, commonArea: common ? Number(common[1]) : null, hours };
}

function useKnowledgeFacts(): Facts | null {
  const [facts, setFacts] = useState<Facts | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/voice-agent/knowledge-base`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data?.knowledge_base) setFacts(parseKnowledgeBase(String(data.knowledge_base)));
      })
      .catch(() => {
        // Unavailable: the screen just leaves out the live numbers.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return facts;
}

/* ---------------- icons (same line style as the kiosk's) ---------------- */

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg aria-hidden fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} viewBox="0 0 24 24">
      {children}
    </svg>
  );
}
const RegistryIcon = () => (
  <Svg>
    <rect height="18" rx="2.5" width="16" x="4" y="3" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </Svg>
);
const ChainIcon = () => (
  <Svg>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Svg>
);
const BankIcon = () => (
  <Svg>
    <path d="M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />
  </Svg>
);
const DeskIcon = () => (
  <Svg>
    <path d="M3 9h18M5 9v10M19 9v10M9 9v4h6V9" />
  </Svg>
);
const LockIcon = () => (
  <Svg>
    <rect height="9" rx="2" width="14" x="5" y="11" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Svg>
);
const BoxIcon = () => (
  <Svg>
    <path d="M3 8l9-5 9 5v8l-9 5-9-5z" />
    <path d="M3 8l9 5 9-5M12 13v8" />
  </Svg>
);
const PeopleIcon = () => (
  <Svg>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.5M17.5 13.5A5 5 0 0 1 20.5 19" />
  </Svg>
);
const WifiIcon = () => (
  <Svg>
    <path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0" />
    <circle cx="12" cy="19.5" r="1" />
  </Svg>
);
const MoonIcon = () => (
  <Svg>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
  </Svg>
);
const CupIcon = () => (
  <Svg>
    <path d="M5 8h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5zM17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 3v2M12 3v2" />
  </Svg>
);
const AccessIcon = () => (
  <Svg>
    <circle cx="12" cy="4.5" r="1.8" />
    <path d="M12 7.5v6h5l2 5M7.5 11.5a5.5 5.5 0 1 0 8.4 6.2" />
  </Svg>
);

function IconTile({ icon: Icon }: { icon: ComponentType }) {
  return (
    <span className="about-icon">
      <Icon />
    </span>
  );
}

/* ---------------- the screen ---------------- */

export function AboutExplore({ onContact }: { onContact: () => void }) {
  const { t, lang } = useLang();
  const [tab, setTab] = useState<Tab>("about");
  const facts = useKnowledgeFacts();

  return (
    <div className="about-wrap">
      <div className="about-tabs" role="tablist">
        {TABS.map((item) => (
          <button aria-selected={tab === item.id} className={tab === item.id ? "on" : ""} key={item.id} onClick={() => setTab(item.id)} role="tab" type="button">
            {t(item.label)}
          </button>
        ))}
      </div>

      <div className="about-panel" key={tab} role="tabpanel">
        {tab === "about" ? (
          <>
            <p className="about-lead">{t("Ras Al Khaimah's dedicated hub for innovation-driven businesses")}</p>
            <div className="about-vision">
              <small>{t("Our vision")}</small>
              <p>{t("To be a global tech hub and the region's most successful premium free zone")}</p>
            </div>
            <h3 className="about-h">{t("Why set up here")}</h3>
            <div className="about-grid three">
              {[
                { icon: RegistryIcon, title: "AI-powered registry", text: "Set up your company faster with smart registration" },
                { icon: ChainIcon, title: "On-chain licensing", text: "Secure, verifiable business licenses" },
                { icon: BankIcon, title: "Banking at the same time", text: "Open your bank account while you set up" },
              ].map((item) => (
                <div className="glass-card about-card" key={item.title}>
                  <IconTile icon={item.icon} />
                  <b>{t(item.title)}</b>
                  <span>{t(item.text)}</span>
                </div>
              ))}
            </div>
            <div className="about-grid two">
              <div className="glass-card about-card plain">
                <small>{t("Our mission")}</small>
                <span>{t("Attract thousands of startups and entrepreneurs, and keep a true startup culture")}</span>
              </div>
              <div className="glass-card about-card plain">
                <small>{t("Our values")}</small>
                <span>{t("Embrace the future, welcome global talent, and help them succeed")}</span>
              </div>
            </div>
            <button className="primary-btn about-cta" onClick={onContact} type="button">
              {t("Setup your company with us")}
              <ArrowRight aria-hidden className="about-cta-arrow" />
            </button>
          </>
        ) : null}

        {tab === "offices" ? (
          <>
            <p className="about-lead">{t("Private offices for teams, founders and Innovation City clients")}</p>
            {facts && facts.offices.length > 0 ? (
              <div className="about-grid two">
                {facts.offices.map((floor) => (
                  <div className="about-stat" key={floor.floor}>
                    <b>
                      {localDigits(lang, floor.free)}
                      <em> / {localDigits(lang, floor.total)}</em>
                    </b>
                    <span>{t("available on the {floor}", { floor: t(floor.floor) })}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <h3 className="about-h">{t("Every office includes")}</h3>
            <div className="glass-card about-list">
              {[
                { icon: DeskIcon, text: "4 work tables and chairs" },
                { icon: LockIcon, text: "A movable drawer with a key, with storage underneath" },
                { icon: BoxIcon, text: "A shared table for storage" },
              ].map((item) => (
                <div key={item.text}>
                  <IconTile icon={item.icon} />
                  <span>{t(item.text)}</span>
                </div>
              ))}
            </div>
            <p className="about-note">
              {t("Each office is leased to a different company, so furnishings can vary slightly. Ask the front desk about a specific office.")}
            </p>
            {facts?.commonArea ? (
              <div className="glass-card about-row-card">
                <IconTile icon={PeopleIcon} />
                <span>
                  <b>{t("Common area")}</b>
                  {t("Comfortably fits up to {n} people", { n: facts.commonArea })}
                </span>
              </div>
            ) : null}
            <button className="primary-btn about-cta" onClick={onContact} type="button">
              {t("Ask about an office")}
              <ArrowRight aria-hidden className="about-cta-arrow" />
            </button>
          </>
        ) : null}

        {tab === "amenities" ? (
          <>
            {facts && facts.hours.length > 0 ? (
              <div className="glass-card about-hours">
                <h3 className="about-h">
                  <Clock3 aria-hidden />
                  {t("Working hours")}
                </h3>
                {facts.hours.map((row) => (
                  <div className="about-hours-row" key={row.days}>
                    <span>{t(row.days)}</span>
                    <b>
                      {row.ranges
                        .map(([from, to]) => `${formatClock(lang, from)} – ${formatClock(lang, to)}`)
                        .join(lang === "ar" ? " و " : " and ")}
                    </b>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="about-grid two">
              {[
                { icon: WifiIcon, title: "Free Wi-Fi", text: "Ask reception for the password" },
                { icon: MoonIcon, title: "Prayer rooms", text: "On Floor R, via the dedicated elevators. Reception can show you the way" },
                { icon: CupIcon, title: "Cafeteria", text: "On Floor R" },
                { icon: AccessIcon, title: "Fully accessible", text: "Innovation City is fully wheelchair accessible" },
              ].map((item) => (
                <div className="glass-card about-card" key={item.title}>
                  <IconTile icon={item.icon} />
                  <b>{t(item.title)}</b>
                  <span>{t(item.text)}</span>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {tab === "soon" ? (
          <>
            <p className="about-lead">{t("Two new studios for creators are launching soon")}</p>
            <div className="about-grid two">
              {[
                { photo: ROOM_PHOTOS.podcast_studio, title: "Podcast Studio", text: "Record interviews, founder stories and long-form audio" },
                { photo: ROOM_PHOTOS.tiktok_studio, title: "TikTok Studio", text: "Create short-form content and ads for social media" },
              ].map((item) => (
                <div className="glass-card about-soon" key={item.title}>
                  <span className="about-soon-photo">
                    <PhotoImg alt="" aria-hidden className="room-photo-fill" src={item.photo} />
                    <PhotoImg alt={t(item.title)} className="room-photo-img" src={item.photo} />
                  </span>
                  <b>{t(item.title)}</b>
                  <span>{t(item.text)}</span>
                </div>
              ))}
            </div>
            <div className="about-vision promo">
              <small>{t("Launch offer")}</small>
              <p>{t("Free for Innovation City customers for a limited time after launch")}</p>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}