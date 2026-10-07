"use client";

/* -------------------------------------------------------------------------
   Ground-floor map for the kiosk's "Find a place" screen.

   The floor plan, room artwork (meeting tables, event chairs, icons), room
   list, tenant names and walking routes are ported AS-IS from the live
   dashboard (inc-live-dashboard-screen-frontend/components/screen/
   ScreenDashboard.tsx), so both screens always show the same building. If
   the dashboard's map changes, copy the changed constants across.

   Live status comes from the same backend endpoint the dashboard uses
   (GET /api/zones), refreshed every 30 seconds.

   "You are here" + every route start at the dashboard screen's position
   (YOU_ARE_HERE). If the kiosk stands somewhere else, change YOU_ARE_HERE
   and the first point of each route.
   ------------------------------------------------------------------------- */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CalendarCheck, Navigation, Search, X } from "lucide-react";
import { PhotoImg, roomDescription, ROOM_FACTS, ROOM_PHOTOS } from "./RoomPhoto";
import { arabicFromFile, useLang } from "./i18n";

type ZoneStatus = "available" | "occupied" | "closed" | string;
export type Zone = {
  zone_id: string;
  zone_name: string;
  zone_type: string;
  is_bookable: boolean;
  is_closed: boolean;
  status: ZoneStatus;
  pulse?: boolean;
};

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ===================== ported from the dashboard (unchanged) =====================
type RoomTile = { id: string; x: number; y: number; w: number; h: number; label: string };

const SVG_W = 1408;
const SVG_H = 1244;
const YOU_ARE_HERE: [number, number] = [901, 645];
const ROUTE_DRAW_MS = 700;
const MAP_FULLSCREEN_IDLE_MS = 45000;
const VIEW_BOX = "73 187 1253 884";

// Coordinates ported from the actual <rect class="room-block"> shapes drawn in the
// reference floor plan (NOT its hand-typed room-metadata list, which the reference's
// own code notes is "10-50 units off" from the real walls). ROUTES below was authored
// against these exact wall positions, so the two must stay in sync.
const ROOM_TILES: RoomTile[] = [
  { id: "hive1", x: 83, y: 197, w: 193, h: 139, label: "Hive 1" },
  { id: "hive2", x: 83, y: 336, w: 193, h: 139, label: "Hive 2" },
  { id: "hive3", x: 83, y: 475, w: 193, h: 139, label: "Hive 3" },
  { id: "hive4", x: 83, y: 614, w: 193, h: 139, label: "Hive 4" },
  { id: "hive5", x: 83, y: 753, w: 193, h: 139, label: "Hive 5" },
  { id: "hive6", x: 83, y: 892, w: 193, h: 169, label: "Hive 6" },
  { id: "hive7", x: 276, y: 943, w: 119, h: 118, label: "Hive 7" },
  { id: "hive8", x: 395, y: 943, w: 119, h: 118, label: "Hive 8" },
  { id: "hive9", x: 514, y: 943, w: 119, h: 118, label: "Hive 9" },
  { id: "hive10", x: 633, y: 943, w: 117, h: 118, label: "Hive 10" },
  { id: "hive11", x: 553.32, y: 791, w: 114, h: 101, label: "Hive 11" },
  { id: "hive12", x: 553.32, y: 690, w: 114, h: 101, label: "Hive 12" },
  { id: "hive13", x: 557, y: 361, w: 114, h: 101, label: "Hive 13" },
  { id: "hive14", x: 442, y: 361, w: 115, h: 101, label: "Hive 14" },
  { id: "hive15", x: 327, y: 361, w: 115, h: 101, label: "Hive 15" },
  { id: "hive16", x: 327, y: 462, w: 114, h: 114, label: "Hive 16" },
  { id: "hive17", x: 327, y: 576, w: 114, h: 114, label: "Hive 17" },
  { id: "hive18", x: 327, y: 690, w: 114.8, h: 202, label: "Hive 18" },
  { id: "hive19", x: 441.8, y: 690, w: 111.52, h: 202, label: "Hive 19" },
  { id: "podcast", x: 276, y: 197, w: 109, h: 113, label: "Podcast Studio" },
  { id: "pantry", x: 385, y: 197, w: 109, h: 113, label: "Kitchen Closet" },
  { id: "bathroom", x: 494, y: 197, w: 100, h: 45, label: "W.C" },
  { id: "meetingroom1", x: 441, y: 576, w: 182, h: 114, label: "Meeting Room 1" },
  { id: "meetingroom2", x: 441, y: 462, w: 182, h: 114, label: "Meeting Room 2" },
  { id: "entrance", x: 785.1, y: 217, w: 172.8, h: 110, label: "Entrance" },
  { id: "reception", x: 785.1, y: 367.3, w: 172.8, h: 140.4, label: "Reception" },
  { id: "tiktokstudio", x: 1062, y: 360, w: 254, h: 450, label: "TikTok Studio" },
  { id: "eventarea", x: 800, y: 827, w: 516, h: 234, label: "Event Area" }
];

const ICON_ROOM: Record<string, "door" | "video" | "mic" | "kitchen" | "bath" | "rocket" | "reception" | "tiktok"> = {
  entrance: "door",
  podcast: "mic",
  pantry: "kitchen",
  bathroom: "bath",
  reception: "reception",
  tiktokstudio: "tiktok"
};

// Rooms with no occupancy concept of their own — the status dot doesn't apply to them.
const NO_STATUS_ROOM_IDS = new Set(["bathroom", "pantry", "reception", "entrance"]);

// Entrance is shown as a bare icon with no tile behind it. Reception now gets
// the same tile treatment as every other room.
const NO_TILE_ROOM_IDS = new Set(["entrance"]);

// Rooms shown as an icon only, no text label — the icon is sized up to fill the space instead.
const ICON_ONLY_ROOM_IDS = new Set(["bathroom", "entrance", "reception"]);

// Per-room icon size multiplier — the reception icon's own artwork (desk + speech
// bubble) is visually wider/denser than the other icon-only glyphs at the same scale.
const ICON_SIZE_SCALE: Record<string, number> = {
  // The supplied entrance artwork and reception icon render at the same visual width.
  reception: 0.485,
  entrance: 0.625,
  // Podcast/pantry now show a label below the icon too, which uses the smaller
  // "icon + label" base multiplier (0.4 instead of 0.68 for icon-only rooms) —
  // scaled up by the same 0.68/0.4 ratio so the icon itself stays the same
  // rendered size as before, with the label just added underneath it.
  podcast: 0.55 * (0.68 / 0.4),
  // Matched to podcast's rendered icon height — same tile size (109x113) but a
  // different reference-canvas scale (950 vs 560) and bounding-box aspect ratio,
  // so the raw multiplier differs even though the on-screen size is the same.
  pantry: 0.585 * (0.68 / 0.4),
  tiktokstudio: 0.42 * (0.68 / 0.4)
};

const BOOKABLE_ROOM_IDS = new Set(["tiktokstudio", "podcast", "meetingroom1", "meetingroom2"]);
const ROOM_TO_ZONE_ID: Record<string, string> = {
  meetingroom1: "MR_1",
  meetingroom2: "MR_2",
  podcast: "POD_1",
  tiktokstudio: "TTS_1",
  bathroom: "BAT_1",
  pantry: "PAN_1",
  reception: "REC_1",
  entrance: "ENT_1"
};

