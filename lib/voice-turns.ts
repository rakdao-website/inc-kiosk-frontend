/* Turn-taking rules for the voice assistant, kept free of React and audio so they can be tested.

   The server only reports "speech started" and "speech stopped". What those mean depends on
   whether the assistant was talking at the time:
   - while it talks, short sounds (a cough, a tap, its own voice coming back) must neither cut
     it off nor start a second reply; only speech that lasts `interruptMinMs` interrupts it;
   - while it is silent, a sound shorter than `minRealSpeechMs` is noise, anything longer is
     the visitor's turn. */

export type SpeechEndDecision = "ignore-while-assistant-talks" | "ignore-blip" | "take-turn";

/** What to do when a stretch of detected speech ends. */
export function decideSpeechEnd(input: {
  assistantSpeaking: boolean;
  durationMs: number;
  minRealSpeechMs: number;
}): SpeechEndDecision {
  if (input.assistantSpeaking) return "ignore-while-assistant-talks";
  if (input.durationMs < input.minRealSpeechMs) return "ignore-blip";
  return "take-turn";
}

/** Should a started stretch of speech arm the "interrupt the assistant" timer? */
export function shouldArmInterrupt(input: { assistantSpeaking: boolean; allowInterruptions: boolean }): boolean {
  return input.assistantSpeaking && input.allowInterruptions;
}

/** Should the assistant be interrupted when the timer fires? Only if the visitor is still
 *  speaking and the assistant is still talking. */
export function shouldInterruptNow(input: { visitorStillSpeaking: boolean; assistantSpeaking: boolean }): boolean {
  return input.visitorStillSpeaking && input.assistantSpeaking;
}

/* Tool calls. The assistant often says something ("Let me check that") and calls a tool in the
   same reply. Once the tool has run, the assistant makes a SECOND reply with the result. That
   second reply must not be cancelled as "unrequested", or the visitor hears nothing until they
   speak again. */

/** Tools whose result does not start a follow-up reply (the app returns them as background results). */
export const BACKGROUND_TOOLS: ReadonlySet<string> = new Set(["preview_room", "end_conversation"]);

export type ToolHandOff = "wait-for-tool-result" | "visitor-turn";

/** After a reply finishes: is the assistant about to speak again with a tool's result, or is it
 *  the visitor's turn? Any non-background tool call anywhere in the reply means "wait". */
export function toolHandOff(outputItems: ReadonlyArray<{ type?: string; name?: string }>): ToolHandOff {
  const waitsForResult = outputItems.some((item) => item?.type === "function_call" && !BACKGROUND_TOOLS.has(item.name ?? ""));
  return waitsForResult ? "wait-for-tool-result" : "visitor-turn";
}
