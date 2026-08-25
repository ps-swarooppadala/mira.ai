export function successLineFor(pose) {
  return `Beautiful \u2014 that's ${pose.name}. Now just breathe and hold.`;
}

export function releaseLineFor(heldMs) {
  return `And release. You held that for ${(heldMs / 1000).toFixed(1)} seconds \u2014 lovely work.`;
}

/** Spoken the moment a pose's hold target is reached. */
export function completionLineFor(pose, heldMs, isLast) {
  const secs = Math.round(heldMs / 1000);
  const opener = `That's ${secs} seconds in ${pose.name}. Beautifully held.`;
  const relax = "Come out whenever you're ready \u2014 no rush at all. Shake the legs out and take a slow breath.";
  return isLast ? `${opener} ${relax}` : `${opener} ${relax} I'll set up the next pose for you.`;
}

export const SESSION_COMPLETE_LINE =
  "That's your flow complete. Three poses, all held with steady breath. Stand tall, close your eyes for a moment, and notice how you feel. Namaste.";

/** Spoken the first time the coach widens its tolerance, so the shift feels intentional. */
const ADAPT_LINES = {
  time: "Let's not chase perfection. I'm adjusting to your body today \u2014 come to where the shape feels good, and we'll hold it there.",
  repeat: "No problem at all. I'll meet you where you are \u2014 move toward the shape, and that's plenty.",
};

export function adaptationLineFor(reason) {
  return ADAPT_LINES[reason] ?? null;
}

/** Spoken while the pose is held correctly, keyed by elapsed whole seconds. */
const HOLD_ENCOURAGEMENT = {
  5: "Five seconds. Soften your shoulders, and keep breathing.",
  10: "Ten seconds \u2014 you're steady. Stay with me a little longer.",
  15: "Fifteen. Let the breath be slow and even. You're doing beautifully.",
  20: "Twenty seconds. Strong through the legs, light through your fingertips.",
  30: "Half a minute. That's real strength \u2014 just a few more breaths.",
  45: "Forty five seconds. Soft in the face, steady in the legs.",
  60: "A full minute. That's wonderful. Come out whenever you're ready.",
};

const GENERIC_ENCOURAGEMENT = [
  "Still with you. Nice and slow.",
  "Gorgeous hold — stay a little longer.",
  "Strong and calm. That's exactly it.",
];

export function encouragementFor(seconds) {
  return (
    HOLD_ENCOURAGEMENT[seconds] ??
    GENERIC_ENCOURAGEMENT[Math.floor(seconds / 15) % GENERIC_ENCOURAGEMENT.length]
  );
}

// ---------- Voice selection ----------
// Browser voices vary a lot in warmth; prefer the known-natural neural voices
// (Microsoft Online Natural, Google, Apple) before falling back to the default.
const PREFERRED_VOICES = [
  "Microsoft Aria Online (Natural) - English (United States)",
  "Microsoft Jenny Online (Natural) - English (United States)",
  "Microsoft Sonia Online (Natural) - English (United Kingdom)",
  "Microsoft Aria",
  "Google UK English Female",
  "Google US English",
  "Samantha",
  "Karen",
  "Microsoft Zira - English (United States)",
];

let cachedVoice = null;

function pickVoice() {
  if (cachedVoice) return cachedVoice;
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  for (const name of PREFERRED_VOICES) {
    const match = voices.find((v) => v.name === name) || voices.find((v) => v.name.includes(name));
    if (match) return (cachedVoice = match);
  }
  cachedVoice =
    voices.find((v) => v.lang.startsWith("en") && /natural|online|female/i.test(v.name)) ||
    voices.find((v) => v.lang.startsWith("en")) ||
    voices[0];
  return cachedVoice;
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  // Chrome populates the voice list asynchronously.
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {
    cachedVoice = null;
    pickVoice();
  });
  pickVoice();
}

export function getVoiceName() {
  return pickVoice()?.name ?? "system default";
}

/**
 * Speaks a coaching line in a calm, unhurried tone.
 * `interrupt: false` lets gentle encouragement queue politely behind whatever is
 * already being said, so we never clip a correction mid-sentence.
 */
export function speak(text, { onStart, onEnd, interrupt = true, rate = 0.9, pitch = 1.08 } = {}) {
  if (!("speechSynthesis" in window)) return;
  if (interrupt) window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  if (voice) {
    utter.voice = voice;
    utter.lang = voice.lang;
  }
  utter.rate = rate;
  utter.pitch = pitch;
  utter.volume = 1;
  if (onStart) utter.onstart = onStart;
  if (onEnd) {
    utter.onend = onEnd;
    utter.onerror = onEnd;
  }
  window.speechSynthesis.speak(utter);
}

export function captionFor(pose, issueCode, repeat = 0) {
  if (!issueCode) return successLineFor(pose);
  const captions = pose?.issues?.[issueCode]?.captions;
  if (!captions?.length) return "Adjust your form.";
  const line = captions[repeat % captions.length];
  // Once we've cycled the whole list, soften the ask rather than nagging again.
  return repeat >= captions.length ? `${PATIENCE_PREFIXES[repeat % PATIENCE_PREFIXES.length]} ${line}` : line;
}

const PATIENCE_PREFIXES = [
  "No rush at all.",
  "Take a breath here.",
  "You're doing fine \u2014",
];

/**
 * Stretch goal hook (see spec §6): call an LLM for warmer phrasing, with a hard
 * timeout and automatic fallback to the static caption table. Not wired up by
 * default — call this instead of `captionFor()` if you add a coaching endpoint.
 */
export async function getCoachingLine(issueCode, values, { timeoutMs = 1500, fetchLine, pose } = {}) {
  const fallback = captionFor(pose, issueCode);
  if (!fetchLine) return fallback;
  try {
    const line = await Promise.race([
      fetchLine(issueCode, values),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    return line || fallback;
  } catch {
    return fallback;
  }
}
