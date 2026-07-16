import { describe, expect, it } from "vitest";
import {
  addMinutesToTime,
  bookingDurationOptions,
  isPastDate,
  isPastDateTime,
  toDateInputValue,
  toTimeInputValue,
} from "./time";

describe("addMinutesToTime", () => {
  it("calculates the end time from start time and duration", () => {
    expect(addMinutesToTime("10:30", 90)).toBe("12:00");
  });
});

describe("date and time guards", () => {
  const now = new Date("2026-07-13T14:35:00");

  it("formats input values from a date", () => {
    expect(toDateInputValue(now)).toBe("2026-07-13");
    expect(toTimeInputValue(now)).toBe("14:35");
  });

  it("detects dates before today", () => {
    expect(isPastDate("2026-07-12", now)).toBe(true);
    expect(isPastDate("2026-07-13", now)).toBe(false);
    expect(isPastDate("2026-07-14", now)).toBe(false);
  });

  it("detects times before now only on today's date", () => {
    expect(isPastDateTime("2026-07-13", "14:34", now)).toBe(true);
    expect(isPastDateTime("2026-07-13", "14:35", now)).toBe(false);
    expect(isPastDateTime("2026-07-14", "09:00", now)).toBe(false);
  });
});

describe("bookingDurationOptions", () => {
  it("removes durations outside Innovation City operating hours", () => {
    expect(bookingDurationOptions("08:30")).toEqual([]);
    expect(bookingDurationOptions("16:30")).toEqual([{ value: "30", label: "30 minutes" }]);
    expect(bookingDurationOptions("17:00")).toEqual([]);
    expect(bookingDurationOptions("15:00")).toEqual([
      { value: "30", label: "30 minutes" },
      { value: "60", label: "1 hour" },
      { value: "90", label: "1 hour 30 minutes" },
      { value: "120", label: "2 hours" },
    ]);
  });
});
