import { describe, expect, it } from "vitest";
import { temporaryRecognitionChoices, nextStepAfterRecognition } from "./flow";

describe("nextStepAfterRecognition", () => {
  it("sends recognized visitors to welcome back", () => {
    expect(nextStepAfterRecognition(true)).toBe("welcome-back");
  });

  it("sends unrecognized visitors to profile lookup", () => {
    expect(nextStepAfterRecognition(false)).toBe("profile-lookup");
  });
});

describe("temporaryRecognitionChoices", () => {
  it("exposes temporary buttons that follow the face recognition flow", () => {
    expect(temporaryRecognitionChoices).toEqual([
      {
        id: "recognized",
        label: "Face Recognized (Temp)",
        nextStep: "welcome-back",
        simulateMobileNumber: "+971501234567",
      },
      {
        id: "not-recognized",
        label: "Face Not Recognized (Temp)",
        nextStep: "profile-lookup",
      },
    ]);
  });
});
