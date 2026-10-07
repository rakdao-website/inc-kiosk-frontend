import { describe, expect, it } from "vitest";

import { describeApproval, formatApprovalDate, formatApprovalTimes } from "./voice-approval";

const label = (key: string) => ({ tiktok_beauty_room: "TikTok Beauty Room" })[key] ?? key;

describe("describeApproval", () => {
  it("summarises a new booking in plain words, from JSON text or an object", () => {
    const args = { room: "tiktok_beauty_room", date: "2026-10-08", time: "16:00", duration_minutes: 30 };
    for (const raw of [args, JSON.stringify(args)]) {
      const prompt = describeApproval("create_booking", raw, label);
      expect(prompt.title).toBe("Confirm your booking");
      expect(prompt.rows).toEqual([
        { label: "Room", value: "TikTok Beauty Room" },
        { label: "Date", value: "Thu 8 Oct 2026" },
        { label: "Time", value: "16:00 – 16:30" },
      ]);
      expect([prompt.confirmLabel, prompt.cancelLabel]).toEqual(["Confirm", "Cancel"]);
    }
  });

  it("shows only what a reschedule changes", () => {
    const prompt = describeApproval("reschedule_booking", { booking_id: 12, time: "11:00", duration_minutes: 60 }, label);
    expect(prompt.rows).toEqual([
      { label: "Booking", value: "#12" },
      { label: "New time", value: "11:00 – 12:00" },
    ]);
  });

  it("uses unambiguous buttons when cancelling a booking", () => {
    const prompt = describeApproval("cancel_booking", { booking_id: 7 }, label);
    expect(prompt.title).toBe("Cancel this booking?");
    expect([prompt.confirmLabel, prompt.cancelLabel]).toEqual(["Yes, cancel booking", "Keep booking"]);
  });

  it("copes with missing or broken arguments and unknown tools", () => {
    expect(describeApproval("create_booking", "not json", label).rows).toEqual([]);
    expect(describeApproval("some_new_tool", {}, label)).toMatchObject({ title: "Please confirm", rows: [{ value: "some new tool" }] });
  });
});

describe("formatting", () => {
  it("formats dates and times, and passes odd input through", () => {
    expect(formatApprovalDate("2026-10-08")).toBe("Thu 8 Oct 2026");
    expect(formatApprovalDate("tomorrow")).toBe("tomorrow");
    expect(formatApprovalTimes("23:45", 30)).toBe("23:45 – 00:15");
    expect(formatApprovalTimes("soon", 30)).toBe("soon");
  });
});