// Tenant company names, shown only in the room info popup (never on the map
// itself, which always keeps the plain "Hive N" label). Hives without a
// mapped tenant here just show their normal label in the popup too.
const HIVE_COMPANY_NAMES: Record<string, string> = {
  hive7: "EXPART GLOBAL LIMITED",
  hive9: "Tulpar Global Taxation Consultancy Limited",
  hive10: "DCI Markets Ltd",
  hive11: "Chain Legal Ltd",
  hive13: "Kronos Proprietary Trading LTD",
  hive14: "Future World Group Holding LTD",
  hive15: "Hivat International Ltd",
  hive18: "Confrere Global Legale Inc",
  hive19: "SPARQ Hub LTD"
};

type RoomDisplayStatus = "occupied" | "available" | "closed";

const ROOM_STATUS_COLOR: Record<RoomDisplayStatus, string> = {
  occupied: "#F04D4D",
  available: "#21D86A",
  closed: "#F04D4D"
};

function officeZoneIdFromHive(roomId: string) {
  const match = /^hive(\d+)$/.exec(roomId);
  if (!match) return null;
  return `OFF_${String(Number(match[1])).padStart(2, "0")}`;
}

function getRoomZone(room: RoomTile, zones: Zone[]): Zone | undefined {
  const mappedZoneId = ROOM_TO_ZONE_ID[room.id] || officeZoneIdFromHive(room.id);
  if (mappedZoneId) {
    return zones.find((zone) => zone.zone_id === mappedZoneId);
  }
  return zones.find((zone) => normalizeName(zone.zone_name) === normalizeName(room.label));
}

function getRoomStatus(room: RoomTile, _index: number, zones: Zone[]): RoomDisplayStatus {
  const match = getRoomZone(room, zones);
  if (match) {
    if (match.is_closed) return "closed";
    return match.status === "available" ? "available" : "occupied";
  }
  return "available";
}

function hasStatusConcept(room: RoomTile, zones: Zone[]) {
  if (!NO_STATUS_ROOM_IDS.has(room.id)) return true;
  return getRoomZone(room, zones)?.is_closed === true;
}

function statusLabel(status: RoomDisplayStatus) {
  if (status === "closed") return "Closed";
  return status === "occupied" ? "Occupied" : "Available";
}

function statusSentence(status: RoomDisplayStatus) {
  if (status === "closed") return "Currently closed";
  return status === "occupied" ? "Currently occupied" : "Currently available";
}

