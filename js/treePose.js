import { LM, angleAt } from "./angles.js";
import { limiter } from "./adaptive.js";

export const ISSUES = {
  FOOT_TOO_LOW: {
    priority: 1,
    captions: [
      "Draw the lifted foot higher up the inner thigh — and never rest it directly on the knee.",
      "Slide that foot up above the standing knee, and press it gently into the thigh.",
      "A little higher with the foot. If it won't reach the thigh, bring it down to the calf instead \u2014 just skip the knee.",
    ],
  },
  STANDING_LEG_BENT: {
    priority: 2,
    captions: [
      "Straighten your standing leg and root down through that whole foot.",
      "Firm the standing thigh and lengthen the leg tall beneath you.",
      "Press the standing foot into the floor and lift up through the inner arch.",
    ],
  },
  KNEE_NOT_OPEN: {
    priority: 3,
    captions: [
      "Open the lifted knee out to the side, letting the hip rotate gently.",
      "Draw that bent knee wider, opening across the front of the hip.",
      "Guide the lifted knee back and out. Only as far as feels easy.",
    ],
  },
  TORSO_LEANING: {
    priority: 4,
    captions: [
      "Rise up tall — stack your shoulders directly over your hips.",
      "Lengthen the spine and find your centre. Fix your gaze on one still point ahead.",
      "Lift through the crown of the head, letting the shoulders settle down.",
    ],
  },
  HANDS_NOT_TOGETHER: {
    priority: 5,
    captions: [
      "Bring your palms together at your heart, or reach them up overhead like branches.",
      "Draw the hands to meet in the centre \u2014 heart height or above the head, your choice.",
      "Let the palms find each other and press lightly, elbows soft.",
    ],
  },
};

const T = {
  FOOT_HEIGHT: { enter: -0.22, exit: -0.1, relax: -0.22 },
  STANDING_LEG: { enter: 152, exit: 160, relax: -12 },
  KNEE_OPEN: { enter: 0.42, exit: 0.32, relax: -0.22 },
  TORSO_LEAN: { enter: 26, exit: 19, relax: 12 },
  HANDS_TOGETHER: { enter: 0.55, exit: 0.7, relax: 0.35 },
};

const MIN_VISIBILITY = 0.5;

function visible(lm, idx) {
  const p = lm[idx];
  return p && (p.visibility === undefined || p.visibility >= MIN_VISIBILITY);
}

