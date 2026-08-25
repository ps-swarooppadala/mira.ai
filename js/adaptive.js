const STORAGE_KEY = "pranaai.guidance.level";
const EASE_STEP = 0.22;
const TIGHTEN_STEP = 0.07;

const LABELS = [
  { max: 0.15, label: "Precise", note: "holding you close to the textbook shape" },
  { max: 0.45, label: "Balanced", note: "textbook shape, with room to breathe" },
  { max: 0.75, label: "Gentle", note: "meeting your range today" },
  { max: 1.01, label: "Very gentle", note: "shape over precision \u2014 comfort first" },
];

function load() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const n = raw === null || raw === undefined ? NaN : Number(raw);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.25;
  } catch {
    return 0.25;
  }
}

function save(level) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, String(level));
  } catch {
    /* storage blocked (private mode / file://) — adaptation just won't persist */
  }
}

/**
 * Learns how much tolerance this body needs today. Every threshold in every pose is
 * widened in proportion to `level` (0 = textbook, 1 = shape-over-precision), so the
 * coach converges on a target the user can actually reach instead of chasing perfection.
 */
export class Adaptive {
  constructor({ level = load(), onChange } = {}) {
    this._level = Math.min(1, Math.max(0, level));
    this.onChange = onChange ?? (() => {});
  }

  get level() {
    return this._level;
  }

  get label() {
    return LABELS.find((l) => this._level < l.max)?.label ?? "Gentle";
  }

  get note() {
    return LABELS.find((l) => this._level < l.max)?.note ?? "";
  }

  _set(next, reason) {
    const clamped = Math.min(1, Math.max(0, Number(next.toFixed(3))));
    if (clamped === this._level) return false;
    this._level = clamped;
    save(clamped);
    this.onChange(this._level, this.label, reason);
    return true;
  }

  /** The user is struggling — widen what counts as "in the pose". */
  ease(reason = "struggle") {
    return this._set(this._level + EASE_STEP, reason);
  }

  /** The user sailed straight in — ask for a little more precision next time. */
  tighten(reason = "mastery") {
    return this._set(this._level - TIGHTEN_STEP, reason);
  }

  reset() {
    this._set(0.25, "reset");
  }
}

/**
 * Builds the threshold lookup a pose uses per frame: hysteresis (enter vs exit)
 * combined with the learned tolerance, applied via each band's signed `relax`.
 */
export function limiter(prevFlags, level = 0) {
  return (code, band) => {
    const base = prevFlags.has(code) ? band.exit : band.enter;
    return base + (band.relax ?? 0) * level;
  };
}