function timeMinutes(value?: string) {
  if (!value) return null;
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function displayClock(value?: string) {
  if (!value) return "--:--";
  const [hoursText, minutes = "00"] = value.slice(0, 5).split(":");
  const hours = Number(hoursText);
  if (!Number.isFinite(hours)) return value.slice(0, 5);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes} ${period}`;
}


function labelFontSize(_label: string, w: number) {
  // Kiosk: larger than the dashboard (15), but kept inside narrow tiles.
  return Math.min(21, Math.max(16, w / 6.2));
}

function labelLines(label: string): string[] {
  if (label.length <= 9 || !label.includes(" ")) return [label];
  const words = label.split(" ");
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}

// Classic top-view chair pictogram: a rounded seat square with a curved backrest
// bracket hugging the side facing away from the table — the standard floor-plan
// chair symbol, kept simple so it reads clearly even at this tiny scale. Faces
// right by default (back arc on the left); `rotation` turns it to face any
// direction, `scale` resizes it (e.g. a bigger seat for an office-owner chair)
// and `seatColor` lets a specific chair stand out from the rest.
function EventChair({
  cx,
  cy,
  rotation = 0,
  scale = 1,
  seatColor = "#2d6b74"
}: {
  cx: number;
  cy: number;
  rotation?: number;
  scale?: number;
  seatColor?: string;
}) {
  const seat = 7.4 * scale;
  const r = seat / 2;
  const backR = r + 1.6 * scale;
  return (
    <g transform={rotation ? `rotate(${rotation} ${cx} ${cy})` : undefined}>
      <path
        d={`M ${cx - backR} ${cy - r} A ${backR} ${backR} 0 0 0 ${cx - backR} ${cy + r}`}
        fill="none"
        stroke="#1c4750"
        strokeWidth={1.8 * scale}
        strokeLinecap="round"
      />
      <rect x={cx - r} y={cy - r} width={seat} height={seat} rx={2.6 * scale} fill={seatColor} stroke="#173a42" strokeWidth={0.6} />
    </g>
  );
}

function EventAreaScene({ room }: { room: RoomTile }) {
  const { t } = useLang(); // kiosk: the artwork's text follows the language
  // Shifted right (toward the screen) a modest amount from the first pass, per feedback.
  const shiftRight = 35;
  const tableAreaLeft = room.x + 14 + shiftRight;
  const tableAreaRight = room.x + room.w * 0.58 + shiftRight;
  const tableAreaTop = room.y + 16;
  const tableAreaBottom = room.y + room.h - 16;
  const cols = 4;
  const rows = 2;
  const cellW = (tableAreaRight - tableAreaLeft) / cols;
  const cellH = (tableAreaBottom - tableAreaTop) / rows;
  const tableW = 15;
  const tableH = cellH - 26;
  const chairDy = [-0.35, -0.12, 0.12, 0.35];

  const screenX = room.x + room.w - 16;
  const screenTop = room.y + 18;
  const screenBottom = room.y + room.h - 18;
  const beamGradientId = `eventBeam-${room.id}`;
  const screenGlowId = `eventScreenGlow-${room.id}`;
  const tableGradientId = `eventTable-${room.id}`;

  return (
    <g style={{ pointerEvents: "none" }}>
      <defs>
        <linearGradient id={beamGradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#4dd9e8" stopOpacity="0" />
          <stop offset="100%" stopColor="#4dd9e8" stopOpacity="0.34" />
        </linearGradient>
        <filter id={screenGlowId} x="-200%" y="-40%" width="500%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" />
        </filter>
        <linearGradient id={tableGradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#1f4f5a" />
          <stop offset="50%" stopColor="#173a42" />
          <stop offset="100%" stopColor="#122e35" />
        </linearGradient>
      </defs>

      {/* light beam — full screen-height at the source, sloping inward immediately
          (no straight run first) as it travels toward the tables, stopping well
          short of meeting in the middle (a healthy gap remains at the narrow end).
          Breathes gently in sync with the screen (opacity-only, since its fill is
          a gradient that a color animation would otherwise override). */}
      <polygon
        className="event-beam-live"
        points={`${screenX},${screenTop} ${tableAreaRight},${(screenTop + screenBottom) / 2 - (screenBottom - screenTop) * 0.28} ${tableAreaRight},${(screenTop + screenBottom) / 2 + (screenBottom - screenTop) * 0.28} ${screenX},${screenBottom}`}
        fill={`url(#${beamGradientId})`}
      />

      {Array.from({ length: rows }).flatMap((_, r) =>
        Array.from({ length: cols }).map((_, c) => {
          const cellX = tableAreaLeft + c * cellW;
          const cellY = tableAreaTop + r * cellH;
          const tcx = cellX + cellW / 2;
          const tcy = cellY + cellH / 2;
          const chairX = tcx - tableW / 2 - 8;
          return (
            <g key={`${r}-${c}`}>
              {chairDy.map((f) => (
                <EventChair key={f} cx={chairX} cy={tcy + f * tableH} />
              ))}
              <rect
                x={tcx - tableW / 2}
                y={tcy - tableH / 2}
                width={tableW}
                height={tableH}
                rx={2}
                fill={`url(#${tableGradientId})`}
                stroke="#2AD8E1"
                strokeOpacity={0.32}
                strokeWidth={1}
              />
              {/* center seam — a tabletop panel join so it reads as a table slab */}
              <line
                x1={tcx}
                y1={tcy - tableH / 2 + 5}
                x2={tcx}
                y2={tcy + tableH / 2 - 5}
                stroke="#2AD8E1"
                strokeOpacity={0.16}
                strokeWidth={0.8}
              />
            </g>
          );
        })
      )}

      {/* projector screen, with a soft bloom and a flickering opacity animation so it
          reads as actively displaying something, not just a static bright bar */}
      <rect
        className="event-screen-live"
        x={screenX}
        y={screenTop}
        width={6}
        height={screenBottom - screenTop}
        rx={2}
        fill="#eafdff"
        filter={`url(#${screenGlowId})`}
        style={{ animationDelay: "0.4s" }}
      />
      <rect
        className="event-screen-live"
        x={screenX}
        y={screenTop}
        width={6}
        height={screenBottom - screenTop}
        rx={2}
        fill="#eafdff"
      />

      {/* room name, centered in the room on top of everything else — a soft
          dark chip behind it keeps it legible over the tables */}
      <rect
        x={room.x + room.w / 2 - 60}
        y={room.y + room.h / 2 - 15}
        width={120}
        height={30}
        rx={8}
        fill="#0b1119"
        fillOpacity={0.82}
      />
      <text
        x={room.x + room.w / 2}
        y={room.y + room.h / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#6fccdd"
        fontSize={labelFontSize(room.label, room.w)}
        fontWeight={600}
        className="room-label"
      >
        {t(room.label)}
      </text>
    </g>
  );
}

// Meeting Room 1: a single conference table centered in the room with 10
// chairs (4 facing in from each long edge, plus one at each short end). Same
// teal/dark palette and flat top-down convention as the rest of the map (not
// photoreal furniture), with just a soft drop shadow under the table for a
// touch of lift. No text label, by request.
function MeetingRoomScene({ room }: { room: RoomTile }) {
  const { t } = useLang(); // kiosk: the artwork's text follows the language
  // Table/chair proportions were tuned against a 101-tall room; scale them with
  // room.h so a taller room gets a chunkier table and bigger chairs instead of
  // just extra blank margin above/below the same-sized furniture.
  const scaleFactor = room.h / 101;

  const margin = 14;
  const tableAreaLeft = room.x + margin;
  const tableAreaRight = room.x + room.w - margin;
  const tableAreaTop = room.y + margin;
  const tableAreaBottom = room.y + room.h - margin;

  const chairOffset = 7 * scaleFactor;
  const tableX = tableAreaLeft + chairOffset;
  const tableRight = tableAreaRight - chairOffset;
  const tableW = tableRight - tableX;
  const tableCenterY = (tableAreaTop + tableAreaBottom) / 2;

  // Chair positions are anchored to the original (smaller) table height so
  // enlarging the table below doesn't move them.
  const chairAnchorTableH = 30 * scaleFactor;
  const chairAnchorTop = tableCenterY - chairAnchorTableH / 2;
  const chairAnchorBottom = chairAnchorTop + chairAnchorTableH;
  const chairGap = 11 * scaleFactor;
  const chairXs = [0.125, 0.375, 0.625, 0.875].map((f) => tableX + tableW * f);
  const topChairY = chairAnchorTop - chairGap;
  const bottomChairY = chairAnchorBottom + chairGap;
  const leftChairX = tableX - chairOffset;
  const rightChairX = tableRight + chairOffset;

  // Table now grows to fill the empty space up to just short of the chair
  // seats, leaving a small clearance so it doesn't visually merge with them.
  const chairSeatR = 3.7 * scaleFactor;
  const chairClearance = 2 * scaleFactor;
  const tableY = topChairY + chairSeatR + chairClearance;
  const tableBottom = bottomChairY - chairSeatR - chairClearance;
  const tableH = tableBottom - tableY;

  const tableGradientId = `meetingTable-${room.id}`;
  const tableShadowId = `meetingTableShadow-${room.id}`;

  return (
    <g style={{ pointerEvents: "none" }}>
      <defs>
        <linearGradient id={tableGradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#1f4f5a" />
          <stop offset="50%" stopColor="#173a42" />
          <stop offset="100%" stopColor="#122e35" />
        </linearGradient>
        <filter id={tableShadowId} x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="1.4" stdDeviation="1.4" floodColor="#000000" floodOpacity="0.5" />
        </filter>
      </defs>

      <rect
        x={tableX}
        y={tableY}
        width={tableW}
        height={tableH}
        rx={4}
        fill={`url(#${tableGradientId})`}
        stroke="#2AD8E1"
        strokeOpacity={0.32}
        strokeWidth={1}
        filter={`url(#${tableShadowId})`}
      />
      {/* center seam — a tabletop panel join so it reads as a table slab */}
      <line
        x1={tableX + 6}
        y1={tableCenterY}
        x2={tableX + tableW - 6}
        y2={tableCenterY}
        stroke="#2AD8E1"
        strokeOpacity={0.16}
        strokeWidth={0.8}
      />

      {chairXs.map((cx) => (
        <EventChair key={`top-${cx}`} cx={cx} cy={topChairY} rotation={90} scale={scaleFactor} />
      ))}
      {chairXs.map((cx) => (
        <EventChair key={`bottom-${cx}`} cx={cx} cy={bottomChairY} rotation={-90} scale={scaleFactor} />
      ))}
      <EventChair cx={rightChairX} cy={tableCenterY} rotation={180} scale={scaleFactor} />
      <EventChair cx={leftChairX} cy={tableCenterY} rotation={0} scale={scaleFactor} />

      <text
        x={tableX + tableW / 2}
        y={tableCenterY}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#6fccdd"
        fontSize={15}
        fontWeight={600}
        className="room-label"
      >
        <tspan x={tableX + tableW / 2} y={tableCenterY - 8}>{t("Meeting")}</tspan>
        <tspan x={tableX + tableW / 2} y={tableCenterY + 8}>{t("Room {n}", { n: room.id === "meetingroom1" ? 1 : 2 })}</tspan>
      </text>
    </g>
  );
}

function CategoryIcon({ kind, cx, cy, s, color }: { kind: string; cx: number; cy: number; s: number; color: string }) {
  const { t } = useLang(); // kiosk: the artwork's text follows the language
  const stroke = color;
  const sw = Math.max(1.4, s * 0.075);

  if (kind === "door") {
    // Double sliding-door geometry from the supplied 1664x832 SVG, centered on its
    // actual artwork bounds and scaled to match the reception icon's visual width.
    const k = s / 347;
    return (
      <g
        transform={`translate(${cx} ${cy}) scale(${k}) translate(-864 -428.5)`}
        style={{ pointerEvents: "none" }}
      >
        <rect x={236} y={332} width={272} height={44} rx={2} fill={stroke} fillOpacity={0.34} stroke={stroke} strokeWidth={13} />
        <line x1={237} y1={333} x2={507} y2={333} stroke={stroke} strokeWidth={14} opacity={0.9} />
        <line x1={237} y1={333} x2={237} y2={376} stroke={stroke} strokeWidth={14} opacity={0.72} />

        <rect x={1220} y={332} width={272} height={44} rx={2} fill={stroke} fillOpacity={0.34} stroke={stroke} strokeWidth={13} />
        <line x1={1221} y1={333} x2={1491} y2={333} stroke={stroke} strokeWidth={14} opacity={0.9} />
        <line x1={1491} y1={333} x2={1491} y2={376} stroke={stroke} strokeWidth={14} opacity={0.72} />

        <rect x={518} y={334} width={316} height={13} rx={2} fill={stroke} opacity={0.82} />
        <line x1={520} y1={336} x2={832} y2={336} stroke={stroke} strokeWidth={9} opacity={0.48} />
        <rect x={894} y={334} width={316} height={13} rx={2} fill={stroke} opacity={0.82} />
        <line x1={896} y1={336} x2={1208} y2={336} stroke={stroke} strokeWidth={9} opacity={0.48} />

        <rect x={507} y={351} width={20} height={21} rx={2} fill={stroke} opacity={0.72} />
        <rect x={500} y={354} width={9} height={15} rx={1} fill={stroke} opacity={0.42} />
        <rect x={1201} y={351} width={20} height={21} rx={2} fill={stroke} opacity={0.72} />
        <rect x={1220} y={354} width={9} height={15} rx={1} fill={stroke} opacity={0.42} />
        <rect x={840} y={335} width={22} height={12} rx={4} fill={stroke} opacity={0.72} />
        <rect x={866} y={335} width={22} height={12} rx={4} fill={stroke} opacity={0.72} />

        <path d="M526 347 L634 525" stroke={stroke} strokeWidth={26} strokeLinecap="square" />
        <line x1={529} y1={350} x2={637} y2={522} stroke={stroke} strokeWidth={9} opacity={0.42} />
        <path d="M1202 347 L1094 525" stroke={stroke} strokeWidth={26} strokeLinecap="square" />
        <line x1={1199} y1={350} x2={1091} y2={522} stroke={stroke} strokeWidth={9} opacity={0.42} />

        <path d="M834 349 C832 440 778 517 640 523" fill="none" stroke={stroke} strokeWidth={13} strokeLinecap="round" strokeDasharray="12 13" opacity={0.68} />
        <path d="M894 349 C896 440 950 517 1088 523" fill="none" stroke={stroke} strokeWidth={13} strokeLinecap="round" strokeDasharray="12 13" opacity={0.68} />
      </g>
    );
  }

  if (kind === "reception") {
    // Ported directly from the reference 1664x832 SVG (desk + "Reception" label +
    // three waiting chairs). Unlike the other icons here, this shape's own true
    // bounding box (desk + chairs together: x 223-1608, y 177-563) isn't centered
    // on the reference canvas's nominal middle (832,416) — so X/Y are rebased
    // against the shape's *actual* visual center (ox,oy below) instead, or the
    // whole graphic would render off-center. k is tuned so this wide, short
    // composition fits inside the room's own tile now that it has one, rather
    // than the larger free-floating size it used when it had no tile behind it.
    const ox = 915.5;
    const oy = 370;
    const k = s / 383;
    const X = (n: number) => cx + (n - ox) * k;
    const Y = (n: number) => cy + (n - oy) * k;
    const deskGradId = "receptionDeskGrad";
    const chairGradId = "receptionChairGrad";
    const shadowId = "receptionSoftShadow";
    const chair = (x0: number) => (
      <g key={x0} filter={`url(#${shadowId})`}>
        <rect x={X(x0)} y={Y(420)} width={198 * k} height={81 * k} rx={7 * k} fill={`url(#${chairGradId})`} />
        <rect x={X(x0)} y={Y(420)} width={25 * k} height={81 * k} rx={7 * k} fill="#a8e6ee" />
        <rect x={X(x0 + 173)} y={Y(420)} width={25 * k} height={81 * k} rx={7 * k} fill="#a8e6ee" />
        <line x1={X(x0 + 25)} y1={Y(420)} x2={X(x0 + 25)} y2={Y(501)} stroke="#173a42" strokeWidth={3 * k} />
        <line x1={X(x0 + 173)} y1={Y(420)} x2={X(x0 + 173)} y2={Y(501)} stroke="#173a42" strokeWidth={3 * k} />
        <rect x={X(x0 + 9)} y={Y(503)} width={179 * k} height={60 * k} rx={2 * k} fill={`url(#${chairGradId})`} />
      </g>
    );
    return (
      <g style={{ pointerEvents: "none" }}>
        <defs>
          <linearGradient id={deskGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8fe0ec" />
            <stop offset="100%" stopColor="#4a9aa8" />
          </linearGradient>
          <linearGradient id={chairGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6fccdd" />
            <stop offset="100%" stopColor="#3f8b98" />
          </linearGradient>
          <filter id={shadowId} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy={2 * k} stdDeviation={2 * k} floodColor="#000000" floodOpacity="0.45" />
          </filter>
        </defs>

        <path
          d={`M ${X(304)} ${Y(177)}
              H ${X(1530)}
              C ${X(1573)} ${Y(177)} ${X(1608)} ${Y(212)} ${X(1608)} ${Y(255)}
              V ${Y(480)}
              C ${X(1608)} ${Y(507)} ${X(1586)} ${Y(529)} ${X(1559)} ${Y(529)}
              H ${X(1519)}
              C ${X(1492)} ${Y(529)} ${X(1470)} ${Y(507)} ${X(1470)} ${Y(480)}
              V ${Y(381)}
              H ${X(360)}
              V ${Y(480)}
              C ${X(360)} ${Y(507)} ${X(338)} ${Y(529)} ${X(311)} ${Y(529)}
              H ${X(272)}
              C ${X(245)} ${Y(529)} ${X(223)} ${Y(507)} ${X(223)} ${Y(480)}
              V ${Y(255)}
              C ${X(223)} ${Y(212)} ${X(258)} ${Y(177)} ${X(304)} ${Y(177)}
              Z`}
          fill={`url(#${deskGradId})`}
          filter={`url(#${shadowId})`}
        />

        <text
          x={X(916)}
          y={Y(320)}
          textAnchor="middle"
          fontSize={14}
          fontWeight={700}
          fill="#071114"
          style={{ fontFamily: "var(--font-body), Arial, Helvetica, sans-serif" }}
        >
          {t("Reception")}
        </text>

        {[536, 820, 1105].map((x0) => chair(x0))}
      </g>
    );
  }

  if (kind === "mic") {
    // Exact line-art geometry ported from a reference 1536x1024 SVG (viewBox center
    // (768,512) as origin), scaled by k so the icon's overall height nearly fills
    // this app's icon box. Y-constants are re-based (shifted by -55.5) from the
    // source data so the icon's own visual midpoint lands exactly on cy, since the
    // raw geometry itself isn't vertically symmetric (stem extends further below
    // than the capsule extends above) — do not "eyeball" adjust the shape further.
    const k = s / 560;
    const micSw = Math.max(1.1, s * 0.045);
    return (
      <g style={{ pointerEvents: "none" }}>
        <rect
          x={cx - 94 * k}
          y={cy - 252.5 * k}
          width={188 * k}
          height={350 * k}
          rx={94 * k}
          fill="none"
          stroke={stroke}
          strokeWidth={micSw}
          strokeLinecap="round"
        />
        <path
          d={`M ${cx - 159 * k} ${cy - 7.5 * k} C ${cx - 159 * k} ${cy + 94.5 * k} ${cx - 87 * k} ${cy + 167.5 * k} ${cx} ${cy + 167.5 * k} C ${cx + 87 * k} ${cy + 167.5 * k} ${cx + 159 * k} ${cy + 94.5 * k} ${cx + 159 * k} ${cy - 7.5 * k}`}
          fill="none"
          stroke={stroke}
          strokeWidth={micSw}
          strokeLinecap="round"
        />
        <line x1={cx} y1={cy + 167.5 * k} x2={cx} y2={cy + 252.5 * k} stroke={stroke} strokeWidth={micSw} strokeLinecap="round" />
      </g>
    );
  }

  if (kind === "kitchen") {
    // Cooking-pot glyph ported from a reference 256x256 SVG (rounded pot body +
    // three top vents + base line + side handle), origin re-centered on the
    // canvas midpoint (128,128) since the source viewBox is a plain square.
    const k = s / 256;
    const potSw = Math.max(1.1, s * 0.270);
    return (
      <g
        transform={`translate(${cx} ${cy}) scale(${k}) translate(-128 -128)`}
        fill="none"
        stroke={stroke}
        strokeWidth={potSw}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ pointerEvents: "none" }}
      >
        <path d="M83.3,216A88,88,0,0,1,32,136V88H208v48a88,88,0,0,1-51.3,80" />
        <line x1={32} y1={216} x2={208} y2={216} />
        <path d="M208,88h4a32,32,0,0,1,32,32v8a32,32,0,0,1-32,32h-7.38" />
        <line x1={80} y1={24} x2={80} y2={48} />
        <line x1={120} y1={24} x2={120} y2={48} />
        <line x1={160} y1={24} x2={160} y2={48} />
      </g>
    );
  }

  if (kind === "tiktok") {
    const k = s / 240;
    return (
      <g
        transform={`translate(${cx} ${cy}) scale(${k}) translate(-128 -124)`}
        fill="none"
        stroke={stroke}
        strokeWidth={12}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ pointerEvents: "none" }}
      >
        <path
          d="M168,102a95.55,95.55,0,0,0,56,18V80a56,56,0,0,1-56-56H128V156a28,28,0,1,1-40-25.31V88c-31.83,5.67-56,34.54-56,68a68,68,0,0,0,136,0Z"
        />
      </g>
    );
  }

  if (kind === "bath") {
    const headR = s * 0.1;
    return (
      <g style={{ pointerEvents: "none" }}>
        <line x1={cx} y1={cy - s * 0.44} x2={cx} y2={cy + s * 0.44} stroke={stroke} strokeWidth={sw * 0.55} />
        <g transform={`translate(${cx - s * 0.26}, 0)`}>
          <circle cx={0} cy={cy - s * 0.28} r={headR} fill={stroke} />
          <path
            d={`M ${-s * 0.1} ${cy - s * 0.12} L ${s * 0.1} ${cy - s * 0.12} L ${s * 0.08} ${cy + s * 0.42} L ${s * 0.02} ${cy + s * 0.42} L 0 ${cy + s * 0.08} L ${-s * 0.02} ${cy + s * 0.42} L ${-s * 0.08} ${cy + s * 0.42} Z`}
            fill={stroke}
          />
        </g>
        <g transform={`translate(${cx + s * 0.26}, 0)`}>
          <circle cx={0} cy={cy - s * 0.28} r={headR} fill={stroke} />
          <path
            d={`M 0 ${cy - s * 0.14} L ${s * 0.14} ${cy + s * 0.2} L ${s * 0.03} ${cy + s * 0.2} L ${s * 0.05} ${cy + s * 0.42} L ${-s * 0.05} ${cy + s * 0.42} L ${-s * 0.03} ${cy + s * 0.2} L ${-s * 0.14} ${cy + s * 0.2} Z`}
            fill={stroke}
          />
        </g>
      </g>
    );
  }

  if (kind === "rocket") {
    return (
      <g style={{ pointerEvents: "none" }}>
        <path d={`M ${cx} ${cy - s * 0.45} C ${cx + s * 0.2} ${cy - s * 0.18} ${cx + s * 0.2} ${cy + s * 0.14} ${cx} ${cy + s * 0.42} C ${cx - s * 0.2} ${cy + s * 0.14} ${cx - s * 0.2} ${cy - s * 0.18} ${cx} ${cy - s * 0.45} Z`} fill={stroke} />
        <circle cx={cx} cy={cy - s * 0.06} r={s * 0.08} fill="#0d141c" />
        <path d={`M ${cx - s * 0.2} ${cy + s * 0.08} L ${cx - s * 0.36} ${cy + s * 0.4} L ${cx - s * 0.04} ${cy + s * 0.26} Z`} fill={stroke} />
        <path d={`M ${cx + s * 0.2} ${cy + s * 0.08} L ${cx + s * 0.36} ${cy + s * 0.4} L ${cx + s * 0.04} ${cy + s * 0.26} Z`} fill={stroke} />
      </g>
    );
  }

  if (kind === "calendar") {
    // Ported from a reference 1024x1024 SVG (calendar body + two hanging rings +
    // a starred date), line-art style like the other icons here — the reference's
    // own "white fill" only reads as blank against ITS white background, so that
    // translates to fill="none" here rather than a literal color copy. The shape
    // is already close enough to centered on the reference canvas's own middle
    // (512,512) that no separate re-centering offset is needed, unlike reception.
    const k = s / 280;
    const calSw = Math.max(1.1, s * 0.045);
    return (
      <g style={{ pointerEvents: "none" }} fill="none" stroke={stroke} strokeWidth={calSw}>
        <rect x={cx - 166 * k} y={cy - 76 * k} width={332 * k} height={280 * k} rx={29 * k} />
        <line x1={cx - 166 * k} y1={cy - 5 * k} x2={cx + 166 * k} y2={cy - 5 * k} />
        <rect x={cx - 90 * k} y={cy - 153.5 * k} width={46 * k} height={70 * k} rx={11 * k} />
        <rect x={cx + 44 * k} y={cy - 153.5 * k} width={46 * k} height={70 * k} rx={11 * k} />
        <path
          d={`M ${cx} ${cy - 33 * k}
              L ${cx + 21.5 * k} ${cy + 11 * k}
              L ${cx + 70 * k} ${cy + 18 * k}
              L ${cx + 35 * k} ${cy + 52 * k}
              L ${cx + 43 * k} ${cy + 100.5 * k}
              L ${cx} ${cy + 78 * k}
              L ${cx - 43 * k} ${cy + 100.5 * k}
              L ${cx - 35 * k} ${cy + 52 * k}
              L ${cx - 70 * k} ${cy + 18 * k}
              L ${cx - 21.5 * k} ${cy + 11 * k}
              Z`}
          strokeLinejoin="round"
        />
      </g>
    );
  }

  return null;
}

