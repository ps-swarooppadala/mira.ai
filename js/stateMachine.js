import { Smoother } from "./angles.js";
import { SEQUENCE } from "./poses.js";
import { Adaptive } from "./adaptive.js";

export const STATES = {
  NO_POSE: "NO_POSE",
  EVALUATING: "EVALUATING",
  COACHING: "COACHING",
  RECHECKING: "RECHECKING",
  HOLDING_CORRECT: "HOLDING_CORRECT",
  POSE_COMPLETE: "POSE_COMPLETE",
  SESSION_COMPLETE: "SESSION_COMPLETE",
};

const WAIT_MS = 4000;
const POSE_LOSS_FRAMES = 10;

/** The same cue is never repeated more often than this — silence beats nagging. */
const RECUE_SAME_MS = 9000;
/** Even when the fault changes, leave a beat so cues don't stack on top of each other. */
const MIN_CUE_GAP_MS = 3500;
/** A fault must persist this long before it's spoken, so momentary wobble stays quiet. */
const CONFIRM_MS = 700;
/** Breathing room between finishing one pose and being set up for the next. */
const REST_MS = 9000;
/** If a pose still isn't landing after this long, stop asking for precision. */
const STRUGGLE_MS = 18000;
/** Getting it this fast means we can ask for a touch more precision next time. */
const EASY_WIN_MS = 6000;

/** Seconds of a clean hold at which the coach offers a word of encouragement. */
const ENCOURAGEMENT_SECONDS = [5, 10, 15, 20, 30, 45, 60, 75, 90, 120];

export class PoseCoach {
  constructor({
    sequence = SEQUENCE,
    adaptive,
    onStateChange,
    onCoach,
    onCorrect,
    onEncourage,
    onRelease,
    onPoseStart,
    onPoseComplete,
    onSessionComplete,
    onAdapt,
  } = {}) {
    this.sequence = sequence;
    this.poseIndex = 0;
    this.state = STATES.NO_POSE;
    this.smoother = new Smoother();
    this.bestHoldMs = 0;
    this.lastHoldMs = 0;
    this.completed = [];
    this.restUntil = 0;
    this.onStateChange = onStateChange ?? (() => {});
    this.onCoach = onCoach ?? (() => {});
    this.onCorrect = onCorrect ?? (() => {});
    this.onEncourage = onEncourage ?? (() => {});
    this.onRelease = onRelease ?? (() => {});
    this.onPoseStart = onPoseStart ?? (() => {});
    this.onPoseComplete = onPoseComplete ?? (() => {});
    this.onSessionComplete = onSessionComplete ?? (() => {});
    this.adaptive = adaptive ?? new Adaptive();
    this.adaptive.onChange = onAdapt ?? (() => {});
    this._resetPoseState();
  }

  get pose() {
    return this.sequence[this.poseIndex] ?? null;
  }

  /** Announces the first pose. Call once the camera is live. */
  start() {
    this.onPoseStart(this.pose, this.poseIndex);
  }

  _resetPoseState() {
    this.activeSide = null;
    this.noPoseCounter = 0;
    this.waitUntil = 0;
    this.currentIssue = null;
    this.activeFlags = new Set();
    this.holdStartedAt = null;
    this.holdMs = 0;
    this.nextMilestoneIdx = 0;
    this.lastCueIssue = null;
    this.lastCueAt = -Infinity;
    this.repeatCount = 0;
    this.issueSince = null;
    this.attemptStartedAt = null;
    this.easedByTime = false;
    this.cuesThisPose = 0;
    this.smoother.reset();
  }

  _setState(next) {
    if (this.state !== next) {
      this.state = next;
      this.onStateChange(next, this.pose);
    }
  }

