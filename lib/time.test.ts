import { describe, expect, it } from "vitest";
import { addMinutesToTime } from "./time";

describe("addMinutesToTime", () => {
  it("calculates the end time from start time and duration", () => {
    expect(addMinutesToTime("10:30", 90)).toBe("12:00");
  });
});
