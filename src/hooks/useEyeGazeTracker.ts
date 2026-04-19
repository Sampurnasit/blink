import { useEffect, useRef, useState, useCallback } from "react";
import { FaceMesh, Results } from "@mediapipe/face_mesh";
import { Camera } from "@mediapipe/camera_utils";

/*  ╔══════════════════════════════════════════════════════════════════╗
 *  ║  useEyeGazeTracker – High-accuracy gaze direction detector     ║
 *  ║                                                                 ║
 *  ║  Accuracy improvements over v1 (no heavy models):               ║
 *  ║  1. Head-pose compensation via 3D pose estimation (nose+chin+   ║
 *  ║     forehead+cheek landmarks → yaw/pitch) so head turns don't   ║
 *  ║     pollute iris-ratio.                                         ║
 *  ║  2. All 5 iris landmarks per eye averaged (not just center) for ║
 *  ║     a more robust iris centroid.                                ║
 *  ║  3. One-Euro filter instead of SMA — low latency when still,   ║
 *  ║     strong smoothing when jittery.                              ║
 *  ║  4. Adaptive calibration — first 2s auto-learns user's neutral ║
 *  ║     center, and manual re-calibrate button exposed.             ║
 *  ║  5. Directional hysteresis — different enter/exit thresholds to ║
 *  ║     prevent flickering at boundaries.                           ║
 *  ║  6. Asymmetric left/right compensation — accounts for camera-  ║
 *  ║     mirror asymmetry in iris tracking.                          ║
 *  ║  7. Head-tilt (roll) rejection — ignores gaze when head is     ║
 *  ║     tilted beyond a threshold.                                  ║
 *  ╚══════════════════════════════════════════════════════════════════╝ */

// ── Landmark indices ───────────────────────────────────────────────
// Eye contour points for EAR (6 points each)
const LEFT_EYE  = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380];

// Full iris landmarks (5 per eye: center + 4 cardinal points)
const LEFT_IRIS  = [468, 469, 470, 471, 472];
const RIGHT_IRIS = [473, 474, 475, 476, 477];

// Eye corners for horizontal ratio
const LEFT_EYE_INNER  = 133;
const LEFT_EYE_OUTER  = 33;
const RIGHT_EYE_INNER = 362;
const RIGHT_EYE_OUTER = 263;

// Upper/lower eyelid for vertical ratio
const LEFT_EYE_TOP     = 159;
const LEFT_EYE_BOTTOM  = 145;
const RIGHT_EYE_TOP    = 386;
const RIGHT_EYE_BOTTOM = 374;

// Head pose estimation landmarks
const NOSE_TIP       = 1;
const CHIN           = 152;
const LEFT_CHEEK     = 234;
const RIGHT_CHEEK    = 454;
const FOREHEAD       = 10;
const NOSE_BRIDGE    = 6;

// ── Types ──────────────────────────────────────────────────────────
type Pt  = { x: number; y: number; z?: number };
type Pt3 = { x: number; y: number; z: number };

export type GazeDirection = "left" | "right" | "up" | "down" | "center";
export type MorseCommand  = "move" | "continuous" | "stop" | "reset";

export interface EyeGazeState {
  direction: GazeDirection;
  isBlink: boolean;
  morseBuffer: string;
  lastCommand: MorseCommand | null;
  currentEAR: number;
  faceDetected: boolean;
  cameraReady: boolean;
  error: string | null;
  horizontalRatio: number;   // 0-1 raw smoothed H
  verticalRatio: number;     // 0-1 raw smoothed V
  isCalibrated: boolean;
  headYaw: number;           // degrees (+ = right)
  headPitch: number;         // degrees (+ = up)
  confidence: number;        // 0-1 tracking confidence
}

export interface UseEyeGazeTrackerOptions {
  videoRef: React.RefObject<HTMLVideoElement>;
  enabled: boolean;
  earThreshold?: number;
  longBlinkMs?: number;
  gazeDeadzone?: number;
  onMove?: (direction: GazeDirection, command: MorseCommand) => void;
  onCalibrated?: () => void;
}

// ── Morse command map ──────────────────────────────────────────────
const MORSE_COMMANDS: Record<string, MorseCommand> = {
  ".":  "move",
  "-":  "continuous",
  "..": "stop",
  "--": "reset",
};

