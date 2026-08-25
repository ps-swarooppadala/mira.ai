import { LM, POSE_CONNECTIONS } from "./angles.js";
import { createPoseLandmarker } from "./poseEngine.js";
import { PoseCoach, STATES } from "./stateMachine.js";
import { SEQUENCE } from "./poses.js";
import {
  speak,
  captionFor,
  encouragementFor,
  getVoiceName,
  successLineFor,
  releaseLineFor,
  completionLineFor,
  adaptationLineFor,
  SESSION_COMPLETE_LINE,
} from "./coaching.js";

// ---------- DOM ----------
const video = document.getElementById("webcam");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const cameraHint = document.getElementById("cameraHint");
const startOverlay = document.getElementById("startOverlay");
const startBtn = document.getElementById("startBtn");

const statusPill = document.getElementById("statusPill");
const coachingText = document.getElementById("coachingText");
const speakerIcon = document.getElementById("speakerIcon");
const muteBtn = document.getElementById("muteBtn");
const coachLog = document.getElementById("coachLog");
const ringWrap = document.querySelector(".recheck-ring-wrap");
const ringProgress = document.getElementById("ringProgress");

const brandPose = document.getElementById("brandPose");
const poseStepper = document.getElementById("poseStepper");
const referenceName = document.getElementById("referenceName");
const referenceImg = document.getElementById("referenceImg");
const referenceCaption = document.getElementById("referenceCaption");
const metricRows = document.getElementById("metricRows");
const chipRow = document.getElementById("chipRow");

const holdTimer = document.getElementById("holdTimer");
const holdTimerValue = document.getElementById("holdTimerValue");
const holdSeconds = document.getElementById("holdSeconds");
const holdTargetEl = document.getElementById("holdTarget");
const holdBarFill = document.getElementById("holdBarFill");
const lastHoldEl = document.getElementById("lastHold");
const bestHoldEl = document.getElementById("bestHold");
const restBanner = document.getElementById("restBanner");
const restTitle = document.getElementById("restTitle");
const restSub = document.getElementById("restSub");
const guidancePill = document.getElementById("guidancePill");
const guidanceNote = document.getElementById("guidanceNote");

const RING_CIRCUMFERENCE = 100.53; // 2 * PI * r(16)
const MAX_LOG_ENTRIES = 60;

// ---------- Voice + session log ----------
let voiceEnabled = true;
const sessionStart = Date.now();

function clockStamp() {
  const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const s = String(elapsed % 60).padStart(2, "0");
  return `${m}:${s}`;
}

/** Appends a coaching message to the on-screen session log. */
function log(text, kind = "system") {
  const li = document.createElement("li");
  li.className = `log-entry log-${kind}`;

  const time = document.createElement("span");
  time.className = "log-time";
  time.textContent = clockStamp();

  const body = document.createElement("span");
  body.className = "log-text";
  body.textContent = text;

  li.append(time, body);
  coachLog.appendChild(li);
  while (coachLog.children.length > MAX_LOG_ENTRIES) coachLog.removeChild(coachLog.firstChild);
  coachLog.scrollTop = coachLog.scrollHeight;
}

/** Shows the line in the coach panel, logs it, and speaks it in the calm coaching voice. */
function say(text, { kind = "cue", interrupt = true, showInPanel = true } = {}) {
  if (showInPanel) coachingText.textContent = text;
  log(text, kind);
  if (!voiceEnabled) return;
  speak(text, {
    interrupt,
    onStart: () => speakerIcon.classList.add("active"),
    onEnd: () => speakerIcon.classList.remove("active"),
  });
}

muteBtn.addEventListener("click", () => {
  voiceEnabled = !voiceEnabled;
  muteBtn.textContent = voiceEnabled ? "Voice on" : "Voice off";
  muteBtn.setAttribute("aria-pressed", String(!voiceEnabled));
  if (voiceEnabled) {
    log("Voice coaching on.", "system");
  } else {
    window.speechSynthesis?.cancel();
    speakerIcon.classList.remove("active");
    log("Voice coaching muted \u2014 messages still appear here.", "system");
  }
});

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

// ---------- Colors ----------
const COLOR = {
  skeleton: "#50808e",
  ok: "#69a297",
  okVivid: "#3ddc97",
  issue: "#e8763a",
};