// ===== Hardcoded room routes (ported from reference floor-map prototype) =====
// Every entry starts at YOU_ARE_HERE and ends at the room's doorway, following the
// building's actual corridors — replaces grid-based pathfinding with hand-authored,
// art-directed paths that always look clean instead of occasionally zig-zagging.
// Waypoints stop exactly at the destination room's border (never dip inside),
// and shared corridor-transit segments run through the middle of each corridor
// gap: corridor1 (Hive18/19/11/12 <-> Hive7-10, y892-943) centers on y=917.5;
// corridor2 (Hive1-6 <-> Hive15-18, x276-327) centers on x=301.5; corridor3
// (Podcast/Pantry <-> Hive13/14/15, y310-361) centers on y=335.5.
const ROUTES: Record<string, [number, number][]> = {
  bathroom: [[901, 645], [901, 542], [700, 542], [700, 335.5], [627, 335.5], [594, 335.5], [594, 242]],
  pantry: [[901, 645], [901, 542], [700, 542], [700, 335.5], [627, 335.5], [530, 335.5], [530, 293], [494, 293]],
  podcast: [[901, 645], [901, 542], [700, 542], [700, 335.5], [627, 335.5], [530, 335.5], [351, 335.5], [351, 310]],
  hive1: [[901, 645], [901, 542], [700, 542], [700, 335.5], [627, 335.5], [530, 335.5], [350, 335.5], [301.5, 335.5], [301.5, 320], [276, 320]],
  hive2: [[901, 645], [901, 542], [700, 542], [700, 335.5], [627, 335.5], [530, 335.5], [350, 335.5], [301.5, 335.5], [301.5, 448], [276, 448]],
  hive3: [[901, 645], [901, 542], [700, 542], [700, 335.5], [530, 335.5], [301.5, 335.5], [301.5, 448], [301.5, 523], [301.5, 571], [276, 571]],
  hive4: [[901, 645], [901, 542], [700, 542], [700, 335.5], [627, 335.5], [530, 335.5], [350, 335.5], [301.5, 335.5], [301.5, 448], [301.5, 523], [301.5, 571], [301.5, 656], [276, 656]],
  hive5: [[901, 645], [901, 757], [700, 757], [700, 917.5], [301.5, 917.5], [301.5, 839], [276, 839]],
  hive6: [[901, 645], [901, 757], [700, 757], [700, 917.5], [301.5, 917.5], [276, 917.5]],
  hive7: [[901, 645], [901, 757], [700, 757], [700, 917.5], [336, 917.5], [336, 943]],
  hive8: [[901, 645], [901, 757], [700, 757], [700, 917.5], [455, 917.5], [455, 943]],
  hive9: [[901, 645], [901, 757], [700, 757], [700, 917.5], [574, 917.5], [574, 943]],
  hive10: [[901, 645], [901, 757], [700, 757], [700, 917.5], [692, 917.5], [692, 943]],
  hive11: [[901, 645], [901, 757], [700, 757], [700, 807], [667.32, 807]],
  hive12: [[901, 645], [901, 757], [700, 757], [700, 705], [667.32, 705]],
  hive13: [[901, 645], [901, 542], [700, 542], [700, 335.5], [627, 335.5], [627, 361]],
  hive14: [[901, 645], [901, 542], [700, 542], [700, 335.5], [627, 335.5], [530, 335.5], [530, 361]],
  hive15: [[901, 645], [901, 542], [700, 542], [700, 335.5], [530, 335.5], [301.5, 335.5], [301.5, 448], [327, 448]],
  hive16: [[901, 645], [901, 542], [700, 542], [700, 335.5], [627, 335.5], [530, 335.5], [350, 335.5], [301.5, 335.5], [301.5, 448], [301.5, 523], [327, 523]],
  hive17: [[901, 645], [901, 757], [700, 757], [700, 917.5], [301.5, 917.5], [301.5, 839], [301.5, 722], [301.5, 656], [327, 656]],
  hive18: [[901, 645], [901, 757], [700, 757], [700, 917.5], [301.5, 917.5], [301.5, 839], [301.5, 722], [327, 718]],
  hive19: [[901, 645], [901, 757], [700, 757], [700, 917.5], [497.56, 917.5], [497.56, 892]],
  meetingroom1: [[901, 645], [700, 645], [623, 644]],
  meetingroom2: [[901, 645], [901, 542], [700, 542], [623, 542]],
  eventarea: [[901, 645], [901, 757], [901, 827]],
  tiktokstudio: [[901, 645], [1004, 644], [1004, 524], [1062, 525]],
  reception: [[901, 645], [901, 542], [700, 542], [700, 366], [872, 364], [872, 367.3]],
  entrance: [[901, 645], [901, 542], [700, 542], [700, 365], [872, 364], [872, 327]]
};

