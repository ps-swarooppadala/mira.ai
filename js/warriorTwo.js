import { LM, angleAt } from "./angles.js";
import { limiter } from "./adaptive.js";

// --- Issue codes, in priority order (only the highest-priority failing check is ever surfaced) ---
// Each issue carries several phrasings so a repeated cue never sounds like a stuck recording;
// later entries get progressively more specific, the way a live teacher escalates.
export const ISSUES = {
  FRONT_KNEE_NOT_BENT_ENOUGH: {
    priority: 1,
    captions: [
      "Step your back foot back a little, then sink into that front knee until the thigh feels closer to parallel with the floor.",
      "A little deeper in the front knee — imagine sitting down into an invisible chair behind you.",
      "You're close. Widen the stance an inch or two, and let the hips drop just a touch lower.",
      "Almost there. On your next exhale, melt that front knee down slowly. No rush.",
    ],
  },
  FRONT_KNEE_OVER_BENT: {
    priority: 1,
    captions: [
      "Ease up just a touch — lean back slightly and let that front knee come back toward ninety degrees.",
      "You've gone a little past ninety. Lift the hips a fraction so the knee stacks right over the ankle.",
      "Just a hair less depth — draw your weight back into the back heel.",
    ],
  },
  FRONT_KNEE_CAVING_IN: {
    priority: 2,
    captions: [
      "Gently guide your front knee back over your ankle — it's drifting inward.",
      "Press the outer edge of your front foot down, and let the knee track toward your little toe.",
      "Open that front knee out a touch, so it lines up right above the ankle.",
    ],
  },
  ARMS_NOT_LEVEL: {
    priority: 3,
    captions: [
      "Float your arms up level with the floor, and reach softly out through your fingertips.",
      "Lift the arms a little — shoulder height, palms facing down, shoulders staying soft.",
      "Let the arms find one long line, parallel to the ground. Reach front and back at once.",
    ],
  },
  BACK_LEG_BENT: {
    priority: 4,
    captions: [
      "Straighten that back leg and press evenly through the outer edge of your back foot.",
      "Send some energy down the back leg — firm the thigh, ground the back heel.",
      "Lengthen through the back leg, keeping it strong and straight behind you.",
    ],
  },
};

/**
 * Enter/exit thresholds for every check. A fault has to be clearly present to be
 * raised (`enter`), but only has to be roughly fixed to clear (`exit`) — that gap is
 * what stops the coach flickering on borderline poses. `relax` is the signed shift
 * applied at full adaptive tolerance, so a stiff body still gets a reachable target.
 */
const T = {
  KNEE_TOO_STRAIGHT: { enter: 119, exit: 111, relax: 14 },
  KNEE_TOO_BENT: { enter: 66, exit: 73, relax: -10 },
  KNEE_ALIGN: { enter: 0.32, exit: 0.24, relax: 0.14 },
  ARMS: { enter: 0.22, exit: 0.17, relax: 0.1 },
  BACK_LEG: { enter: 150, exit: 158, relax: -12 },
};

const MIN_VISIBILITY = 0.5;

function visible(lm, idx) {
  const p = lm[idx];
  return p && (p.visibility === undefined || p.visibility >= MIN_VISIBILITY);
}

function side(front) {
  return front === "left"
    ? { hip: LM.LEFT_HIP, knee: LM.LEFT_KNEE, ankle: LM.LEFT_ANKLE }
    : { hip: LM.RIGHT_HIP, knee: LM.RIGHT_KNEE, ankle: LM.RIGHT_ANKLE };
}
function otherSide(front) {
  return side(front === "left" ? "right" : "left");
}

/** Whichever leg is more bent right now is treated as the front leg. Call once at pose-entry. */
export function detectFrontLeg(lm) {
  const l = angleAt(lm[LM.LEFT_HIP], lm[LM.LEFT_KNEE], lm[LM.LEFT_ANKLE]);
  const r = angleAt(lm[LM.RIGHT_HIP], lm[LM.RIGHT_KNEE], lm[LM.RIGHT_ANKLE]);
  if (l === null || r === null) return null;
  return l < r ? "left" : "right";
}

/**
 * Coarse check that the user is roughly in a Warrior-II-shaped stance at all,
 * so we don't coach someone who is just standing in frame.
 */
export function entryGate(lm) {
  const needed = [
    LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_WRIST, LM.RIGHT_WRIST,
    LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
  ];
  if (!needed.every((i) => visible(lm, i))) return false;

  const lKnee = angleAt(lm[LM.LEFT_HIP], lm[LM.LEFT_KNEE], lm[LM.LEFT_ANKLE]);
  const rKnee = angleAt(lm[LM.RIGHT_HIP], lm[LM.RIGHT_KNEE], lm[LM.RIGHT_ANKLE]);
  if (lKnee === null || rKnee === null) return false;

  const oneBent = (lKnee >= 50 && lKnee <= 148) || (rKnee >= 50 && rKnee <= 148);
  const oneStraight = lKnee > 138 || rKnee > 138;
  if (!oneBent || !oneStraight) return false;

  // Arms roughly raised toward shoulder height (not hanging at the sides).
  const shoulderY = (lm[LM.LEFT_SHOULDER].y + lm[LM.RIGHT_SHOULDER].y) / 2;
  const hipY = (lm[LM.LEFT_HIP].y + lm[LM.RIGHT_HIP].y) / 2;
  const torsoHeight = Math.abs(hipY - shoulderY) || 0.2;
  const armsRaised =
    Math.abs(lm[LM.LEFT_WRIST].y - shoulderY) < torsoHeight * 1.3 &&
    Math.abs(lm[LM.RIGHT_WRIST].y - shoulderY) < torsoHeight * 1.3;

  return armsRaised;
}