// ---------- Pose sequence UI ----------
SEQUENCE.forEach((pose, i) => {
  const li = document.createElement("li");
  li.className = "step";
  li.dataset.poseId = pose.id;
  li.innerHTML = `<span class="step-dot">${i + 1}</span><span class="step-name"></span>`;
  li.querySelector(".step-name").textContent = pose.name;
  poseStepper.appendChild(li);
});

function renderPoseHeader(pose, index) {
  brandPose.textContent = pose.name;
  referenceName.innerHTML = "";
  referenceName.append(pose.name, " ");
  const sanskrit = document.createElement("span");
  sanskrit.className = "sanskrit";
  sanskrit.textContent = pose.sanskrit;
  referenceName.appendChild(sanskrit);

  referenceImg.src = pose.reference;
  referenceImg.alt = `${pose.name} reference pose`;
  referenceCaption.textContent = pose.referenceCaption;
  holdTargetEl.textContent = String(Math.round(pose.holdTargetMs / 1000));

  [...poseStepper.children].forEach((li, i) => {
    li.classList.toggle("active", i === index);
    li.classList.toggle("done", i < index);
  });
}

// ---------- State machine wiring ----------
const coach = new PoseCoach({
  onStateChange: (state, pose) => {
    statusPill.classList.remove(
      "status-nopose",
      "status-eval",
      "status-coaching",
      "status-recheck",
      "status-correct",
      "status-rest"
    );
    restBanner.classList.remove("visible");

    if (state === STATES.NO_POSE) {
      statusPill.textContent = "Get into position";
      statusPill.classList.add("status-nopose");
      coachingText.textContent = `Step into ${pose.name} to begin.`;
      ringWrap.classList.remove("visible");
      holdTimer.classList.remove("visible", "counting");
    } else if (state === STATES.EVALUATING) {
      statusPill.textContent = "Analyzing\u2026";
      statusPill.classList.add("status-eval");
      ringWrap.classList.remove("visible");
      holdTimer.classList.add("visible");
    } else if (state === STATES.COACHING) {
      statusPill.textContent = "Adjust your form";
      statusPill.classList.add("status-coaching");
      ringWrap.classList.add("visible");
      holdTimer.classList.remove("counting");
    } else if (state === STATES.RECHECKING) {
      statusPill.textContent = "Rechecking\u2026";
      statusPill.classList.add("status-recheck");
    } else if (state === STATES.HOLDING_CORRECT) {
      statusPill.textContent = "In the pose \u2014 hold";
      statusPill.classList.add("status-correct");
      ringWrap.classList.remove("visible");
      holdTimer.classList.add("visible", "counting");
    } else if (state === STATES.POSE_COMPLETE) {
      statusPill.textContent = "Rest";
      statusPill.classList.add("status-rest");
      ringWrap.classList.remove("visible");
      holdTimer.classList.remove("visible", "counting");
      restBanner.classList.add("visible");
    } else if (state === STATES.SESSION_COMPLETE) {
      statusPill.textContent = "Flow complete";
      statusPill.classList.add("status-correct");
      holdTimer.classList.remove("visible", "counting");
    }

    // Whole-UI green wash whenever the pose is confirmed correct or just finished.
    document.body.classList.toggle(
      "pose-correct",
      state === STATES.HOLDING_CORRECT || state === STATES.POSE_COMPLETE || state === STATES.SESSION_COMPLETE
    );
  },
  onPoseStart: (pose, index) => {
    renderPoseHeader(pose, index);
    log(`\u2014 Pose ${index + 1} of ${SEQUENCE.length}: ${pose.name} (${pose.sanskrit}) \u2014`, "system");
    say(pose.intro, { kind: "cue", interrupt: false });
  },
  onCoach: (issueCode, repeat, pose) => {
    say(captionFor(pose, issueCode, repeat), { kind: "cue" });
  },
  onCorrect: (pose) => {
    say(successLineFor(pose), { kind: "praise" });
  },
  // Fires at 5s, 10s, 15s… of a clean hold. Queued rather than interrupting so
  // encouragement never clips a correction mid-sentence.
  onEncourage: (seconds) => {
    say(encouragementFor(seconds), { kind: "hold", interrupt: false });
  },
  onRelease: (heldMs) => {
    if (heldMs < 1500) return;
    say(releaseLineFor(heldMs), { kind: "praise", interrupt: false, showInPanel: false });
  },
  onPoseComplete: (pose, heldMs, isLast) => {
    restTitle.textContent = `${pose.name} held for ${(heldMs / 1000).toFixed(1)}s`;
    restSub.textContent = isLast ? "Relax \u2014 that's the whole flow." : "Relax whenever you're ready\u2026";
    say(completionLineFor(pose, heldMs, isLast), { kind: "praise" });
  },
  onSessionComplete: (completed) => {
    [...poseStepper.children].forEach((li) => li.classList.add("done"));
    coachingText.textContent = "Flow complete. Namaste.";
    completed.forEach((c) => log(`\u2713 ${c.name} \u2014 ${(c.heldMs / 1000).toFixed(1)}s`, "praise"));
    say(SESSION_COMPLETE_LINE, { kind: "praise", interrupt: false });
  },
  onAdapt: (level, label, reason) => {
    renderGuidance();
    if (reason === "mastery") {
      log(`Guidance tightened to \u201c${label}\u201d \u2014 you're finding the shape easily.`, "system");
      return;
    }
    log(`Guidance eased to \u201c${label}\u201d \u2014 adapting to your range today.`, "system");
    const line = adaptationLineFor(reason);
    if (line && !adaptSpoken) {
      adaptSpoken = true;
      say(line, { kind: "hold", interrupt: false, showInPanel: false });
    }
  },
});