// ============================ kiosk map + details ============================

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

/** Live zone list (same source as the dashboard); [] if unavailable. */
export async function fetchZones(): Promise<Zone[]> {
  try {
    const response = await fetch(`${API_BASE}/api/zones`, { cache: "no-store" });
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  } catch {
    return [];
  }
}
const POLL_MS = 30_000;

/** Quick buttons above the map: the places visitors look for most. */
const QUICK_PLACES: Array<{ id: string; label: string }> = [
  { id: "meetingroom1", label: "Meeting rooms" },
  { id: "podcast", label: "Podcast" }, // short: the full name is in the details card
  { id: "tiktokstudio", label: "TikTok" },
  { id: "eventarea", label: "Events" }, // short; the map labels it "Event Area"
];

/* ---- Search ("Where do you want to go?") ----
   Everything findable on the map: rooms by name in English and Arabic,
   Hive offices by number, tenant companies by name, plus everyday words
   people actually type. Add words to SEARCH_WORDS freely. */
const SEARCH_WORDS: Record<string, string[]> = {
  bathroom: ["toilet", "toilets", "restroom", "bathroom", "washroom", "wc", "w.c", "حمام", "حمامات", "دورة مياه", "دورات المياه", "تواليت"],
  pantry: ["kitchen", "pantry", "coffee", "tea", "water", "مطبخ", "قهوة", "شاي", "ماء"],
  reception: ["reception", "front desk", "help desk", "information", "استقبال", "الاستقبال", "مكتب الاستقبال"],
  entrance: ["entrance", "exit", "door", "way out", "مدخل", "المدخل", "خروج", "مخرج"],
  eventarea: ["event", "events", "stage", "workshop", "فعالية", "فعاليات", "منطقة الفعاليات", "ورشة"],
  podcast: ["podcast", "recording", "audio", "studio", "بودكاست", "تسجيل", "استوديو"],
  tiktokstudio: ["tiktok", "tik tok", "content", "video", "studio", "تيك توك", "محتوى", "فيديو", "استوديو"],
  meetingroom1: ["meeting", "meeting room", "conference", "اجتماع", "اجتماعات", "غرفة اجتماعات"],
  meetingroom2: ["meeting", "meeting room", "conference", "اجتماع", "اجتماعات", "غرفة اجتماعات"],
};

