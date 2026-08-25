import { LM, angleAt } from "./angles.js";
import { limiter } from "./adaptive.js";

export const ISSUES = {
  FRONT_KNEE_NOT_BENT_ENOUGH: {
    priority: 1,
    captions: [
      "Bend a little deeper into that front knee — aim for the thigh coming toward parallel with the floor.",
      "Sink a touch lower. Let the front knee travel forward until it stacks over the ankle.",
      "You're close. Step the back foot back another inch, then soften the front knee down.",
    ],
  },
  FRONT_KNEE_OVER_BENT: {
    priority: 1,
    captions: [
      "Ease back slightly — the front knee has travelled past the ankle. Draw the hips back a little.",
      "Lift up just a fraction, so the knee sits directly above the front heel.",
    ],
  },
  TORSO_LEANING: {
    priority: 2,
    captions: [
      "Lift your chest and stack your shoulders over your hips — you're leaning forward.",
      "Draw the lower ribs in and rise up tall through the spine.",
      "Let the tailbone drop and the crown of the head float straight up.",
    ],
  },
  ARMS_NOT_OVERHEAD: {
    priority: 3,
    captions: [
      "Reach both arms up overhead, biceps framing your ears.",
      "Send the fingertips higher — lift the arms all the way up toward the ceiling.",
      "Let the arms rise a little more, shoulders relaxing away from the ears as they go.",
    ],
  },
  ARMS_BENT: {
    priority: 4,
    captions: [
      "Straighten through the elbows and lengthen the arms fully.",
      "Reach long — firm the arms and extend right out through the fingertips.",
    ],
  },
  BACK_LEG_BENT: {
    priority: 5,
    captions: [
      "Straighten that back leg and press down through the back foot.",
      "Firm the back thigh and lengthen the whole back leg behind you.",
    ],
  },
};

