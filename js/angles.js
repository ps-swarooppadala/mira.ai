// MediaPipe Pose Landmarker indices we care about (33-point body model).
export const LM = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
};

// Body connections used for the skeleton overlay (indices into the 33-point model).
export const POSE_CONNECTIONS = [
  [11, 12], // shoulders
  [11, 13], [13, 15], // left arm
  [12, 14], [14, 16], // right arm
  [11, 23], [12, 24], // torso sides
  [23, 24], // hips
  [23, 25], [25, 27], // left leg
  [24, 26], [26, 28], // right leg
  [27, 29], [29, 31], [27, 31], // left foot
  [28, 30], [30, 32], [28, 32], // right foot
];

/** Angle in degrees at `vertex`, formed by rays to `a` and `b`. 2D only (x, y). */
export function angleAt(a, vertex, b) {
  const v1 = { x: a.x - vertex.x, y: a.y - vertex.y };
  const v2 = { x: b.x - vertex.x, y: b.y - vertex.y };
  const mag1 = Math.hypot(v1.x, v1.y);
  const mag2 = Math.hypot(v2.x, v2.y);
  if (mag1 === 0 || mag2 === 0) return null;
  const cos = Math.min(1, Math.max(-1, (v1.x * v2.x + v1.y * v2.y) / (mag1 * mag2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Small exponential moving average per named key, to damp per-frame landmark jitter. */
export class Smoother {
  constructor(alpha = 0.35) {
    this.alpha = alpha;
    this.values = new Map();
  }
  smooth(key, value) {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return this.values.get(key) ?? null;
    }
    const prev = this.values.get(key);
    const next = prev === undefined ? value : prev + this.alpha * (value - prev);
    this.values.set(key, next);
    return next;
  }
  reset() {
    this.values.clear();
  }
}
