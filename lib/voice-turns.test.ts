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

import { BACKGROUND_TOOLS, toolHandOff } from "./voice-turns";

describe("toolHandOff", () => {
  it("waits for the result when the reply is only a tool call", () => {
    expect(toolHandOff([{ type: "function_call", name: "create_booking" }])).toBe("wait-for-tool-result");
  });

  it("waits for the result when the assistant spoke AND called a tool in the same reply", () => {
    // The bug: this case used to look like "the assistant finished talking", so the result was never spoken.
    expect(
      toolHandOff([{ type: "message" }, { type: "function_call", name: "check_availability" }]),
    ).toBe("wait-for-tool-result");
  });

  it("hands over to the visitor after a plain spoken reply, or an empty one", () => {
    expect(toolHandOff([{ type: "message" }])).toBe("visitor-turn");
    expect(toolHandOff([])).toBe("visitor-turn");
  });

  it("does not wait for tools that return no follow-up reply", () => {
    expect(BACKGROUND_TOOLS.has("preview_room")).toBe(true);
    expect(toolHandOff([{ type: "message" }, { type: "function_call", name: "preview_room" }])).toBe("visitor-turn");
    expect(toolHandOff([{ type: "function_call", name: "end_conversation" }])).toBe("visitor-turn");
  });

  it("waits if any one of several tool calls needs a result", () => {
    expect(
      toolHandOff([{ type: "function_call", name: "preview_room" }, { type: "function_call", name: "list_my_bookings" }]),
    ).toBe("wait-for-tool-result");
  });
});
