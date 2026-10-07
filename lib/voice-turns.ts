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