  /** Banks the hold and, unless it was a completed target hold, reports the early release. */
  _endHold({ announce = true } = {}) {
    if (this.holdStartedAt === null) return;
    const held = this.holdMs;
    this.holdStartedAt = null;
    this.holdMs = 0;
    this.nextMilestoneIdx = 0;
    if (held > 0) {
      this.lastHoldMs = held;
      if (held > this.bestHoldMs) this.bestHoldMs = held;
      if (announce) this.onRelease(held);
    }
  }

  _advancePose() {
    this.poseIndex++;
    this._resetPoseState();
    if (this.poseIndex >= this.sequence.length) {
      this._setState(STATES.SESSION_COMPLETE);
      this.onSessionComplete(this.completed);
      return;
    }
    this._setState(STATES.NO_POSE);
    this.onPoseStart(this.pose, this.poseIndex);
  }

  /** Call once per video frame with the current landmark array (or null if no pose detected). */
  tick(lm, now) {
    if (this.state === STATES.SESSION_COMPLETE) return this._snapshot(null, now);

    // Resting between poses: ignore the body entirely so the user can shake it out.
    if (this.state === STATES.POSE_COMPLETE) {
      if (now >= this.restUntil) this._advancePose();
      return this._snapshot(null, now);
    }

    const pose = this.pose;
    const gatePass = lm ? pose.entryGate(lm) : false;

    if (!gatePass) {
      this.noPoseCounter++;
      if (this.noPoseCounter > POSE_LOSS_FRAMES) {
        this.activeSide = null;
        this.currentIssue = null;
        this.issueSince = null;
        this.activeFlags = new Set();
        this.smoother.reset();
        this._endHold();
        this._setState(STATES.NO_POSE);
      }
      return this._snapshot(null, now);
    }
    this.noPoseCounter = 0;

    if (this.state === STATES.NO_POSE) {
      this.activeSide = pose.detectSide(lm);
      this.attemptStartedAt = now;
      this._setState(STATES.EVALUATING);
    }

    // Still not there after a long try? Stop asking for precision and meet the body
    // where it is — the whole point is a pose they can actually hold.
    if (
      !this.easedByTime &&
      this.attemptStartedAt !== null &&
      this.state !== STATES.HOLDING_CORRECT &&
      now - this.attemptStartedAt > STRUGGLE_MS
    ) {
      this.easedByTime = true;
      this.adaptive.ease("time");
    }

    const level = this.adaptive.level;

    // While actively coaching, hold the message on screen for the full wait window
    // and don't re-evaluate — that's the "let it land" pause before rechecking.
    if (this.state === STATES.COACHING) {
      if (now < this.waitUntil) {
        const evalResult = pose.evaluate(lm, this.activeSide, this.smoother, this.activeFlags, level);
        this.activeFlags = evalResult.flags;
        // Still inside the "let it land" pause, but the cue itself may only just have
        // become eligible (a fault has to persist for CONFIRM_MS before it's spoken).
        if (evalResult.issue === this.currentIssue) this._maybeCue(this.currentIssue, now);
        return this._snapshot(evalResult, now);
      }
      this._setState(STATES.RECHECKING);
    }

    const evalResult = pose.evaluate(lm, this.activeSide, this.smoother, this.activeFlags, level);
    this.activeFlags = evalResult.flags;

    if (evalResult.issue) {
      if (this.currentIssue !== evalResult.issue) this.issueSince = now;
      this.currentIssue = evalResult.issue;
      this.waitUntil = now + WAIT_MS;
      this._endHold();
      this._setState(STATES.COACHING);
      this._maybeCue(evalResult.issue, now);
    } else {
      const wasAlreadyCorrect = this.state === STATES.HOLDING_CORRECT;
      this.currentIssue = null;
      this.issueSince = null;
      this._setState(STATES.HOLDING_CORRECT);
      if (!wasAlreadyCorrect) {
        this.holdStartedAt = now;
        this.holdMs = 0;
        this.nextMilestoneIdx = 0;
        this.lastCueIssue = null;
        this.repeatCount = 0;
        this.lastCueAt = now;
        this._gradeAttempt(now);
        this.onCorrect(pose);
      } else {
        this.holdMs = now - this.holdStartedAt;
        if (this.holdMs >= pose.holdTargetMs) {
          this._completePose(now);
          return this._snapshot(evalResult, now);
        }
        this._checkMilestones(pose);
      }
    }

    return this._snapshot(evalResult, now);
  }