const T = {
  KNEE_TOO_STRAIGHT: { enter: 122, exit: 113, relax: 14 },
  KNEE_TOO_BENT: { enter: 66, exit: 73, relax: -10 },
  TORSO_LEAN: { enter: 32, exit: 24, relax: 12 },
  ARMS_OVERHEAD: { enter: 0.45, exit: 0.62, relax: -0.28 },
  ELBOW: { enter: 138, exit: 150, relax: -20 },
  BACK_LEG: { enter: 148, exit: 157, relax: -14 },
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

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Degrees the shoulder-over-hip line is tipped away from vertical. */
function torsoTilt(lm) {
  const shoulder = midpoint(lm[LM.LEFT_SHOULDER], lm[LM.RIGHT_SHOULDER]);
  const hip = midpoint(lm[LM.LEFT_HIP], lm[LM.RIGHT_HIP]);
  const dx = shoulder.x - hip.x;
  const dy = hip.y - shoulder.y;
  if (dy <= 0) return 90;
  return (Math.atan2(Math.abs(dx), dy) * 180) / Math.PI;
}

export function detectFrontLeg(lm) {
  const l = angleAt(lm[LM.LEFT_HIP], lm[LM.LEFT_KNEE], lm[LM.LEFT_ANKLE]);
  const r = angleAt(lm[LM.RIGHT_HIP], lm[LM.RIGHT_KNEE], lm[LM.RIGHT_ANKLE]);
  if (l === null || r === null) return null;
  return l < r ? "left" : "right";
}

/** Loose "is this Warrior I at all?" check: a lunge underneath, arms lifting overhead. */
export function entryGate(lm) {
  const needed = [
    LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_WRIST, LM.RIGHT_WRIST,
    LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
  ];
  if (!needed.every((i) => visible(lm, i))) return false;

  const lKnee = angleAt(lm[LM.LEFT_HIP], lm[LM.LEFT_KNEE], lm[LM.LEFT_ANKLE]);
  const rKnee = angleAt(lm[LM.RIGHT_HIP], lm[LM.RIGHT_KNEE], lm[LM.RIGHT_ANKLE]);
  if (lKnee === null || rKnee === null) return false;

  const oneBent = (lKnee >= 55 && lKnee <= 140) || (rKnee >= 55 && rKnee <= 140);
  const oneStraight = lKnee > 145 || rKnee > 145;
  if (!oneBent || !oneStraight) return false;

  // Both wrists clearly above the shoulders is what separates Warrior I from Warrior II.
  const shoulderY = midpoint(lm[LM.LEFT_SHOULDER], lm[LM.RIGHT_SHOULDER]).y;
  return lm[LM.LEFT_WRIST].y < shoulderY && lm[LM.RIGHT_WRIST].y < shoulderY;
}

export function evaluateWarriorOne(lm, front, smoother, prevFlags = new Set(), level = 0) {
  const f = side(front);
  const b = otherSide(front);

  const frontKnee = smoother.smooth("frontKnee", angleAt(lm[f.hip], lm[f.knee], lm[f.ankle]));
  const backLeg = smoother.smooth("backLeg", angleAt(lm[b.hip], lm[b.knee], lm[b.ankle]));
  const tilt = smoother.smooth("tilt", torsoTilt(lm));

  const shoulder = midpoint(lm[LM.LEFT_SHOULDER], lm[LM.RIGHT_SHOULDER]);
  const hip = midpoint(lm[LM.LEFT_HIP], lm[LM.RIGHT_HIP]);
  const torsoHeight = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y) || 0.3;
  // How far above the shoulders the hands reach, in torso lengths.
  const reachRaw =
    ((shoulder.y - lm[LM.LEFT_WRIST].y) + (shoulder.y - lm[LM.RIGHT_WRIST].y)) / 2 / torsoHeight;
  const reach = smoother.smooth("reach", reachRaw);

  const elbowRaw =
    (angleAt(lm[LM.LEFT_SHOULDER], lm[LM.LEFT_ELBOW], lm[LM.LEFT_WRIST]) +
      angleAt(lm[LM.RIGHT_SHOULDER], lm[LM.RIGHT_ELBOW], lm[LM.RIGHT_WRIST])) /
    2;
  const elbows = smoother.smooth("elbows", elbowRaw);

  const limit = limiter(prevFlags, level);

  const failing = [];
  if (frontKnee !== null) {
    if (frontKnee > limit("FRONT_KNEE_NOT_BENT_ENOUGH", T.KNEE_TOO_STRAIGHT)) {
      failing.push("FRONT_KNEE_NOT_BENT_ENOUGH");
    } else if (frontKnee < limit("FRONT_KNEE_OVER_BENT", T.KNEE_TOO_BENT)) {
      failing.push("FRONT_KNEE_OVER_BENT");
    }
  }

  const torsoOk = tilt === null || tilt <= limit("TORSO_LEANING", T.TORSO_LEAN);
  if (!torsoOk) failing.push("TORSO_LEANING");

  const reachOk = reach === null || reach >= limit("ARMS_NOT_OVERHEAD", T.ARMS_OVERHEAD);
  if (!reachOk) failing.push("ARMS_NOT_OVERHEAD");

  const elbowsOk = elbows === null || elbows >= limit("ARMS_BENT", T.ELBOW);
  if (!elbowsOk) failing.push("ARMS_BENT");

  const backLegOk = backLeg === null || backLeg >= limit("BACK_LEG_BENT", T.BACK_LEG);
  if (!backLegOk) failing.push("BACK_LEG_BENT");

  failing.sort((a, b2) => ISSUES[a].priority - ISSUES[b2].priority);

  return {
    issue: failing[0] ?? null,
    flags: new Set(failing),
    values: { frontKnee, backLeg, tilt, reach, elbows, torsoOk, reachOk, elbowsOk, backLegOk },
    metrics: [
      { label: "Front knee", value: frontKnee, unit: "\u00b0", target: "target 90\u00b0" },
      { label: "Back leg", value: backLeg, unit: "\u00b0", target: "target 170\u00b0+" },
      { label: "Torso tilt", value: tilt, unit: "\u00b0", target: "under 20\u00b0" },
    ],
    chips: [
      { label: "Arms overhead", ok: reachOk },
      { label: "Elbows straight", ok: elbowsOk },
      { label: "Chest lifted", ok: torsoOk },
    ],
    frontJointIndex: f.knee,
  };
}

export function jointsForIssue(issueCode, front) {
  const f = side(front);
  const b = otherSide(front);
  switch (issueCode) {
    case "FRONT_KNEE_NOT_BENT_ENOUGH":
    case "FRONT_KNEE_OVER_BENT":
      return [f.hip, f.knee, f.ankle];
    case "TORSO_LEANING":
      return [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP];
    case "ARMS_NOT_OVERHEAD":
    case "ARMS_BENT":
      return [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST, LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST];
    case "BACK_LEG_BENT":
      return [b.hip, b.knee, b.ankle];
    default:
      return [];
  }
}

export const warriorOne = {
  id: "warrior1",
  name: "Warrior I",
  sanskrit: "Virabhadrasana I",
  reference: "assets/warrior1-reference.svg",
  referenceCaption: "Hips squared forward, front knee ~90\u00b0, both arms reaching straight overhead.",
  intro:
    "Beautiful. Now let's move into Warrior One. Turn your hips to face forward, keep that front knee bent, and sweep both arms up overhead.",
  holdTargetMs: 10000,
  issues: ISSUES,
  detectSide: detectFrontLeg,
  entryGate,
  evaluate: evaluateWarriorOne,
  jointsForIssue,
};