/**
 * Runs the priority checks and returns the single highest-priority failing issue,
 * plus the raw values needed for the UI read-out.
 *
 * `prevFlags` is the set of issues that were already active last frame; passing it
 * back in is what activates the hysteresis bands in `T`. `level` is the learned
 * tolerance (0 = textbook, 1 = shape over precision).
 */
export function evaluateWarriorTwo(lm, front, smoother, prevFlags = new Set(), level = 0) {
  const f = side(front);
  const b = otherSide(front);

  const frontKneeRaw = angleAt(lm[f.hip], lm[f.knee], lm[f.ankle]);
  const backLegRaw = angleAt(lm[b.hip], lm[b.knee], lm[b.ankle]);
  const frontKnee = smoother.smooth("frontKnee", frontKneeRaw);
  const backLeg = smoother.smooth("backLeg", backLegRaw);

  const hipWidth = Math.hypot(lm[LM.LEFT_HIP].x - lm[LM.RIGHT_HIP].x, lm[LM.LEFT_HIP].y - lm[LM.RIGHT_HIP].y) || 0.15;
  const kneeAlignRaw = (lm[f.knee].x - lm[f.ankle].x) / hipWidth;
  const kneeAlign = smoother.smooth("kneeAlign", kneeAlignRaw);

  const torsoHeight =
    Math.hypot(
      (lm[LM.LEFT_SHOULDER].x + lm[LM.RIGHT_SHOULDER].x) / 2 - (lm[LM.LEFT_HIP].x + lm[LM.RIGHT_HIP].x) / 2,
      (lm[LM.LEFT_SHOULDER].y + lm[LM.RIGHT_SHOULDER].y) / 2 - (lm[LM.LEFT_HIP].y + lm[LM.RIGHT_HIP].y) / 2
    ) || 0.3;
  const armsRaw =
    (Math.abs(lm[LM.LEFT_SHOULDER].y - lm[LM.LEFT_WRIST].y) + Math.abs(lm[LM.RIGHT_SHOULDER].y - lm[LM.RIGHT_WRIST].y)) /
    2 /
    torsoHeight;
  const armsLevel = smoother.smooth("armsLevel", armsRaw);

  const limit = limiter(prevFlags, level);

  const failing = [];
  if (frontKnee !== null) {
    if (frontKnee > limit("FRONT_KNEE_NOT_BENT_ENOUGH", T.KNEE_TOO_STRAIGHT)) {
      failing.push("FRONT_KNEE_NOT_BENT_ENOUGH");
    } else if (frontKnee < limit("FRONT_KNEE_OVER_BENT", T.KNEE_TOO_BENT)) {
      failing.push("FRONT_KNEE_OVER_BENT");
    }
  }
  const kneeAlignOk = kneeAlign === null || Math.abs(kneeAlign) <= limit("FRONT_KNEE_CAVING_IN", T.KNEE_ALIGN);
  if (!kneeAlignOk) failing.push("FRONT_KNEE_CAVING_IN");

  const armsOk = armsLevel === null || armsLevel <= limit("ARMS_NOT_LEVEL", T.ARMS);
  if (!armsOk) failing.push("ARMS_NOT_LEVEL");

  const backLegOk = backLeg === null || backLeg >= limit("BACK_LEG_BENT", T.BACK_LEG);
  if (!backLegOk) failing.push("BACK_LEG_BENT");

  failing.sort((a, b2) => ISSUES[a].priority - ISSUES[b2].priority);

  return {
    issue: failing[0] ?? null,
    flags: new Set(failing),
    values: { frontKnee, backLeg, kneeAlignOk, armsOk, backLegOk },
    metrics: [
      { label: "Front knee", value: frontKnee, unit: "\u00b0", target: "target 90\u00b0" },
      { label: "Back leg", value: backLeg, unit: "\u00b0", target: "target 175\u00b0+" },
    ],
    chips: [
      { label: "Knee alignment", ok: kneeAlignOk },
      { label: "Arms level", ok: armsOk },
    ],
    frontJointIndex: f.knee,
  };
}

/** Landmarks to light up on the skeleton overlay for a given fault. */
export function jointsForIssue(issueCode, front) {
  const f = side(front);
  const b = otherSide(front);
  switch (issueCode) {
    case "FRONT_KNEE_NOT_BENT_ENOUGH":
    case "FRONT_KNEE_OVER_BENT":
    case "FRONT_KNEE_CAVING_IN":
      return [f.hip, f.knee, f.ankle];
    case "ARMS_NOT_LEVEL":
      return [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST, LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST];
    case "BACK_LEG_BENT":
      return [b.hip, b.knee, b.ankle];
    default:
      return [];
  }
}

export const warriorTwo = {
  id: "warrior2",
  name: "Warrior II",
  sanskrit: "Virabhadrasana II",
  reference: "assets/warrior2-reference.svg",
  referenceCaption: "Front knee bent ~90\u00b0, back leg straight, arms level with the floor.",
  intro:
    "Let's begin with Warrior Two. Step your feet wide apart, turn your front foot out, and float your arms up level with the floor.",
  holdTargetMs: 10000,
  issues: ISSUES,
  detectSide: detectFrontLeg,
  entryGate,
  evaluate: evaluateWarriorTwo,
  jointsForIssue,
};