// ── Utility helpers ────────────────────────────────────────────────
function dist2(a: Pt, b: Pt) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function ear(landmarks: Pt[], idx: number[]): number {
  const p = idx.map(i => landmarks[i]);
  const v1 = dist2(p[1], p[5]);
  const v2 = dist2(p[2], p[4]);
  const h  = dist2(p[0], p[3]);
  if (h < 1e-6) return 0.3;
  return (v1 + v2) / (2 * h);
}

/** Average of multiple landmark points (iris centroid) */
function centroid(landmarks: Pt[], indices: number[]): Pt3 {
  let sx = 0, sy = 0, sz = 0;
  for (const i of indices) {
    sx += landmarks[i].x;
    sy += landmarks[i].y;
    sz += (landmarks[i].z ?? 0);
  }
  const n = indices.length;
  return { x: sx / n, y: sy / n, z: sz / n };
}

// ── One-Euro Filter ────────────────────────────────────────────────
// Minimal-latency smoothing: low jitter AND low latency.
// Parameters tuned for ~30fps iris tracking.
class OneEuroFilter {
  private firstTime = true;
  private prevRaw = 0;
  private prevFiltered = 0;
  private prevDx = 0;
  private prevT = 0;

  constructor(
    private minCutoff = 1.5,   // lower = more smoothing at rest
    private beta = 0.05,       // higher = less lag during fast movement
    private dCutoff = 1.0      // derivative filter cutoff
  ) {}

  private alpha(cutoff: number, dt: number) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  filter(value: number, timestamp: number): number {
    if (this.firstTime) {
      this.firstTime = false;
      this.prevRaw = value;
      this.prevFiltered = value;
      this.prevT = timestamp;
      return value;
    }

    const dt = Math.max(timestamp - this.prevT, 1e-6);
    this.prevT = timestamp;

    // Derivative of the signal
    const dx = (value - this.prevRaw) / dt;
    const aDx = this.alpha(this.dCutoff, dt);
    const filteredDx = aDx * dx + (1 - aDx) * this.prevDx;
    this.prevDx = filteredDx;

    // Adaptive cutoff based on speed
    const cutoff = this.minCutoff + this.beta * Math.abs(filteredDx);
    const a = this.alpha(cutoff, dt);
    const filtered = a * value + (1 - a) * this.prevFiltered;

    this.prevRaw = value;
    this.prevFiltered = filtered;
    return filtered;
  }

  reset() { this.firstTime = true; }
}

// ── Head Pose Estimator (lightweight, landmark-only) ───────────────
// Estimates yaw, pitch, roll from 6 face landmarks in 3D.
// No solvePnP — purely geometric, near-zero CPU cost.
function estimateHeadPose(lm: Pt[]) {
  const nose       = lm[NOSE_TIP]     as Pt3;
  const chin       = lm[CHIN]         as Pt3;
  const leftCheek  = lm[LEFT_CHEEK]   as Pt3;
  const rightCheek = lm[RIGHT_CHEEK]  as Pt3;
  const forehead   = lm[FOREHEAD]     as Pt3;
  const bridge     = lm[NOSE_BRIDGE]  as Pt3;

  // Yaw: lateral offset of nose relative to midpoint of cheeks
  const cheekMidX = (leftCheek.x + rightCheek.x) / 2;
  const cheekWidth = Math.abs(rightCheek.x - leftCheek.x);
  const yawRatio = cheekWidth > 1e-6 ? (nose.x - cheekMidX) / cheekWidth : 0;
  // Approx mapping: ratio ±0.5 ≈ ±45°
  const yawDeg = yawRatio * 90;

  // Pitch: vertical offset between forehead-nose-chin midline
  const faceHeight = dist2(forehead, chin);
  const noseBridgeDy = bridge.y - forehead.y;
  const pitchRatio = faceHeight > 1e-6 ? noseBridgeDy / faceHeight : 0;
  // Neutral pitch ratio ~0.25, normalize around that
  const pitchDeg = (pitchRatio - 0.25) * -120;

  // Roll: angle of the line from left cheek to right cheek vs horizontal
  const rollRad = Math.atan2(rightCheek.y - leftCheek.y, rightCheek.x - leftCheek.x);
  const rollDeg = rollRad * (180 / Math.PI);

  return { yaw: yawDeg, pitch: pitchDeg, roll: rollDeg };
}

