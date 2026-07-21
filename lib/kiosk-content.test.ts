import { describe, expect, it } from "vitest";
import { centerRoomOptions, kioskSteps } from "./kiosk-content";

describe("kiosk content", () => {
  it("uses the approved Explore the Center options", () => {
    expect(centerRoomOptions.map((option) => option.title)).toEqual([
      "Meeting Rooms",
      "Offices",
      "Podcast Studio",
      "TikTok Studio",
      "Business Center",
    ]);
  });

  it("does not include the removed packages step", () => {
    expect(kioskSteps).not.toContain("packages");
  });
});
