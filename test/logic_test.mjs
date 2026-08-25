import { PoseCoach, STATES } from "../js/stateMachine.js";
import { Adaptive } from "../js/adaptive.js";
import { warriorTwo } from "../js/warriorTwo.js";
import { treePose } from "../js/treePose.js";
import { LM } from "../js/angles.js";

const D2R = Math.PI / 180;

/**
 * Places hip/knee/ankle so the knee vertex angle is exactly `angleDeg`, with the
 * ankle directly below the knee (perfect alignment) so each test isolates a single
 * variable instead of confounding angle + alignment.
 */
function legAt(knee, angleDeg, legLen) {
  // v2 (ankle direction from knee) is (0, 1) (straight down), so for the vertex angle
  // to equal `angleDeg`, v1.y must equal cos(angleDeg) (dot product of unit vectors).
  const v1 = { x: Math.sin(angleDeg * D2R), y: Math.cos(angleDeg * D2R) }; // hip direction
  const hip = { x: knee.x + legLen * v1.x, y: knee.y + legLen * v1.y };
  const ankle = { x: knee.x, y: knee.y + legLen };
  return { hip, ankle };
}

function makeLandmarks({ frontKneeAngleDeg, armsLevel = true }) {
  const lm = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.5, visibility: 1 }));

  lm[LM.LEFT_SHOULDER] = { x: 0.4, y: 0.25, visibility: 1 };
  lm[LM.RIGHT_SHOULDER] = { x: 0.6, y: 0.25, visibility: 1 };

  const armY = armsLevel ? 0.25 : 0.45;
  lm[LM.LEFT_WRIST] = { x: 0.15, y: armY, visibility: 1 };
  lm[LM.RIGHT_WRIST] = { x: 0.85, y: armY, visibility: 1 };
  lm[LM.LEFT_ELBOW] = { x: 0.28, y: 0.25, visibility: 1 };
  lm[LM.RIGHT_ELBOW] = { x: 0.72, y: 0.25, visibility: 1 };

  // Front leg (right side): knee angle under test, ankle perfectly under the knee.
  const front = legAt({ x: 0.62, y: 0.68 }, frontKneeAngleDeg, 0.2);
  lm[LM.RIGHT_HIP] = front.hip;
  lm[LM.RIGHT_KNEE] = { x: 0.62, y: 0.68 };
  lm[LM.RIGHT_ANKLE] = front.ankle;

  // Back leg (left side): straight (178deg).
  const back = legAt({ x: 0.4, y: 0.7 }, 178, 0.2);
  lm[LM.LEFT_HIP] = back.hip;
  lm[LM.LEFT_KNEE] = { x: 0.4, y: 0.7 };
  lm[LM.LEFT_ANKLE] = back.ankle;

  return lm;
}