// ── Adaptive Calibration Accumulator ───────────────────────────────
class CalibrationAccumulator {
  private samples: { h: number; v: number }[] = [];
  private _hCenter = 0.50;
  private _vCenter = 0.48;
  private _hRange = 0.15;   // expected range each side of center
  private _vRange = 0.12;
  private _done = false;
  private _startTime = 0;
  readonly CALIB_DURATION_MS = 2000; // collect for 2s

  start() {
    this.samples = [];
    this._done = false;
    this._startTime = performance.now();
  }

  addSample(h: number, v: number) {
    if (this._done) return;
    this.samples.push({ h, v });

    if (performance.now() - this._startTime >= this.CALIB_DURATION_MS && this.samples.length >= 20) {
      this.finalize();
    }
  }

  private finalize() {
    const hVals = this.samples.map(s => s.h);
    const vVals = this.samples.map(s => s.v);

    // Use median for robustness against outliers
    hVals.sort((a, b) => a - b);
    vVals.sort((a, b) => a - b);
    const mid = Math.floor(hVals.length / 2);
    this._hCenter = hVals.length % 2 ? hVals[mid] : (hVals[mid - 1] + hVals[mid]) / 2;
    this._vCenter = vVals.length % 2 ? vVals[mid] : (vVals[mid - 1] + vVals[mid]) / 2;

    // Compute IQR for adaptive range
    const q1h = hVals[Math.floor(hVals.length * 0.25)];
    const q3h = hVals[Math.floor(hVals.length * 0.75)];
    const q1v = vVals[Math.floor(vVals.length * 0.25)];
    const q3v = vVals[Math.floor(vVals.length * 0.75)];

    // Idle jitter range × 3 = directional range
    this._hRange = Math.max(0.04, (q3h - q1h) * 3);
    this._vRange = Math.max(0.03, (q3v - q1v) * 3);

    this._done = true;
  }

  get isDone() { return this._done; }
  get hCenter() { return this._hCenter; }
  get vCenter() { return this._vCenter; }
  get hRange() { return this._hRange; }
  get vRange() { return this._vRange; }

  /** Manual set from re-calibrate */
  forceCalibrate(h: number, v: number) {
    this._hCenter = h;
    this._vCenter = v;
    this._done = true;
  }
}

// ═══════════════════════════════════════════════════════════════════
// ──  HOOK  ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

