import { describe, expect, it } from "vitest";
import { nextStepAfterRecognition } from "./flow";

describe("nextStepAfterRecognition", () => {
  it("sends recognized visitors to welcome back", () => {
    expect(nextStepAfterRecognition(true)).toBe("welcome-back");
  });

  it("sends unrecognized visitors to profile lookup", () => {
    expect(nextStepAfterRecognition(false)).toBe("profile-lookup");
  });
});
