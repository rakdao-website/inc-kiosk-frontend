import { describe, expect, it } from "vitest";

import { decideSpeechEnd, shouldArmInterrupt, shouldInterruptNow } from "./voice-turns";

describe("decideSpeechEnd", () => {
  it("never treats sound during the assistant's reply as a new turn", () => {
    expect(decideSpeechEnd({ assistantSpeaking: true, durationMs: 5000, minRealSpeechMs: 400 })).toBe(
      "ignore-while-assistant-talks",
    );
  });

  it("ignores a short blip when the assistant is quiet", () => {
    expect(decideSpeechEnd({ assistantSpeaking: false, durationMs: 150, minRealSpeechMs: 400 })).toBe("ignore-blip");
  });

  it("takes real speech as the visitor's turn when the assistant is quiet", () => {
    expect(decideSpeechEnd({ assistantSpeaking: false, durationMs: 400, minRealSpeechMs: 400 })).toBe("take-turn");
    expect(decideSpeechEnd({ assistantSpeaking: false, durationMs: 2500, minRealSpeechMs: 400 })).toBe("take-turn");
  });
});

describe("interrupting the assistant", () => {
  it("arms only when the assistant is talking and interruptions are allowed", () => {
    expect(shouldArmInterrupt({ assistantSpeaking: true, allowInterruptions: true })).toBe(true);
    expect(shouldArmInterrupt({ assistantSpeaking: true, allowInterruptions: false })).toBe(false);
    expect(shouldArmInterrupt({ assistantSpeaking: false, allowInterruptions: true })).toBe(false);
  });

  it("interrupts only if the visitor is still speaking when the timer fires", () => {
    expect(shouldInterruptNow({ visitorStillSpeaking: true, assistantSpeaking: true })).toBe(true);
    expect(shouldInterruptNow({ visitorStillSpeaking: false, assistantSpeaking: true })).toBe(false); // it was a short noise
    expect(shouldInterruptNow({ visitorStillSpeaking: true, assistantSpeaking: false })).toBe(false); // it already finished
  });
});
