import { useEffect, useRef, useState, useCallback } from "react";
import { FaceMesh, Results } from "@mediapipe/face_mesh";
import { Camera } from "@mediapipe/camera_utils";

// MediaPipe FaceMesh eye landmark indices
const LEFT_EYE = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380];

type Pt = { x: number; y: number };

function dist(a: Pt, b: Pt) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function ear(landmarks: Pt[], idx: number[]): number {
  const p = idx.map((i) => landmarks[i]);
  const v1 = dist(p[1], p[5]);
  const v2 = dist(p[2], p[4]);
  const h = dist(p[0], p[3]);
  return (v1 + v2) / (2 * h);
}

export type BlinkEvent = {
  type: "short" | "long" | "double" | "emergency";
  duration: number;
};

export type CalibrationStatus = "idle" | "calibrating" | "ready";

export interface UseBlinkDetectorOptions {
  videoRef: React.RefObject<HTMLVideoElement>;
  onBlink?: (e: BlinkEvent) => void;
  onEmergency?: () => void;
  enabled: boolean;
  sensitivity: number; // 0..1, scales detection threshold
}

export function useBlinkDetector({
  videoRef,
  onBlink,
  onEmergency,
  enabled,
  sensitivity,
}: UseBlinkDetectorOptions) {
  const [status, setStatus] = useState<CalibrationStatus>("idle");
  const [cameraReady, setCameraReady] = useState(false);
  const [currentEAR, setCurrentEAR] = useState(0);
  const [isClosed, setIsClosed] = useState(false);
  const [calibrationCount, setCalibrationCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const baselineRef = useRef<number>(0.25);
  const closedThresholdRef = useRef<number>(0.18);
  const closeStartRef = useRef<number | null>(null);
  const lastBlinkEndRef = useRef<number>(0);
  const calibrationSamplesRef = useRef<number[]>([]);
  const closedFramesRef = useRef<number>(0);
  const openFramesRef = useRef<number>(0);
  const emergencyFiredRef = useRef<boolean>(false);
  const calibrationBlinksRef = useRef<number>(0);

  const onBlinkRef = useRef(onBlink);
  const onEmergencyRef = useRef(onEmergency);
  useEffect(() => { onBlinkRef.current = onBlink; }, [onBlink]);
  useEffect(() => { onEmergencyRef.current = onEmergency; }, [onEmergency]);

  const startCalibration = useCallback(() => {
    setStatus("calibrating");
    calibrationSamplesRef.current = [];
    calibrationBlinksRef.current = 0;
    setCalibrationCount(0);
  }, []);

  useEffect(() => {
    if (!enabled || !videoRef.current) return;
    let camera: Camera | null = null;
    let faceMesh: FaceMesh | null = null;
    let cancelled = false;

    const onResults = (results: Results) => {
      if (cancelled) return;
      if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) return;
      const landmarks = results.multiFaceLandmarks[0] as Pt[];
      const leftEAR = ear(landmarks, LEFT_EYE);
      const rightEAR = ear(landmarks, RIGHT_EYE);
      const avg = (leftEAR + rightEAR) / 2;
      setCurrentEAR(avg);

      // Sensitivity adjusts threshold (higher sensitivity = easier to trigger blink)
      const sensFactor = 0.55 + (1 - sensitivity) * 0.25; // 0.55..0.80
      const threshold = baselineRef.current * sensFactor;
      closedThresholdRef.current = threshold;
      const closed = avg < threshold;

      if (closed) {
        closedFramesRef.current += 1;
        openFramesRef.current = 0;
      } else {
        openFramesRef.current += 1;
        closedFramesRef.current = 0;
      }

      // Debounced state — need 2 consistent frames to switch
      const stableClosed = closedFramesRef.current >= 2;
      const stableOpen = openFramesRef.current >= 2;

      const now = performance.now();

      if (stableClosed && closeStartRef.current === null) {
        closeStartRef.current = now;
        setIsClosed(true);
      }

      // Emergency: long closure > 2000ms while still closed
      if (closeStartRef.current !== null && !emergencyFiredRef.current) {
        const heldFor = now - closeStartRef.current;
        if (heldFor > 2000 && status === "ready") {
          emergencyFiredRef.current = true;
          onEmergencyRef.current?.();
        }
      }

      if (stableOpen && closeStartRef.current !== null) {
        const duration = now - closeStartRef.current;
        const start = closeStartRef.current;
        closeStartRef.current = null;
        setIsClosed(false);

        // Ignore micro-flickers
        if (duration < 60) return;

        // Reset emergency latch on eye open
        emergencyFiredRef.current = false;

        if (status === "calibrating") {
          calibrationSamplesRef.current.push(avg);
          calibrationBlinksRef.current += 1;
          setCalibrationCount(calibrationBlinksRef.current);
          if (calibrationBlinksRef.current >= 3) {
            // Use baseline EAR captured during open frames (avg of recent baseline)
            // Set a robust baseline: use current avg when eye is open after blinks
            // baselineRef holds running open-eye EAR from below
            setStatus("ready");
          }
          return;
        }

        if (status !== "ready") return;

        // Double blink detection: two short blinks within 500ms
        const sinceLast = start - lastBlinkEndRef.current;
        lastBlinkEndRef.current = now;

        if (duration > 700) {
          onBlinkRef.current?.({ type: "long", duration });
        } else if (sinceLast < 500 && duration < 350) {
          onBlinkRef.current?.({ type: "double", duration });
        } else {
          onBlinkRef.current?.({ type: "short", duration });
        }
      }

      // Update baseline from open-eye EAR (slow EMA)
      if (!closed) {
        baselineRef.current = baselineRef.current * 0.97 + avg * 0.03;
      }
    };

    const init = async () => {
      try {
        faceMesh = new FaceMesh({
          locateFile: (file) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
        });
        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        faceMesh.onResults(onResults);

        const video = videoRef.current!;
        camera = new Camera(video, {
          onFrame: async () => {
            if (faceMesh && !cancelled) await faceMesh.send({ image: video });
          },
          width: 480,
          height: 360,
        });
        await camera.start();
        setCameraReady(true);
      } catch (e: any) {
        console.error(e);
        setError(e?.message ?? "Camera error");
      }
    };

    init();

    return () => {
      cancelled = true;
      try { camera?.stop(); } catch {}
      try { faceMesh?.close(); } catch {}
      setCameraReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, status, sensitivity]);

  return {
    status,
    cameraReady,
    currentEAR,
    threshold: closedThresholdRef.current,
    isClosed,
    calibrationCount,
    error,
    startCalibration,
  };
}