/** Lower-case, Western digits, and the usual Arabic spelling variations. */
function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u064B-\u065F\u0640]/g, "") // harakat + tatweel
    .replace(/\s+/g, " ")
    .trim();
}

type SearchEntry = { id: string; terms: string[] };

const SEARCH_INDEX: SearchEntry[] = ROOM_TILES.map((room) => {
  const hive = /^hive(\d+)$/.exec(room.id);
  const terms = [
    room.label,
    arabicFromFile(room.label) ?? room.label,
    ...(hive ? [`hive ${hive[1]}`, `office ${hive[1]}`, `مكتب ${hive[1]}`, `هايف ${hive[1]}`, hive[1]] : []),
    ...(HIVE_COMPANY_NAMES[room.id] ? [HIVE_COMPANY_NAMES[room.id]] : []),
    ...(SEARCH_WORDS[room.id] ?? []),
  ];
  return { id: room.id, terms: terms.map(normalizeSearch) };
});

function searchPlaces(query: string): string[] {
  const q = normalizeSearch(query);
  if (!q) return [];
  const scored: Array<{ id: string; score: number }> = [];
  for (const entry of SEARCH_INDEX) {
    let best = 0;
    for (const term of entry.terms) {
      if (term === q) best = Math.max(best, 3);
      else if (term.startsWith(q) || term.split(" ").some((word) => word.startsWith(q))) best = Math.max(best, 2);
      else if (q.length >= 3 && term.includes(q)) best = Math.max(best, 1);
    }
    if (best > 0) scored.push({ id: entry.id, score: best });
  }
  return scored
    .sort((a, b) => b.score - a.score || ROOM_TILES.findIndex((r) => r.id === a.id) - ROOM_TILES.findIndex((r) => r.id === b.id))
    .slice(0, 6)
    .map((hit) => hit.id);
}