let adaptSpoken = false;

function renderGuidance() {
  const { label, note, level } = coach.adaptive;
  guidancePill.textContent = label;
  guidancePill.classList.toggle("adapting", level > 0.45);
  guidanceNote.textContent = note;
}
renderGuidance();

// ---------- Drawing ----------
function drawSkeleton(lm, snapshot) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!lm) return;

  // Canvas is NOT CSS-mirrored (so on-canvas text stays readable); flip x manually
  // to line up with the mirrored <video> element underneath.
  const px = (p) => ({ x: canvas.width - p.x * canvas.width, y: p.y * canvas.height });

  const highlighted = new Set(
    snapshot.state === STATES.COACHING && snapshot.pose
      ? snapshot.pose.jointsForIssue(snapshot.issue, snapshot.side)
      : []
  );
  const allGood = snapshot.state === STATES.HOLDING_CORRECT || snapshot.state === STATES.POSE_COMPLETE;
  const lineColor = allGood ? COLOR.okVivid : COLOR.skeleton;

  ctx.save();
  if (allGood) {
    ctx.shadowColor = COLOR.okVivid;
    ctx.shadowBlur = 18;
  }

  ctx.lineWidth = 3;
  ctx.strokeStyle = lineColor;
  POSE_CONNECTIONS.forEach(([a, b]) => {
    const pa = lm[a];
    const pb = lm[b];
    if (!pa || !pb) return;
    const A = px(pa);
    const B = px(pb);
    const isHighlightSegment = highlighted.has(a) && highlighted.has(b);
    ctx.strokeStyle = isHighlightSegment ? COLOR.issue : lineColor;
    ctx.lineWidth = isHighlightSegment ? 5 : allGood ? 5 : 3;
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.stroke();
  });

  const pulse = 1 + 0.25 * Math.sin(performance.now() / 180);
  const holdPulse = 1 + 0.12 * Math.sin(performance.now() / 420);
  Object.values(LM).forEach((idx) => {
    const p = lm[idx];
    if (!p) return;
    const P = px(p);
    const isHot = highlighted.has(idx);
    ctx.beginPath();
    ctx.fillStyle = isHot ? COLOR.issue : allGood ? COLOR.okVivid : "#cfe0d8";
    const r = isHot ? 7 * pulse : allGood ? 6 * holdPulse : 5;
    ctx.arc(P.x, P.y, r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

// ---------- Read-out panel ----------
// Rows are rebuilt only when the pose changes; values are patched every frame.
let renderedMetricLabels = "";

function updateReadouts(snapshot) {
  const metrics = snapshot.metrics;

  if (!metrics) {
    metricRows.querySelectorAll(".angle-value").forEach((el) => (el.textContent = "\u2014"));
    chipRow.querySelectorAll(".chip").forEach((el) => (el.className = "chip chip-neutral"));
    return;
  }

  const signature = metrics.map((m) => m.label).join("|");
  if (signature !== renderedMetricLabels) {
    renderedMetricLabels = signature;
    metricRows.innerHTML = "";
    metrics.forEach((m) => {
      const row = document.createElement("div");
      row.className = "angle-row";
      row.innerHTML =
        '<span class="angle-label"></span><span class="angle-value">\u2014</span><span class="angle-target"></span>';
      row.querySelector(".angle-label").textContent = m.label;
      row.querySelector(".angle-target").textContent = m.target;
      metricRows.appendChild(row);
    });
    chipRow.innerHTML = "";
    (snapshot.chips ?? []).forEach((c) => {
      const chip = document.createElement("span");
      chip.className = "chip chip-neutral";
      chip.textContent = c.label;
      chipRow.appendChild(chip);
    });
  }

  metrics.forEach((m, i) => {
    const el = metricRows.children[i]?.querySelector(".angle-value");
    if (el) el.textContent = m.value === null || m.value === undefined ? "\u2014" : `${Math.round(m.value)}${m.unit}`;
  });
  (snapshot.chips ?? []).forEach((c, i) => {
    const chip = chipRow.children[i];
    if (chip) chip.className = "chip " + (c.ok ? "chip-ok" : "chip-bad");
  });
}

function updateRing(snapshot) {
  if (snapshot.state !== STATES.COACHING) return;
  const fraction = 1 - snapshot.waitRemainingMs / snapshot.waitTotalMs;
  ringProgress.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - fraction));
}

// ---------- Hold timer ----------
function updateHoldTimer(snapshot) {
  holdTimerValue.textContent = formatSeconds(snapshot.holdMs);
  holdSeconds.textContent = (snapshot.holdMs / 1000).toFixed(1);
  lastHoldEl.textContent = snapshot.lastHoldMs ? formatSeconds(snapshot.lastHoldMs) : "\u2014";
  bestHoldEl.textContent = snapshot.bestHoldMs ? formatSeconds(snapshot.bestHoldMs) : "\u2014";

  const target = snapshot.holdTargetMs || 1;
  const progress = Math.min(1, snapshot.holdMs / target);
  holdBarFill.style.width = `${(progress * 100).toFixed(1)}%`;

  if (snapshot.state === STATES.POSE_COMPLETE) {
    const isLast = snapshot.poseIndex === snapshot.poseCount - 1;
    const secs = Math.ceil(snapshot.restRemainingMs / 1000);
    restSub.textContent = isLast
      ? "Relax \u2014 that's the whole flow."
      : `Relax whenever you're ready \u2014 next pose in ${secs}s`;
  }
}

// ---------- Camera + detection loop ----------
async function main() {
  startBtn.disabled = true;
  startBtn.textContent = "Starting\u2026";
  log("PranaAI session started. Loading pose model\u2026", "system");

  let landmarker, stream;
  try {
    landmarker = await createPoseLandmarker();
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 960, height: 720, facingMode: "user" },
      audio: false,
    });
  } catch (err) {
    startBtn.disabled = false;
    startBtn.textContent = "Start session";
    throw err;
  }

  startOverlay.classList.add("hidden");
  video.srcObject = stream;
  await video.play();

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  cameraHint.classList.add("hidden");

  log(`Camera live. Coaching voice: ${getVoiceName()}.`, "system");
  say("Hi, I'm your Prana coach. We'll flow through three poses together, holding each for ten seconds.", {
    kind: "cue",
  });
  coach.start();

  function loop() {
    const now = performance.now();
    const result = landmarker.detectForVideo(video, now);
    const lm = result.landmarks && result.landmarks[0] ? result.landmarks[0] : null;

    const snapshot = coach.tick(lm, now);
    drawSkeleton(lm, snapshot);
    updateReadouts(snapshot);
    updateRing(snapshot);
    updateHoldTimer(snapshot);

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

function startSession() {
  main().catch((err) => {
    console.error(err);
    const msg =
      "Couldn't start the camera or pose model: " + err.message + " \u2014 check camera permissions and reload.";
    cameraHint.textContent = msg;
    cameraHint.classList.remove("hidden");
    log(msg, "system");
  });
}

startBtn.addEventListener("click", startSession);