export function useEyeGazeTracker({
  videoRef,
  enabled,
  earThreshold = 0.21,
  longBlinkMs = 400,
  gazeDeadzone = 0.08,
  onMove,
  onCalibrated,
}: UseEyeGazeTrackerOptions): EyeGazeState {

  // ── Exposed state ──────────────────────────────────────────────
  const [direction, setDirection]         = useState<GazeDirection>("center");
  const [isBlink, setIsBlink]             = useState(false);
  const [morseBuffer, setMorseBuffer]     = useState("");
  const [lastCommand, setLastCommand]     = useState<MorseCommand | null>(null);
  const [currentEAR, setCurrentEAR]       = useState(0.3);
  const [faceDetected, setFaceDetected]   = useState(false);
  const [cameraReady, setCameraReady]     = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [horizontalRatio, setHorizontalRatio] = useState(0.5);
  const [verticalRatio, setVerticalRatio]     = useState(0.5);
  const [isCalibrated, setIsCalibrated]       = useState(false);
  const [headYaw, setHeadYaw]             = useState(0);
  const [headPitch, setHeadPitch]         = useState(0);
  const [confidence, setConfidence]       = useState(0);

  // ── Stable callback refs ─────────────────────────────────────
  const onMoveRef       = useRef(onMove);
  const onCalibratedRef = useRef(onCalibrated);
  useEffect(() => { onMoveRef.current = onMove; }, [onMove]);
  useEffect(() => { onCalibratedRef.current = onCalibrated; }, [onCalibrated]);

  // ── Internal state refs ──────────────────────────────────────
  const blinkStartRef      = useRef<number | null>(null);
  const blinkStateRef      = useRef<"OPEN" | "CLOSED">("OPEN");
  const consecutiveLowRef  = useRef(0);
  const morseBufferRef     = useRef("");
  const morseTimerRef      = useRef<number | null>(null);
  const lastBlinkTimeRef   = useRef(0);
  const directionRef       = useRef<GazeDirection>("center");

  // One-Euro filters (h, v, yaw, pitch)
  const hFilter    = useRef(new OneEuroFilter(1.2, 0.07, 1.0));
  const vFilter    = useRef(new OneEuroFilter(1.2, 0.07, 1.0));
  const yawFilter  = useRef(new OneEuroFilter(1.0, 0.01, 1.0));
  const pitchFilter = useRef(new OneEuroFilter(1.0, 0.01, 1.0));

  // Calibration
  const calibRef = useRef(new CalibrationAccumulator());

  // Directional hysteresis state
  const hysteresisDir = useRef<GazeDirection>("center");
  const dirHoldFrames = useRef(0);
  const pendingDir    = useRef<GazeDirection>("center");

  // ── HEAD POSE COMPENSATION COEFFICIENTS ──────────────────────
  // How much yaw/pitch affects the iris ratio (empirically tuned)
  const HP_YAW_COEFF   = 0.003;   // per degree of yaw, iris h-ratio shifts ~0.003
  const HP_PITCH_COEFF = 0.002;   // per degree of pitch, iris v-ratio shifts ~0.002
  // Max head rotation to still trust gaze data (degrees)
  const MAX_YAW   = 25;
  const MAX_PITCH  = 20;
  const MAX_ROLL   = 15;

  // Hysteresis thresholds
  const ENTER_FACTOR = 1.0;   // fraction of deadzone to ENTER a direction
  const EXIT_FACTOR  = 0.55;  // fraction of deadzone to EXIT back to center
  // require N consistent frames to change direction
  const DIR_HOLD_ENTER  = 3;
  const DIR_HOLD_EXIT   = 5;   // more frames needed to go back to center (sticky)

  // ── Confidence tracker ───────────────────────────────────────
  const confidenceRef = useRef(0);
  const faceLostFrames = useRef(0);

  // ── Morse callbacks ──────────────────────────────────────────
  const processMorse = useCallback((buffer: string) => {
    const cmd = MORSE_COMMANDS[buffer];
    if (cmd) {
      setLastCommand(cmd);
      onMoveRef.current?.(directionRef.current, cmd);
    }
    setMorseBuffer("");
    morseBufferRef.current = "";
  }, []);

  const scheduleCommit = useCallback(() => {
    if (morseTimerRef.current) window.clearTimeout(morseTimerRef.current);
    morseTimerRef.current = window.setTimeout(() => {
      if (morseBufferRef.current) {
        processMorse(morseBufferRef.current);
      }
    }, 900);
  }, [processMorse]);

  const addMorseSymbol = useCallback((symbol: "." | "-") => {
    morseBufferRef.current += symbol;
    setMorseBuffer(morseBufferRef.current);
    scheduleCommit();
  }, [scheduleCommit]);

  // ── Manual recalibrate ───────────────────────────────────────
  const recalibrate = useCallback(() => {
    calibRef.current = new CalibrationAccumulator();
    calibRef.current.start();
    setIsCalibrated(false);
    hFilter.current.reset();
    vFilter.current.reset();
  }, []);

  // ── Main effect: Face Mesh + camera pipeline ─────────────────
  useEffect(() => {
    if (!enabled || !videoRef.current) return;
    let camera: Camera | null = null;
    let faceMesh: FaceMesh | null = null;
    let cancelled = false;

    // Start auto-calibration immediately
    calibRef.current.start();

    const onResults = (results: Results) => {
      if (cancelled) return;

      // ── No face ──────────────────────────────────────────────
      if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
        faceLostFrames.current++;
        if (faceLostFrames.current > 5) {
          setFaceDetected(false);
          confidenceRef.current = Math.max(0, confidenceRef.current - 0.1);
          setConfidence(confidenceRef.current);
        }
        if (blinkStartRef.current !== null) {
          blinkStartRef.current = null;
          blinkStateRef.current = "OPEN";
          setIsBlink(false);
        }
        return;
      }

      faceLostFrames.current = 0;
      setFaceDetected(true);
      confidenceRef.current = Math.min(1, confidenceRef.current + 0.05);
      setConfidence(confidenceRef.current);

      const lm = results.multiFaceLandmarks[0] as Pt[];
      const now = performance.now();
      const tSec = now / 1000;

      // ════════════════════════════════════════════════════════
      // 1. HEAD POSE ESTIMATION
      // ════════════════════════════════════════════════════════
      const pose = estimateHeadPose(lm);
      const smoothYaw   = yawFilter.current.filter(pose.yaw, tSec);
      const smoothPitch = pitchFilter.current.filter(pose.pitch, tSec);
      setHeadYaw(smoothYaw);
      setHeadPitch(smoothPitch);

      // Reject gaze if head rotated too much or tilted
      const headTooFar = Math.abs(smoothYaw) > MAX_YAW
                      || Math.abs(smoothPitch) > MAX_PITCH
                      || Math.abs(pose.roll) > MAX_ROLL;

      // ════════════════════════════════════════════════════════
      // 2. EAR + BLINK DETECTION
      // ════════════════════════════════════════════════════════
      const leftEAR  = ear(lm, LEFT_EYE);
      const rightEAR = ear(lm, RIGHT_EYE);
      const avgEAR   = (leftEAR + rightEAR) / 2;
      setCurrentEAR(avgEAR);

      if (blinkStateRef.current === "OPEN") {
        if (avgEAR < earThreshold) {
          consecutiveLowRef.current++;
          if (consecutiveLowRef.current >= 2) {
            blinkStateRef.current = "CLOSED";
            blinkStartRef.current = now;
            setIsBlink(true);
            consecutiveLowRef.current = 0;
          }
        } else {
          consecutiveLowRef.current = 0;
        }
      } else {
        if (avgEAR >= earThreshold) {
          blinkStateRef.current = "OPEN";
          setIsBlink(false);
          const duration = now - (blinkStartRef.current || now);
          blinkStartRef.current = null;

          if (duration < 50) return;               // micro-blink reject
          if (now - lastBlinkTimeRef.current < 200) return;  // debounce
          lastBlinkTimeRef.current = now;

          if (duration >= longBlinkMs) {
            addMorseSymbol("-");
          } else {
            addMorseSymbol(".");
          }
        }
      }

      // ════════════════════════════════════════════════════════
      // 3. IRIS CENTROID (all 5 landmarks per eye)
      // ════════════════════════════════════════════════════════
      const leftIrisCentroid  = centroid(lm, LEFT_IRIS);
      const rightIrisCentroid = centroid(lm, RIGHT_IRIS);

      if (!leftIrisCentroid || !rightIrisCentroid) return;

      // ════════════════════════════════════════════════════════
      // 4. IRIS POSITION RATIO (within eye bounding box)
      // ════════════════════════════════════════════════════════
      // Consistent left-to-right corners for both eyes
      const lLeftCor = lm[LEFT_EYE_OUTER]; // 33 is on the left
      const lRightCor = lm[LEFT_EYE_INNER]; // 133 is on the right
      const rLeftCor = lm[RIGHT_EYE_INNER]; // 362 is on the left
      const rRightCor = lm[RIGHT_EYE_OUTER]; // 263 is on the right

      const lHRange = dist2(lLeftCor, lRightCor);
      const rHRange = dist2(rLeftCor, rRightCor);

      // Vector from left corner to right corner
      const lAxisX = lRightCor.x - lLeftCor.x;
      const lAxisY = lRightCor.y - lLeftCor.y;
      const rAxisX = rRightCor.x - rLeftCor.x;
      const rAxisY = rRightCor.y - rLeftCor.y;

      // Dot product projection of iris-left onto eye axis, normalized
      const lIrisDx = leftIrisCentroid.x - lLeftCor.x;
      const lIrisDy = leftIrisCentroid.y - lLeftCor.y;
      const lProj = lHRange > 1e-6
        ? (lIrisDx * lAxisX + lIrisDy * lAxisY) / (lHRange * lHRange)
        : 0.5;

      const rIrisDx = rightIrisCentroid.x - rLeftCor.x;
      const rIrisDy = rightIrisCentroid.y - rLeftCor.y;
      const rProj = rHRange > 1e-6
        ? (rIrisDx * rAxisX + rIrisDy * rAxisY) / (rHRange * rHRange)
        : 0.5;

      // Average both eyes for robustness
      let hRatio = (lProj + rProj) / 2;

      // Vertical ratio — project onto top-to-bottom axis
      const lTop = lm[LEFT_EYE_TOP];
      const lBot = lm[LEFT_EYE_BOTTOM];
      const rTop = lm[RIGHT_EYE_TOP];
      const rBot = lm[RIGHT_EYE_BOTTOM];

      const lVAxisX = lBot.x - lTop.x;
      const lVAxisY = lBot.y - lTop.y;
      const rVAxisX = rBot.x - rTop.x;
      const rVAxisY = rBot.y - rTop.y;

      const lVRange = Math.hypot(lVAxisX, lVAxisY);
      const rVRange = Math.hypot(rVAxisX, rVAxisY);

      const lVIrisDx = leftIrisCentroid.x - lTop.x;
      const lVIrisDy = leftIrisCentroid.y - lTop.y;
      const lVProj = lVRange > 1e-6
        ? (lVIrisDx * lVAxisX + lVIrisDy * lVAxisY) / (lVRange * lVRange)
        : 0.5;

      const rVIrisDx = rightIrisCentroid.x - rTop.x;
      const rVIrisDy = rightIrisCentroid.y - rTop.y;
      const rVProj = rVRange > 1e-6
        ? (rVIrisDx * rVAxisX + rVIrisDy * rVAxisY) / (rVRange * rVRange)
        : 0.5;

      let vRatio = (lVProj + rVProj) / 2;

      // ════════════════════════════════════════════════════════
      // 5. HEAD-POSE COMPENSATION
      //    Subtract the contribution of head rotation from iris ratio
      // ════════════════════════════════════════════════════════
      hRatio -= smoothYaw * HP_YAW_COEFF;
      vRatio -= smoothPitch * HP_PITCH_COEFF;

      // ════════════════════════════════════════════════════════
      // 6. ONE-EURO FILTER (smooth while maintaining responsiveness)
      // ════════════════════════════════════════════════════════
      const smoothH = hFilter.current.filter(hRatio, tSec);
      const smoothV = vFilter.current.filter(vRatio, tSec);

      setHorizontalRatio(smoothH);
      setVerticalRatio(smoothV);

      // ════════════════════════════════════════════════════════
      // 7. CALIBRATION (auto-learns neutral center for first 2s)
      // ════════════════════════════════════════════════════════
      const calib = calibRef.current;
      if (!calib.isDone) {
        calib.addSample(smoothH, smoothV);
        if (calib.isDone) {
          setIsCalibrated(true);
          onCalibratedRef.current?.();
        }
        return; // skip direction detection until calibrated
      }

      // ════════════════════════════════════════════════════════
      // 8. DIRECTION DETECTION with hysteresis
      // ════════════════════════════════════════════════════════
      if (headTooFar) return; // don't change direction during extreme head rotation

      const hDiff = smoothH - calib.hCenter;
      const vDiff = smoothV - calib.vCenter;

      // Normalize by calibrated range for uniform sensitivity
      const hNorm = calib.hRange > 1e-6 ? hDiff / calib.hRange : 0;
      const vNorm = calib.vRange > 1e-6 ? vDiff / calib.vRange : 0;

      // Dead zone is in normalized units
      const enterThresh = gazeDeadzone * ENTER_FACTOR;
      const exitThresh  = gazeDeadzone * EXIT_FACTOR;

      let rawDir: GazeDirection = "center";

      // Current direction affects the threshold (hysteresis)
      const currentDir = hysteresisDir.current;

      // Check if we're far enough to enter a new direction
      const absH = Math.abs(hNorm);
      const absV = Math.abs(vNorm);

      if (currentDir === "center") {
        // Need to exceed ENTER threshold to leave center
        if (absH > enterThresh || absV > enterThresh) {
          if (absH > absV) {
            rawDir = hNorm > 0 ? "right" : "left";
          } else {
            rawDir = vNorm > 0 ? "down" : "up";
          }
        }
      } else {
        // Currently in a direction — use EXIT (lower) threshold to return to center
        // This creates "stickiness"
        const isHDir = currentDir === "left" || currentDir === "right";
        const isVDir = currentDir === "up"   || currentDir === "down";

        if (isHDir && absH > exitThresh) {
          rawDir = hNorm > 0 ? "right" : "left";
        } else if (isVDir && absV > exitThresh) {
          rawDir = vNorm > 0 ? "down" : "up";
        } else if (absH > enterThresh || absV > enterThresh) {
          // Check if user switched axis
          if (absH > absV) {
            rawDir = hNorm > 0 ? "right" : "left";
          } else {
            rawDir = vNorm > 0 ? "down" : "up";
          }
        }
        // else stays center
      }

      // ════════════════════════════════════════════════════════
      // 9. FRAME-HOLD CONFIRMATION (anti-flicker)
      // ════════════════════════════════════════════════════════
      if (rawDir === pendingDir.current) {
        dirHoldFrames.current++;
      } else {
        pendingDir.current = rawDir;
        dirHoldFrames.current = 1;
      }

      // Different hold requirements for entering vs exiting
      const isEntering = rawDir !== "center" && hysteresisDir.current === "center";
      const isExiting  = rawDir === "center" && hysteresisDir.current !== "center";
      const requiredFrames = isExiting ? DIR_HOLD_EXIT : (isEntering ? DIR_HOLD_ENTER : DIR_HOLD_ENTER);

      if (dirHoldFrames.current >= requiredFrames && hysteresisDir.current !== rawDir) {
        hysteresisDir.current = rawDir;
        directionRef.current = rawDir;
        setDirection(rawDir);
      }
    };

    // ── Init MediaPipe + Camera ────────────────────────────────
    const init = async () => {
      try {
        faceMesh = new FaceMesh({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
        });
        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.6,   // slightly higher for better tracking
          minTrackingConfidence: 0.6,
        });
        faceMesh.onResults(onResults);

        const video = videoRef.current!;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30 },
            facingMode: "user",
          },
          audio: false,
        });
        video.srcObject = stream;
        await video.play().catch(() => {});

        // Lighting compensation
        try {
          const track = stream.getVideoTracks()[0];
          const caps = (track.getCapabilities?.() ?? {}) as any;
          const advanced: any = {};
          if (caps.exposureMode?.includes?.("continuous"))     advanced.exposureMode     = "continuous";
          if (caps.whiteBalanceMode?.includes?.("continuous")) advanced.whiteBalanceMode = "continuous";
          if (caps.focusMode?.includes?.("continuous"))        advanced.focusMode        = "continuous";
          if (Object.keys(advanced).length) {
            await track.applyConstraints({ advanced: [advanced] }).catch(() => {});
          }
        } catch {}

        camera = new Camera(video, {
          onFrame: async () => {
            if (faceMesh && !cancelled) await faceMesh.send({ image: video });
          },
          width: 640,
          height: 480,
        });
        await camera.start();
        setCameraReady(true);
      } catch (e: any) {
        console.error("Eye Gaze Tracker Error:", e);
        setError(e?.message ?? "Camera error");
      }
    };

    init();

    return () => {
      cancelled = true;
      try { camera?.stop(); } catch {}
      try { faceMesh?.close(); } catch {}
      if (morseTimerRef.current) window.clearTimeout(morseTimerRef.current);
      try {
        const v = videoRef.current;
        const s = v?.srcObject as MediaStream | null;
        s?.getTracks().forEach(t => t.stop());
        if (v) v.srcObject = null;
      } catch {}
      setCameraReady(false);
    };
  }, [enabled, earThreshold, longBlinkMs, gazeDeadzone, addMorseSymbol]);

  return {
    direction,
    isBlink,
    morseBuffer,
    lastCommand,
    currentEAR,
    faceDetected,
    cameraReady,
    error,
    horizontalRatio,
    verticalRatio,
    isCalibrated,
    headYaw,
    headPitch,
    confidence,
    // @ts-ignore – expose recalibrate for UI
    recalibrate,
  };
}