function side(standing) {
  return standing === "left"
    ? { hip: LM.LEFT_HIP, knee: LM.LEFT_KNEE, ankle: LM.LEFT_ANKLE }
    : { hip: LM.RIGHT_HIP, knee: LM.RIGHT_KNEE, ankle: LM.RIGHT_ANKLE };
}
function otherSide(standing) {
  return side(standing === "left" ? "right" : "left");
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function torsoTilt(lm) {
  const shoulder = midpoint(lm[LM.LEFT_SHOULDER], lm[LM.RIGHT_SHOULDER]);
  const hip = midpoint(lm[LM.LEFT_HIP], lm[LM.RIGHT_HIP]);
  const dy = hip.y - shoulder.y;
  if (dy <= 0) return 90;
  return (Math.atan2(Math.abs(shoulder.x - hip.x), dy) * 180) / Math.PI;
}

/** The standing leg is whichever foot is lower in frame (larger y). */
export function detectStandingLeg(lm) {
  const l = lm[LM.LEFT_ANKLE];
  const r = lm[LM.RIGHT_ANKLE];
  if (!l || !r) return null;
  return l.y > r.y ? "left" : "right";
}

/** Loose "is one foot off the floor?" check so a wobbly first attempt still counts. */
export function entryGate(lm) {
  const needed = [
    LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_WRIST, LM.RIGHT_WRIST,
    LM.LEFT_HIP, LM.RIGHT_HIP, LM.LEFT_KNEE, LM.RIGHT_KNEE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
  ];
  if (!needed.every((i) => visible(lm, i))) return false;

  const standing = detectStandingLeg(lm);
  const s = side(standing);
  const o = otherSide(standing);

  const hip = midpoint(lm[LM.LEFT_HIP], lm[LM.RIGHT_HIP]);
  const legLength = Math.abs(lm[s.ankle].y - hip.y) || 0.4;

  // Lifted ankle is clearly off the ground, and the lifted knee is bent.
  const lift = (lm[s.ankle].y - lm[o.ankle].y) / legLength;
  if (lift < 0.25) return false;

  const liftedKnee = angleAt(lm[o.hip], lm[o.knee], lm[o.ankle]);
  return liftedKnee !== null && liftedKnee < 130;
}

export function evaluateTreePose(lm, standing, smoother, prevFlags = new Set(), level = 0) {
  const s = side(standing);
  const o = otherSide(standing);

  const standingLeg = smoother.smooth("standingLeg", angleAt(lm[s.hip], lm[s.knee], lm[s.ankle]));
  const tilt = smoother.smooth("tilt", torsoTilt(lm));

  const hip = midpoint(lm[LM.LEFT_HIP], lm[LM.RIGHT_HIP]);
  const legLength = Math.abs(lm[s.ankle].y - hip.y) || 0.4;
  const hipWidth = Math.hypot(lm[LM.LEFT_HIP].x - lm[LM.RIGHT_HIP].x, lm[LM.LEFT_HIP].y - lm[LM.RIGHT_HIP].y) || 0.15;

  // Positive means the lifted foot is above the standing knee, in leg lengths.
  const footHeight = smoother.smooth("footHeight", (lm[s.knee].y - lm[o.ankle].y) / legLength);
  const kneeOpen = smoother.smooth("kneeOpen", Math.abs(lm[o.knee].x - hip.x) / hipWidth);

  const shoulder = midpoint(lm[LM.LEFT_SHOULDER], lm[LM.RIGHT_SHOULDER]);
  const torsoHeight = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y) || 0.3;
  const handGap = smoother.smooth(
    "handGap",
    Math.hypot(lm[LM.LEFT_WRIST].x - lm[LM.RIGHT_WRIST].x, lm[LM.LEFT_WRIST].y - lm[LM.RIGHT_WRIST].y) / torsoHeight
  );

  const limit = limiter(prevFlags, level);

  const failing = [];
  const footOk = footHeight === null || footHeight >= limit("FOOT_TOO_LOW", T.FOOT_HEIGHT);
  if (!footOk) failing.push("FOOT_TOO_LOW");

  const standingOk = standingLeg === null || standingLeg >= limit("STANDING_LEG_BENT", T.STANDING_LEG);
  if (!standingOk) failing.push("STANDING_LEG_BENT");

  const kneeOpenOk = kneeOpen === null || kneeOpen >= limit("KNEE_NOT_OPEN", T.KNEE_OPEN);
  if (!kneeOpenOk) failing.push("KNEE_NOT_OPEN");

  const torsoOk = tilt === null || tilt <= limit("TORSO_LEANING", T.TORSO_LEAN);
  if (!torsoOk) failing.push("TORSO_LEANING");

  const handsOk = handGap === null || handGap <= limit("HANDS_NOT_TOGETHER", T.HANDS_TOGETHER);
  if (!handsOk) failing.push("HANDS_NOT_TOGETHER");

  failing.sort((a, b) => ISSUES[a].priority - ISSUES[b].priority);

  return {
    issue: failing[0] ?? null,
    flags: new Set(failing),
    values: { standingLeg, tilt, footHeight, kneeOpen, handGap, footOk, standingOk, kneeOpenOk, torsoOk, handsOk },
    metrics: [
      { label: "Standing leg", value: standingLeg, unit: "\u00b0", target: "target 170\u00b0+" },
      { label: "Torso tilt", value: tilt, unit: "\u00b0", target: "under 14\u00b0" },
    ],
    chips: [
      { label: "Foot placed", ok: footOk },
      { label: "Knee open", ok: kneeOpenOk },
      { label: "Palms together", ok: handsOk },
    ],
    frontJointIndex: o.knee,
  };
}

export function jointsForIssue(issueCode, standing) {
  const s = side(standing);
  const o = otherSide(standing);
  switch (issueCode) {
    case "FOOT_TOO_LOW":
      return [o.ankle, s.knee];
    case "STANDING_LEG_BENT":
      return [s.hip, s.knee, s.ankle];
    case "KNEE_NOT_OPEN":
      return [o.hip, o.knee, o.ankle];
    case "TORSO_LEANING":
      return [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP];
    case "HANDS_NOT_TOGETHER":
      return [LM.LEFT_WRIST, LM.RIGHT_WRIST, LM.LEFT_ELBOW, LM.RIGHT_ELBOW];
    default:
      return [];
  }
}

export const treePose = {
  id: "tree",
  name: "Tree Pose",
  sanskrit: "Vrksasana",
  reference: "assets/tree-reference.svg",
  referenceCaption: "Sole of the foot on the inner thigh or calf, knee open, palms together.",
  intro:
    "Wonderful. Last one \u2014 Tree Pose. Root down through one foot, place the other sole on your inner thigh or calf, and bring your palms together.",
  holdTargetMs: 10000,
  issues: ISSUES,
  detectSide: detectStandingLeg,
  entryGate,
  evaluate: evaluateTreePose,
  jointsForIssue,
};