/** Rooms that never show a status (the W.C is always open). */
const NEVER_STATUS_ROOM_IDS = new Set(["bathroom"]);

/** Map room -> kiosk photo / facts key. */
const ROOM_MEDIA: Record<string, string> = {
  meetingroom1: "MR_1",
  meetingroom2: "MR_2",
  podcast: "podcast_studio",
  tiktokstudio: "tiktok_studio",
};

export type BookableRoom = "meetingroom1" | "meetingroom2" | "podcast" | "tiktokstudio";

/** "Hive 7" -> "هايف 7" etc.; other names go through the translation file. */
function roomLabel(t: (text: string, vars?: Record<string, string | number>) => string, label: string) {
  const hive = /^Hive (\d+)$/.exec(label);
  return hive ? t("Hive {n}", { n: hive[1] }) : t(label); // numbers follow the language
}

export function FloorMap({
  onBook,
  initialSelected = null,
}: {
  onBook: (room: BookableRoom) => void;
  /** Open with this room selected and its route drawn (e.g. from Explore). */
  initialSelected?: string | null;
}) {
  const { t } = useLang();
  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelected);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const results = useMemo(() => searchPlaces(query), [query]);
  const pathRef = useRef<SVGPathElement>(null);

  // Live status, same source as the dashboard. Accepts a plain list or a
  // {data: [...]} envelope; on failure the map simply shows no status dots
  // as "available" (the dashboard's own fallback).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`${API_BASE}/api/zones`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        const list = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
        if (!cancelled) setZones(list);
      } catch {
        // keep the last known status
      }
    }
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const selectedRoom = ROOM_TILES.find((room) => room.id === selectedId) || null;
  const route = useMemo(() => (selectedId ? ROUTES[selectedId] ?? null : null), [selectedId]);
  const routeD = route ? "M " + route.map((point) => point.join(",")).join(" L ") : "";
  const finalPoint = route ? route[route.length - 1] : null;

  // Draw the route (same technique as the dashboard: set the "undrawn"
  // dash, force a reflow, then animate to drawn).
  useLayoutEffect(() => {
    const pathEl = pathRef.current;
    if (!route || !pathEl) return;
    const length = pathEl.getTotalLength();
    pathEl.style.transition = "none";
    pathEl.style.strokeDasharray = `${length}`;
    pathEl.style.strokeDashoffset = `${length}`;
    void pathEl.getBoundingClientRect();
    pathEl.style.transition = `stroke-dashoffset ${ROUTE_DRAW_MS}ms ease-out`;
    pathEl.style.strokeDashoffset = "0";
  }, [selectedId, route]);

  const select = (id: string) => setSelectedId((current) => (current === id ? null : id));
  const chooseResult = (id: string) => {
    setSelectedId(id);
    setQuery("");
    setSearching(false);
    (document.activeElement as HTMLElement | null)?.blur(); // closes the on-screen keyboard
  };

  const status = selectedRoom ? getRoomStatus(selectedRoom, 0, zones) : null;
  const showStatus = selectedRoom ? !NEVER_STATUS_ROOM_IDS.has(selectedRoom.id) && hasStatusConcept(selectedRoom, zones) : false;
  const media = selectedRoom ? ROOM_MEDIA[selectedRoom.id] : undefined;
  const company = selectedRoom ? HIVE_COMPANY_NAMES[selectedRoom.id] : undefined;
  const bookable = selectedRoom && BOOKABLE_ROOM_IDS.has(selectedRoom.id);

  return (
    <div className="floor-map-wrap">
      <div className="floor-top">
      <div className="floor-search">
        <Search aria-hidden className="floor-search-icon" />
        <input
          aria-label={t("Where do you want to go?")}
          autoComplete="off"
          onBlur={() => window.setTimeout(() => setSearching(false), 150)}
          onChange={(event) => {
            setQuery(event.target.value);
            setSearching(true);
          }}
          onFocus={() => setSearching(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && results[0]) chooseResult(results[0]);
            if (event.key === "Escape") setSearching(false);
          }}
          placeholder={t("Where do you want to go?")}
          type="search"
          value={query}
        />
        {query ? (
          <button aria-label={t("Clear")} className="floor-search-clear" onClick={() => setQuery("")} type="button">
            <X aria-hidden />
          </button>
        ) : null}
        {searching && query.trim() ? (
          <div className="floor-results" role="listbox">
            {results.length === 0 ? <p className="floor-no-results">{t("No matching place")}</p> : null}
            {results.map((id) => {
              const room = ROOM_TILES.find((tile) => tile.id === id);
              if (!room) return null;
              const company = HIVE_COMPANY_NAMES[id];
              return (
                <button key={id} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseResult(id)} role="option" type="button">
                  <b>{company ?? roomLabel(t, room.label)}</b>
                  {company ? <span>{roomLabel(t, room.label)}</span> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <div className="floor-quick" role="toolbar" aria-label={t("Find a place")}>
        {QUICK_PLACES.map((place) => {
          const active = selectedId === place.id || (place.id === "meetingroom1" && selectedId === "meetingroom2");
          return (
            <button className={active ? "on" : ""} key={place.id} onClick={() => select(place.id)} type="button">
              {t(place.label)}
            </button>
          );
        })}
      </div>
      </div>

      <div className="floor-map" dir="ltr">
        <svg aria-label={t("Ground floor map")} role="img" viewBox={VIEW_BOX}>
          <defs>
            <pattern id="cardDotGrid" width="14" height="14" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="#78DCE6" fillOpacity="0.13" />
            </pattern>
            {(
              [
                ["roomGlassGlow", 1],
                ["roomGlassGlowSelected", 2.2],
              ] as [string, number][]
            ).map(([id, intensity]) => (
              <filter height="100%" id={id} key={id} width="100%" x="0%" y="0%">
                <feComponentTransfer in="SourceAlpha" result="invertedAlpha">
                  <feFuncA tableValues="1 0" type="table" />
                </feComponentTransfer>
                <feGaussianBlur in="invertedAlpha" result="insetBlur" stdDeviation="6" />
                <feFlood floodColor="#20D2DC" floodOpacity={0.08 * intensity} result="insetFlood" />
                <feComposite in="insetFlood" in2="insetBlur" operator="in" result="insetGlow" />
                <feComposite in="insetGlow" in2="SourceGraphic" operator="in" result="clippedInsetGlow" />
                <feMerge>
                  <feMergeNode in="SourceGraphic" />
                  <feMergeNode in="clippedInsetGlow" />
                </feMerge>
              </filter>
            ))}
            <filter height="400%" id="statusGlowBlur" width="400%" x="-150%" y="-150%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3.2" />
            </filter>
            <pattern height="60" id="floorGrid" patternUnits="userSpaceOnUse" width="60">
              <path d="M60 0H0V60" fill="none" stroke="#173840" strokeOpacity="0.4" strokeWidth="1" />
            </pattern>
          </defs>

          <rect fill="#05070a" fillOpacity="0.55" height={SVG_H} rx="16" width={SVG_W} x="0" y="0" />
          <rect fill="url(#floorGrid)" height={SVG_H} rx="16" style={{ pointerEvents: "none" }} width={SVG_W} x="0" y="0" />

          {ROOM_TILES.map((room, index) => {
            const roomStatus = getRoomStatus(room, index, zones);
            const isSelected = selectedId === room.id;
            const centerX = room.x + room.w / 2;
            const centerY = room.y + room.h / 2;
            const iconKind = ICON_ROOM[room.id];
            const iconOnly = ICON_ONLY_ROOM_IDS.has(room.id);
            const iconSize = Math.min(room.w, room.h) * (iconOnly ? 0.68 : 0.4) * (ICON_SIZE_SCALE[room.id] ?? 1);
            const hasTile = !NO_TILE_ROOM_IDS.has(room.id);
            const hasStatusDot = !NEVER_STATUS_ROOM_IDS.has(room.id) && hasStatusConcept(room, zones);
            const label = roomLabel(t, room.label);
            // Never split the brand name "تيك توك" across two lines.
            const lines = label.endsWith(" تيك توك") ? [label.slice(0, -" تيك توك".length), "تيك توك"] : labelLines(label);
            const fontSize = labelFontSize(label, room.w);

            return (
              <g className="room-hit" key={room.id} onClick={() => select(room.id)}>
                <rect
                  className="room-rect"
                  fill={hasTile ? (isSelected ? "#123a44" : "#10171f") : "transparent"}
                  filter={hasTile ? (isSelected ? "url(#roomGlassGlowSelected)" : "url(#roomGlassGlow)") : undefined}
                  height={room.h}
                  rx={8}
                  stroke={hasTile ? "#24d2dc" : "none"}
                  strokeOpacity={isSelected ? 0.95 : 0.14}
                  strokeWidth={isSelected ? 3 : 1.2}
                  width={room.w}
                  x={room.x}
                  y={room.y}
                />
                {hasTile && (
                  <rect fill="url(#cardDotGrid)" height={room.h} opacity={0.45} rx={8} style={{ pointerEvents: "none" }} width={room.w} x={room.x} y={room.y} />
                )}

                {room.id === "eventarea" ? (
                  <EventAreaScene room={room} />
                ) : room.id === "meetingroom1" || room.id === "meetingroom2" ? (
                  <MeetingRoomScene room={room} />
                ) : iconKind ? (
                  <>
                    <CategoryIcon color="#6fccdd" cx={centerX} cy={iconOnly ? centerY : centerY - iconSize * 0.32} kind={iconKind} s={iconSize} />
                    {!iconOnly && (
                      <text className="room-label" dominantBaseline="middle" fill="#6fccdd" fontSize={fontSize} fontWeight={600} textAnchor="middle" x={centerX} y={centerY + iconSize * 0.55}>
                        {lines.length === 1 ? label : (
                          <>
                            <tspan dy="-0.1em" x={centerX}>{lines[0]}</tspan>
                            <tspan dy="1.1em" x={centerX}>{lines[1]}</tspan>
                          </>
                        )}
                      </text>
                    )}
                  </>
                ) : (
                  <text className="room-label" dominantBaseline="middle" fill="#6fccdd" fontSize={fontSize} fontWeight={600} textAnchor="middle" x={centerX} y={centerY}>
                    {lines.length === 1 ? label : (
                      <>
                        <tspan dy="-0.5em" x={centerX}>{lines[0]}</tspan>
                        <tspan dy="1.15em" x={centerX}>{lines[1]}</tspan>
                      </>
                    )}
                  </text>
                )}

                {hasStatusDot && (
                  <>
                    <circle cx={room.x + 16} cy={room.y + 16} fill={ROOM_STATUS_COLOR[roomStatus]} fillOpacity={0.55} filter="url(#statusGlowBlur)" r={6} style={{ pointerEvents: "none" }} />
                    <circle className="yah-pulse" cx={room.x + 16} cy={room.y + 16} fill={ROOM_STATUS_COLOR[roomStatus]} r={5.5} style={{ pointerEvents: "none" }} />
                  </>
                )}
              </g>
            );
          })}

          {route && (
            <path
              d={routeD}
              fill="none"
              ref={pathRef}
              stroke="#2dd4df"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={7}
              style={{ filter: "drop-shadow(0 0 6px rgba(45,212,223,0.65))", pointerEvents: "none" }}
            />
          )}
          {finalPoint && (
            <g style={{ pointerEvents: "none" }}>
              <circle cx={finalPoint[0]} cy={finalPoint[1]} fill="#17aec4" fillOpacity={0.3} r={18} />
              <circle cx={finalPoint[0]} cy={finalPoint[1]} fill="#4dd9e8" r={9} />
            </g>
          )}

          {[0, 1, 2].map((i) => (
            <circle className="yah-wave-ring" cx={YOU_ARE_HERE[0]} cy={YOU_ARE_HERE[1]} fill="none" key={i} r={8} stroke="#6fccdd" strokeWidth={1.5} style={{ pointerEvents: "none", animationDelay: `${i}s` }} />
          ))}
          <g className="yah-icon-live" style={{ pointerEvents: "none" }} transform={`translate(${YOU_ARE_HERE[0] - 128 * 0.155} ${YOU_ARE_HERE[1] - 232 * 0.155}) scale(0.155)`}>
            <path d="M136,127.42V232a8,8,0,0,1-16,0V127.42a56,56,0,1,1,16,0Z" fill="#6fccdd" />
          </g>
          <text className="room-label yah-label" fill="#2dd4df" fontSize={19} fontWeight={700} textAnchor="middle" x={YOU_ARE_HERE[0]} y={YOU_ARE_HERE[1] + 38}>
            {t("You are here")}
          </text>
        </svg>
      </div>

      {/* Details for the selected place */}
      {selectedRoom ? (
        <div className="floor-sheet" key={selectedRoom.id}>
          {media ? (
            <span className="floor-sheet-photo">
              <PhotoImg alt="" aria-hidden className="room-photo-fill" src={ROOM_PHOTOS[media]} />
              <PhotoImg alt={roomLabel(t, selectedRoom.label)} className="room-photo-img" src={ROOM_PHOTOS[media]} />
            </span>
          ) : null}
          <div className="floor-sheet-text">
            <b>{company ?? roomLabel(t, selectedRoom.label)}</b>
            {company ? <span className="floor-sheet-sub">{roomLabel(t, selectedRoom.label)}</span> : null}
            {media && roomDescription(media) ? <span className="floor-sheet-sub">{t(roomDescription(media) as string)}</span> : null}
            <span className="floor-sheet-meta">
              {status && showStatus ? (
                <span className={`room-status inline ${status === "available" ? "available" : status === "closed" ? "closed" : "busy"}`}>
                  <i />
                  {t(status === "available" ? "Available now" : status === "closed" ? "Closed" : "Occupied")}
                </span>
              ) : null}
              {(media ? ROOM_FACTS[media] : [])?.map((fact) => (
                <span className="floor-fact" key={fact}>
                  {t(fact)}
                </span>
              ))}
            </span>
          </div>
          <div className="floor-sheet-actions">
            {bookable ? (
              <button className="primary-btn" onClick={() => onBook(selectedRoom.id as BookableRoom)} type="button">
                <CalendarCheck aria-hidden />
                {t("Book")}
              </button>
            ) : (
              <span className="floor-route-note">
                <Navigation aria-hidden />
                {t("Follow the line on the map")}
              </span>
            )}
          </div>
        </div>
      ) : (
        <p className="floor-hint">{t("Search, or tap any space on the map to see the way there")}</p>
      )}
    </div>
  );
}