function run() {
  const events = [];
  const coach = new PoseCoach({
    sequence: [warriorTwo, treePose],
    adaptive: new Adaptive({ level: 0.2 }),
    onStateChange: (s) => events.push(`STATE:${s}`),
    onCoach: (issue, repeat) => events.push(`COACH:${issue}#${repeat}`),
    onCorrect: () => events.push("CORRECT"),
    onEncourage: (sec) => events.push(`ENCOURAGE:${sec}`),
    onRelease: (ms) => events.push(`RELEASE:${Math.round(ms)}`),
    onPoseStart: (pose) => events.push(`POSE_START:${pose.id}`),
    onPoseComplete: (pose, ms) => events.push(`POSE_DONE:${pose.id}@${Math.round(ms)}`),
    onSessionComplete: () => events.push("SESSION_DONE"),
    onAdapt: (level, label, reason) => events.push(`ADAPT:${reason}@${level}`),
  });
  coach.start();

  let now = 0;
  const step = (ms, lm) => {
    now += ms;
    return coach.tick(lm, now);
  };
  const assert = (cond, msg) => {
    if (!cond) throw new Error("ASSERTION FAILED: " + msg);
    console.log("  ok:", msg);
  };

  // 1) No pose for a bit -> should stay NO_POSE
  for (let i = 0; i < 3; i++) step(33, null);
  assert(coach.state === STATES.NO_POSE, "starts NO_POSE with no landmarks");

  // 2) Enter pose with knee at 127deg (bent enough to be recognized as Warrior II,
  //    but not bent enough to pass the knee check) -> COACHING(FRONT_KNEE_NOT_BENT_ENOUGH).
  //    The cue itself only lands after the fault has persisted for CONFIRM_MS.
  const shallowKnee = makeLandmarks({ frontKneeAngleDeg: 127 });
  let snap;
  for (let i = 0; i < 3; i++) snap = step(33, shallowKnee);
  assert(snap.state === STATES.COACHING, `enters COACHING (got ${snap.state})`);
  assert(snap.issue === "FRONT_KNEE_NOT_BENT_ENOUGH", `flags shallow knee (got ${snap.issue})`);
  assert(snap.waitRemainingMs > 0, "wait timer is running");
  assert(
    events.filter((e) => e.startsWith("COACH:")).length === 0,
    "stays quiet until the fault is confirmed"
  );

  for (let i = 0; i < 25; i++) snap = step(33, shallowKnee); // past CONFIRM_MS
  assert(events.includes("COACH:FRONT_KNEE_NOT_BENT_ENOUGH#0"), "speaks the first phrasing once confirmed");

  // 3) Keep feeding the SAME bad pose for ~4.5s -> no repeat inside the re-cue cooldown
  const coachCountBefore = events.filter((e) => e.startsWith("COACH:")).length;
  for (let i = 0; i < 45; i++) snap = step(100, shallowKnee);
  assert(snap.state === STATES.COACHING, "still COACHING");
  const coachCountAfter = events.filter((e) => e.startsWith("COACH:")).length;
  assert(coachCountAfter === coachCountBefore, "does not repeat the cue inside the cooldown");

  // 4) Past the 9s re-cue cooldown -> cues again, with the NEXT phrasing, not the same one
  for (let i = 0; i < 60; i++) snap = step(100, shallowKnee);
  assert(
    events.includes("COACH:FRONT_KNEE_NOT_BENT_ENOUGH#1"),
    `re-cues with a different phrasing (log: ${events.filter((e) => e.startsWith("COACH:")).join(", ")})`
  );
  assert(
    events.filter((e) => e === "COACH:FRONT_KNEE_NOT_BENT_ENOUGH#0").length === 1,
    "never repeats the identical sentence"
  );

  // 4b) Having to repeat itself teaches the coach to widen the target
  assert(
    events.some((e) => e.startsWith("ADAPT:repeat")),
    `eases the target after a repeated cue (log: ${events.filter((e) => e.startsWith("ADAPT")).join(", ")})`
  );
  assert(coach.adaptive.level > 0.2, `tolerance widened (level ${coach.adaptive.level})`);
  assert(coach.adaptive.level <= 1, "tolerance stays clamped");

  // 5) Fix the pose (90deg, arms level) -> HOLDING_CORRECT, then the 10s hold target
  const goodPose = makeLandmarks({ frontKneeAngleDeg: 90, armsLevel: true });
  let fixedSnap;
  let sawHolding = false;
  let peakHoldMs = 0;
  for (let i = 0; i < 250 && coach.state !== STATES.POSE_COMPLETE; i++) {
    fixedSnap = step(100, goodPose);
    if (fixedSnap.state === STATES.HOLDING_CORRECT) sawHolding = true;
    peakHoldMs = Math.max(peakHoldMs, fixedSnap.holdMs);
  }
  assert(sawHolding, `reaches HOLDING_CORRECT (last state ${fixedSnap.state}, issue=${fixedSnap.issue})`);
  assert(events.includes("CORRECT"), "CORRECT event fired");
  assert(peakHoldMs >= 9000, `hold timer counts up to the target (peaked at ${Math.round(peakHoldMs)}ms)`);
  assert(events.includes("ENCOURAGE:5"), "5s encouragement fired");
  assert(!events.includes("ENCOURAGE:10"), "no encouragement on the finish line \u2014 the completion line covers it");

  // 6) Hitting the 10s target completes the pose and drops into a rest
  assert(coach.state === STATES.POSE_COMPLETE, `enters POSE_COMPLETE (got ${coach.state})`);
  assert(
    events.some((e) => e.startsWith("POSE_DONE:warrior2@10")),
    `announces the completed hold (log: ${events.filter((e) => e.startsWith("POSE_DONE")).join(", ")})`
  );
  assert(coach.bestHoldMs >= 9000, `best hold is banked (got ${Math.round(coach.bestHoldMs)}ms)`);

  // 7) The rest ignores the body, then the next pose is introduced automatically
  let restSnap = step(100, goodPose);
  assert(restSnap.state === STATES.POSE_COMPLETE, "stays resting while the user shakes it out");
  assert(restSnap.restRemainingMs > 0, "rest countdown is running");
  for (let i = 0; i < 12 && coach.state === STATES.POSE_COMPLETE; i++) restSnap = step(1000, null);
  assert(events.includes("POSE_START:tree"), "advances to the next pose in the sequence");
  assert(coach.poseIndex === 1, `pose index advanced (got ${coach.poseIndex})`);
  assert(restSnap.state === STATES.NO_POSE, `waits for the next pose (got ${restSnap.state})`);
  assert(restSnap.holdMs === 0, "hold timer resets for the new pose");

  console.log("\nAll assertions passed.");
  console.log("Event log:", events.join(" -> "));
}

run();