  /** Walking straight into the pose is the signal to ask for a little more precision. */
  _gradeAttempt(now) {
    const tookMs = this.attemptStartedAt === null ? Infinity : now - this.attemptStartedAt;
    if (this.cuesThisPose === 0 && tookMs < EASY_WIN_MS) this.adaptive.tighten();
  }

  _completePose(now) {
    const pose = this.pose;
    const held = this.holdMs;
    this._endHold({ announce: false });
    this.completed.push({ id: pose.id, name: pose.name, heldMs: held });
    this.restUntil = now + REST_MS;
    this._setState(STATES.POSE_COMPLETE);
    this.onPoseComplete(pose, held, this.poseIndex === this.sequence.length - 1);
  }

  /**
   * Speaks a cue only if the fault has settled and the coach hasn't just spoken.
   * Repeats of the same fault advance `repeatCount` so the caller can pick a fresh
   * phrasing instead of replaying the identical sentence.
   */
  _maybeCue(issue, now) {
    if (now - this.issueSince < CONFIRM_MS) return;

    const sameAsLast = this.lastCueIssue === issue;
    const sinceLastCue = now - this.lastCueAt;
    if (sameAsLast ? sinceLastCue < RECUE_SAME_MS : sinceLastCue < MIN_CUE_GAP_MS) return;

    this.repeatCount = sameAsLast ? this.repeatCount + 1 : 0;
    this.lastCueIssue = issue;
    this.lastCueAt = now;
    this.cuesThisPose++;
    // Having to say the same thing again means the ask is too hard, not that the
    // user isn't listening. Widen the target instead of repeating louder.
    if (this.repeatCount > 0) this.adaptive.ease("repeat");
    this.onCoach(issue, this.repeatCount, this.pose);
  }

  _checkMilestones(pose) {
    const heldSeconds = this.holdMs / 1000;
    const targetSeconds = pose.holdTargetMs / 1000;
    while (
      this.nextMilestoneIdx < ENCOURAGEMENT_SECONDS.length &&
      heldSeconds >= ENCOURAGEMENT_SECONDS[this.nextMilestoneIdx]
    ) {
      const milestone = ENCOURAGEMENT_SECONDS[this.nextMilestoneIdx];
      this.nextMilestoneIdx++;
      // A milestone landing on the finish line is covered by the completion line.
      if (milestone < targetSeconds) this.onEncourage(milestone, pose);
    }
  }

  _snapshot(evalResult, now) {
    const waitRemainingMs = this.state === STATES.COACHING ? Math.max(0, this.waitUntil - now) : 0;
    return {
      state: this.state,
      pose: this.pose,
      poseIndex: this.poseIndex,
      poseCount: this.sequence.length,
      side: this.activeSide,
      issue: this.currentIssue,
      values: evalResult?.values ?? null,
      metrics: evalResult?.metrics ?? null,
      chips: evalResult?.chips ?? null,
      frontJointIndex: evalResult?.frontJointIndex ?? null,
      waitRemainingMs,
      waitTotalMs: WAIT_MS,
      holdMs: this.holdStartedAt === null ? 0 : this.holdMs,
      holdTargetMs: this.pose?.holdTargetMs ?? 0,
      restRemainingMs: this.state === STATES.POSE_COMPLETE ? Math.max(0, this.restUntil - now) : 0,
      lastHoldMs: this.lastHoldMs,
      bestHoldMs: this.bestHoldMs,
      guidanceLevel: this.adaptive.level,
      guidanceLabel: this.adaptive.label,
      completed: this.completed,
    };
  }
}
