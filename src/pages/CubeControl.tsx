import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useEyeGazeTracker, GazeDirection, MorseCommand } from "@/hooks/useEyeGazeTracker";
import { useNavigate } from "react-router-dom";

// ── Voice Feedback ─────────────────────────────────────────────────
let speaking = false;
function voiceFeedback(text: string) {
  if (!("speechSynthesis" in window)) return;

  // Instantly cut off previous speech for a snappier response
  window.speechSynthesis.cancel();

  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.2;
  u.pitch = 0.9;
  u.volume = 0.7;
  window.speechSynthesis.speak(u);
}

// ── Direction mapping to 3D vector ─────────────────────────────────
const DIR_VEC: Record<GazeDirection, THREE.Vector3> = {
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
  up: new THREE.Vector3(0, 0, -1),
  down: new THREE.Vector3(0, 0, 1),
  center: new THREE.Vector3(0, 0, 0),
};

const DIR_COLORS: Record<GazeDirection, number> = {
  left: 0x00d4ff,
  right: 0xff6b35,
  up: 0x7c4dff,
  down: 0x00e676,
  center: 0x64ffda,
};

const DIR_LABELS: Record<GazeDirection, string> = {
  left: "← LEFT",
  right: "RIGHT →",
  up: "↑ UP",
  down: "↓ DOWN",
  center: "● CENTER",
};

const CMD_LABELS: Record<MorseCommand, string> = {
  move: "Move One Step",
  continuous: "Continuous Move",
  stop: "Stop",
  reset: "Reset Position",
};

// ── 3D Scene Setup ─────────────────────────────────────────────────
function createScene(container: HTMLDivElement) {
  const w = container.clientWidth;
  const h = container.clientHeight;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x080b13, 0.015);

  const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 200);
  camera.position.set(0, 6, 12);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  container.appendChild(renderer.domElement);

  // ── Grid floor ──────────────────────────────────────────────────
  const gridHelper = new THREE.GridHelper(40, 40, 0x1a2744, 0x111a2e);
  scene.add(gridHelper);

  // Reflective floor
  const floorGeo = new THREE.PlaneGeometry(40, 40);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x080b13,
    roughness: 0.3,
    metalness: 0.8,
    transparent: true,
    opacity: 0.6,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  floor.receiveShadow = true;
  scene.add(floor);

  // ── Cube ────────────────────────────────────────────────────────
  const cubeGeo = new THREE.BoxGeometry(1.4, 1.4, 1.4, 2, 2, 2);
  const cubeMat = new THREE.MeshPhysicalMaterial({
    color: 0x64ffda,
    metalness: 0.3,
    roughness: 0.15,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    transmission: 0.1,
    thickness: 0.5,
    emissive: 0x64ffda,
    emissiveIntensity: 0.15,
  });
  const cube = new THREE.Mesh(cubeGeo, cubeMat);
  cube.position.set(0, 0.9, 0);
  cube.castShadow = true;
  cube.receiveShadow = true;
  scene.add(cube);

  // Wireframe overlay
  const wireGeo = new THREE.BoxGeometry(1.48, 1.48, 1.48);
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0x64ffda,
    wireframe: true,
    transparent: true,
    opacity: 0.12,
  });
  const wireframe = new THREE.Mesh(wireGeo, wireMat);
  cube.add(wireframe);

  // Edge glow
  const edgesGeo = new THREE.EdgesGeometry(cubeGeo);
  const edgesMat = new THREE.LineBasicMaterial({ color: 0x64ffda, transparent: true, opacity: 0.5 });
  const edges = new THREE.LineSegments(edgesGeo, edgesMat);
  cube.add(edges);

  // ── Trail line ──────────────────────────────────────────────────
  const maxTrailPoints = 200;
  const trailGeo = new THREE.BufferGeometry();
  const trailPositions = new Float32Array(maxTrailPoints * 3);
  trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPositions, 3));
  trailGeo.setDrawRange(0, 0);
  const trailMat = new THREE.LineBasicMaterial({
    color: 0x00f0ff,
    transparent: true,
    opacity: 0.3,
  });
  const trail = new THREE.Line(trailGeo, trailMat);
  trail.position.y = 0.05;
  scene.add(trail);

  // ── Direction arrow ─────────────────────────────────────────────
  const arrowHelper = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0.9, 0),
    2,
    0x00f0ff,
    0.4,
    0.2
  );
  arrowHelper.visible = false;
  scene.add(arrowHelper);

  // ── Particles ───────────────────────────────────────────────────
  const particleCount = 120;
  const particleGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  for (let i = 0; i < particleCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 30;
    positions[i * 3 + 1] = Math.random() * 8;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 30;
    sizes[i] = Math.random() * 3 + 0.5;
  }
  particleGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  particleGeo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  const particleMat = new THREE.PointsMaterial({
    color: 0x00f0ff,
    size: 0.08,
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const particles = new THREE.Points(particleGeo, particleMat);
  scene.add(particles);

  // ── Lighting ────────────────────────────────────────────────────
  const ambientLight = new THREE.AmbientLight(0x334477, 0.5);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(5, 10, 7);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 50;
  dirLight.shadow.camera.left = -15;
  dirLight.shadow.camera.right = 15;
  dirLight.shadow.camera.top = 15;
  dirLight.shadow.camera.bottom = -15;
  scene.add(dirLight);

  const pointLight1 = new THREE.PointLight(0x00f0ff, 1.5, 20);
  pointLight1.position.set(-5, 4, 5);
  scene.add(pointLight1);

  const pointLight2 = new THREE.PointLight(0x7c4dff, 1.2, 20);
  pointLight2.position.set(5, 3, -5);
  scene.add(pointLight2);

  // Spotlight that follows the cube
  const spotLight = new THREE.SpotLight(0x64ffda, 2, 15, Math.PI / 6, 0.5);
  spotLight.position.set(0, 8, 0);
  spotLight.castShadow = true;
  scene.add(spotLight);

  return {
    scene, camera, renderer, cube, cubeMat, wireframe, wireMat,
    edges, edgesMat, trail, trailGeo, trailPositions, maxTrailPoints,
    arrowHelper, particles, particleGeo, spotLight, floor, floorMat,
  };
}

// ── Component ──────────────────────────────────────────────────────
const CubeControl = () => {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ReturnType<typeof createScene> | null>(null);
  const animFrameRef = useRef<number>(0);

  // State
  const [sensitivity, setSensitivity] = useState(0.08);
  const [earThreshold, setEarThreshold] = useState(0.21);
  const [longBlinkMs, setLongBlinkMs] = useState(400);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [moveLog, setMoveLog] = useState<{ id: string; msg: string; color: string }[]>([]);

  // Cube movement state (refs for animation loop)
  const cubeTargetPos = useRef(new THREE.Vector3(0, 0.9, 0));
  const cubeVelocity = useRef(new THREE.Vector3(0, 0, 0));
  const isMoving = useRef(false);
  const continuousDir = useRef<GazeDirection>("center");
  const trailIndex = useRef(0);
  const lastTrailPos = useRef(new THREE.Vector3(0, 0, 0));

  // Movement bounds
  const BOUNDS = 8;
  const STEP_SIZE = 1.5;
  const SMOOTH_SPEED = 3.5;       // Lower = more floaty 
  const CONTINUOUS_SPEED = 5.0;   // Higher = covers ground faster

  // Log helper
  const addLog = useCallback((msg: string, color: string) => {
    setMoveLog(prev => [{ id: crypto.randomUUID(), msg, color }, ...prev].slice(0, 12));
  }, []);

  // Handle explicit commands (from keyboard or UI buttons)
  const handleCommand = useCallback((command: "reset" | "stop") => {
    switch (command) {
      case "stop": {
        continuousDir.current = "center";
        isMoving.current = false;
        addLog("STOP", "amber");
        break;
      }
      case "reset": {
        cubeTargetPos.current.set(0, 0.9, 0);
        continuousDir.current = "center";
        isMoving.current = true;
        trailIndex.current = 0;
        addLog("RESET", "red");
        if (voiceEnabled) voiceFeedback("Reset");
        break;
      }
    }
  }, [addLog, voiceEnabled]);

  // ── Eye Gaze Tracker ────────────────────────────────────────────
  const gaze = useEyeGazeTracker({
    videoRef,
    enabled: true,
    earThreshold,
    longBlinkMs,
    gazeDeadzone: sensitivity,
    onMove: () => { }, // Not used anymore, we use an effect to track continuous gaze
    onCalibrated: () => addLog("CALIBRATED ✓", "green"),
  });
  const recalibrate = (gaze as any).recalibrate;

  // ── Pure Gaze Movement Logic ────────────────────────────────────
  // When gaze direction changes, update the continuous movement direction
  useEffect(() => {
    if (gaze.direction !== continuousDir.current) {
      continuousDir.current = gaze.direction;
      isMoving.current = gaze.direction !== "center";

      if (gaze.direction !== "center") {
        addLog(`Moving ${DIR_LABELS[gaze.direction]}`, "purple");
        if (voiceEnabled) voiceFeedback(`Moving ${gaze.direction}`);
      } else {
        if (isMoving.current) {
          addLog("Center (Stopped)", "gray");
        }
      }
    }
  }, [gaze.direction, addLog, voiceEnabled]);

  // ── 3D Scene Lifecycle ──────────────────────────────────────────
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    const s = createScene(container);
    sceneRef.current = s;
    const clock = new THREE.Clock();

    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      const dt = clock.getDelta();
      const t = clock.getElapsedTime();

      // ── Cube smooth movement ──────────────────────────────────
      if (continuousDir.current !== "center") {
        const vec = DIR_VEC[continuousDir.current].clone().multiplyScalar(CONTINUOUS_SPEED * dt);
        cubeTargetPos.current.add(vec);
        cubeTargetPos.current.x = Math.max(-BOUNDS, Math.min(BOUNDS, cubeTargetPos.current.x));
        cubeTargetPos.current.z = Math.max(-BOUNDS, Math.min(BOUNDS, cubeTargetPos.current.z));
        cubeTargetPos.current.y = 0.9;
      }

      s.cube.position.lerp(cubeTargetPos.current, SMOOTH_SPEED * dt);

      // ── Idle hover bob ────────────────────────────────────────
      const bobAmount = continuousDir.current === "center" && !isMoving.current ? 0.08 : 0.03;
      s.cube.position.y = 0.9 + Math.sin(t * 2) * bobAmount;

      // ── Cube lean & rotation ──────────────────────────────────
      const moveDir = cubeTargetPos.current.clone().sub(s.cube.position);

      // Target tilt based on velocity (leaning into the curve)
      const targetPitch = moveDir.z * 0.4;
      const targetRoll = -moveDir.x * 0.4;

      const rotSnappiness = 5;
      s.cube.rotation.x = THREE.MathUtils.lerp(s.cube.rotation.x, targetPitch, rotSnappiness * dt);
      s.cube.rotation.z = THREE.MathUtils.lerp(s.cube.rotation.z, targetRoll, rotSnappiness * dt);

      // Gentle idle spin on Y
      s.cube.rotation.y += 0.4 * dt;

      // ── Trail ─────────────────────────────────────────────────
      const cubePos2D = new THREE.Vector3(s.cube.position.x, 0, s.cube.position.z);
      if (cubePos2D.distanceTo(lastTrailPos.current) > 0.15 && trailIndex.current < s.maxTrailPoints) {
        const idx = trailIndex.current;
        s.trailPositions[idx * 3] = cubePos2D.x;
        s.trailPositions[idx * 3 + 1] = 0.05;
        s.trailPositions[idx * 3 + 2] = cubePos2D.z;
        trailIndex.current++;
        s.trailGeo.attributes.position.needsUpdate = true;
        s.trailGeo.setDrawRange(0, trailIndex.current);
        lastTrailPos.current.copy(cubePos2D);
      }

      // ── Spotlight follow ──────────────────────────────────────
      s.spotLight.position.set(s.cube.position.x, 8, s.cube.position.z);
      s.spotLight.target = s.cube;

      // ── Particles drift ───────────────────────────────────────
      const pPos = s.particleGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pPos.count; i++) {
        pPos.setY(i, pPos.getY(i) + Math.sin(t + i) * 0.002);
        const x = pPos.getX(i);
        if (x < -15) pPos.setX(i, 15);
        pPos.setX(i, x - 0.005);
      }
      pPos.needsUpdate = true;

      // ── Camera follow ─────────────────────────────────────────
      const camTarget = new THREE.Vector3(
        s.cube.position.x * 0.3,
        6,
        s.cube.position.z * 0.3 + 12
      );
      s.camera.position.lerp(camTarget, 2 * dt);
      s.camera.lookAt(s.cube.position.x * 0.5, 0, s.cube.position.z * 0.5);

      s.renderer.render(s.scene, s.camera);
    };

    animate();

    // Resize handler
    const handleResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      s.camera.aspect = w / h;
      s.camera.updateProjectionMatrix();
      s.renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener("resize", handleResize);
      s.renderer.dispose();
      container.innerHTML = "";
    };
  }, []);

  // ── Update cube color based on gaze direction ───────────────────
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;

    const color = new THREE.Color(DIR_COLORS[gaze.direction]);
    s.cubeMat.color.copy(color);
    s.cubeMat.emissive.copy(color);
    s.edgesMat.color.copy(color);
    s.wireMat.color.copy(color);

    // Update arrow
    if (gaze.direction !== "center") {
      s.arrowHelper.visible = true;
      s.arrowHelper.setDirection(DIR_VEC[gaze.direction].clone().normalize());
      s.arrowHelper.setColor(color);
      s.arrowHelper.position.copy(s.cube.position);
    } else {
      s.arrowHelper.visible = false;
    }
  }, [gaze.direction]);

  // ── Keyboard fallback ───────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") { continuousDir.current = "left"; isMoving.current = true; }
      if (e.key === "ArrowRight") { continuousDir.current = "right"; isMoving.current = true; }
      if (e.key === "ArrowUp") { continuousDir.current = "up"; isMoving.current = true; }
      if (e.key === "ArrowDown") { continuousDir.current = "down"; isMoving.current = true; }
      if (e.key === "r") handleCommand("reset");
      if (e.key === " ") {
        e.preventDefault();
        handleCommand("stop");
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        continuousDir.current = "center";
        isMoving.current = false;
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [handleCommand]);

  return (
    <div className="flex h-screen bg-[#060910] text-[#e2e8f0] overflow-hidden select-none">

      {/* ── LEFT SIDEBAR ── */}
      <div className="w-[340px] flex flex-col border-r border-[#1a2744] bg-[#080b13]/90 backdrop-blur-sm">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1a2744]">
          <div className="relative">
            <div className="w-3 h-3 rounded-full bg-[#00f0ff] animate-pulse" />
            <div className="absolute inset-0 w-3 h-3 rounded-full bg-[#00f0ff] animate-ping opacity-40" />
          </div>
          <div>
            <div className="text-[#00f0ff] font-bold text-sm tracking-[0.2em] uppercase">PURE GAZE</div>
            <div className="text-[9px] text-gray-500 tracking-widest">CONTINUOUS EYE TRACKING</div>
          </div>
          <button
            onClick={() => navigate("/")}
            className="ml-auto text-[10px] text-gray-500 hover:text-[#00f0ff] border border-[#1a2744] hover:border-[#00f0ff]/50 px-2 py-1 rounded transition-colors"
          >
            ← BACK
          </button>
        </div>

        {/* Camera Feed */}
        <div className="relative aspect-[4/3] bg-black m-3 rounded-lg border border-[#1a2744] overflow-hidden flex-shrink-0">
          <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${gaze.cameraReady ? "bg-[#4ade80] animate-pulse" : "bg-red-500"}`} />
            <span className={`text-[9px] font-bold tracking-widest ${gaze.cameraReady ? "text-[#4ade80]" : "text-red-400"}`}>
              {gaze.cameraReady ? "LIVE" : "NO CAMERA"}
            </span>
          </div>
          <video ref={videoRef} className="w-full h-full object-cover scale-x-[-1]" playsInline muted />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:100%_3px] pointer-events-none" />

          {/* Direction overlay on camera */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 flex justify-between items-end">
            <div className={`text-xs font-bold tracking-wider ${gaze.faceDetected ? "text-[#00f0ff]" : "text-red-400"}`}>
              {gaze.faceDetected ? `👁️ ${DIR_LABELS[gaze.direction]}` : "⚠ NO FACE"}
            </div>
          </div>
        </div>

        {/* Eye Metrics */}
        <div className="px-3 flex flex-col gap-2">
          <div className="text-[9px] text-gray-500 tracking-widest uppercase flex items-center justify-between">
            EYE METRICS
            <div className="flex items-center gap-1.5">
              <span className={`text-[8px] font-bold ${gaze.isCalibrated ? 'text-[#4ade80]' : 'text-amber-400 animate-pulse'}`}>
                {gaze.isCalibrated ? '● CALIBRATED' : '◌ CALIBRATING...'}
              </span>
            </div>
          </div>
          <div className="grid gap-2">
            <div className="bg-[#0d111b] border border-[#1a2744] rounded-lg p-2">
              <div className="text-[8px] text-gray-500 tracking-widest flex items-center justify-between">
                <span>TRACKING CONFIDENCE</span>
                <span className={`font-bold ${gaze.confidence > 0.7 ? 'text-[#4ade80]' : gaze.confidence > 0.4 ? 'text-amber-400' : 'text-red-400'}`}>
                  {(gaze.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <div className="h-1.5 bg-[#1a2744] rounded-full mt-1.5 overflow-hidden">
                <div className={`h-full transition-all duration-200 rounded-full ${gaze.confidence > 0.7 ? 'bg-[#4ade80]' : gaze.confidence > 0.4 ? 'bg-amber-400' : 'bg-red-400'
                  }`}
                  style={{ width: `${gaze.confidence * 100}%` }} />
              </div>
            </div>
          </div>

          {/* Head Pose Indicators */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-[#0d111b] border border-[#1a2744] rounded-lg p-1.5">
              <div className="text-[7px] text-gray-500 tracking-widest flex justify-between">
                <span>HEAD YAW</span>
                <span className={Math.abs(gaze.headYaw) > 20 ? 'text-red-400' : 'text-gray-400'}>{gaze.headYaw.toFixed(1)}°</span>
              </div>
              <div className="h-1.5 bg-[#1a2744] rounded-full mt-1 overflow-hidden relative">
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-600" />
                <div className="absolute h-full bg-[#ff6b35] rounded-full transition-all duration-100"
                  style={{
                    width: `${Math.min(50, Math.abs(gaze.headYaw) * 2)}%`,
                    left: gaze.headYaw >= 0 ? '50%' : `${50 - Math.min(50, Math.abs(gaze.headYaw) * 2)}%`,
                  }} />
              </div>
            </div>
            <div className="bg-[#0d111b] border border-[#1a2744] rounded-lg p-1.5">
              <div className="text-[7px] text-gray-500 tracking-widest flex justify-between">
                <span>HEAD PITCH</span>
                <span className={Math.abs(gaze.headPitch) > 15 ? 'text-red-400' : 'text-gray-400'}>{gaze.headPitch.toFixed(1)}°</span>
              </div>
              <div className="h-1.5 bg-[#1a2744] rounded-full mt-1 overflow-hidden relative">
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-600" />
                <div className="absolute h-full bg-[#7c4dff] rounded-full transition-all duration-100"
                  style={{
                    width: `${Math.min(50, Math.abs(gaze.headPitch) * 2.5)}%`,
                    left: gaze.headPitch >= 0 ? '50%' : `${50 - Math.min(50, Math.abs(gaze.headPitch) * 2.5)}%`,
                  }} />
              </div>
            </div>
          </div>

          {/* Gaze Crosshair */}
          <div className="bg-[#0d111b] border border-[#1a2744] rounded-lg p-2 relative h-[80px] overflow-hidden">
            <div className="text-[8px] text-gray-500 tracking-widest absolute top-1 left-2">GAZE MAP</div>
            <div className="text-[7px] text-gray-600 absolute top-1 right-2">H:{gaze.horizontalRatio.toFixed(3)} V:{gaze.verticalRatio.toFixed(3)}</div>
            {/* Crosshairs */}
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[#1a2744]" />
            <div className="absolute top-1/2 left-0 right-0 h-px bg-[#1a2744]" />
            {/* Labels */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[7px] text-gray-600">UP</div>
            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[7px] text-gray-600">DOWN</div>
            <div className="absolute left-1 top-1/2 -translate-y-1/2 text-[7px] text-gray-600">L</div>
            <div className="absolute right-1 top-1/2 -translate-y-1/2 text-[7px] text-gray-600">R</div>
            {/* Dot */}
            <div
              className={`absolute w-3 h-3 rounded-full shadow-[0_0_8px_#00f0ff] transition-all duration-150 ${gaze.direction !== 'center'
                  ? 'bg-[#ff6b35] shadow-[0_0_10px_#ff6b35]'
                  : 'bg-[#00f0ff]'
                }`}
              style={{
                left: `${gaze.horizontalRatio * 100}%`,
                top: `${gaze.verticalRatio * 100}%`,
                transform: "translate(-50%, -50%)",
              }}
            />
            {/* Dead zone circle */}
            <div
              className="absolute border border-dashed border-gray-600 rounded-full"
              style={{
                left: "50%",
                top: "50%",
                width: `${sensitivity * 100 * 12}%`,
                height: `${sensitivity * 100 * 12}%`,
                transform: "translate(-50%, -50%)",
              }}
            />
            {/* Active direction sector highlight */}
            {gaze.direction !== 'center' && (
              <div className={`absolute text-[7px] font-bold text-[#ff6b35] animate-pulse ${gaze.direction === 'left' ? 'left-1 top-1/2 -translate-y-1/2' :
                  gaze.direction === 'right' ? 'right-1 top-1/2 -translate-y-1/2' :
                    gaze.direction === 'up' ? 'left-1/2 top-2 -translate-x-1/2' :
                      'left-1/2 bottom-1 -translate-x-1/2'
                }`}>
                ●
              </div>
            )}
          </div>

          {/* Recalibrate button */}
          <button
            onClick={recalibrate}
            className="w-full py-1.5 bg-transparent text-[9px] text-gray-500 hover:text-[#00f0ff] border border-[#1a2744] hover:border-[#00f0ff]/30 rounded tracking-widest uppercase transition-colors"
          >
            ↻ RECALIBRATE GAZE
          </button>

          {/* Instructions */}
          <div className="bg-[#0d111b] border border-[#1a2744] rounded-lg p-2 mt-2">
            <div className="text-[8px] text-gray-500 tracking-widest mb-1.5 uppercase">Movement Instructions</div>
            <div className="grid grid-cols-2 gap-y-1.5 text-[10px] text-gray-400">
              <div className="flex items-center gap-1.5"><span className="text-[#00f0ff] text-[11px] font-bold">↑</span> Look UP</div>
              <div className="flex items-center gap-1.5"><span className="text-[#00f0ff] text-[11px] font-bold">↓</span> Look DOWN</div>
              <div className="flex items-center gap-1.5"><span className="text-[#00f0ff] text-[11px] font-bold">←</span> Look LEFT</div>
              <div className="flex items-center gap-1.5"><span className="text-[#00f0ff] text-[11px] font-bold">→</span> Look RIGHT</div>
            </div>
            <div className="mt-1.5 px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded text-center text-[10px] text-amber-400 font-medium tracking-wide">
              ● Look <span className="text-[#00f0ff]">CENTER</span> to Stop
            </div>
          </div>
        </div>

        {/* Command Log */}
        <div className="flex-1 px-3 py-2 mt-2 border-t border-[#1a2744] overflow-hidden flex flex-col min-h-[100px]">
          <div className="text-[9px] text-gray-500 tracking-widest mb-2">COMMAND LOG</div>
          <div className="flex-1 overflow-y-auto space-y-1 text-[11px]">
            {moveLog.map(log => (
              <div key={log.id} className={`flex items-center gap-2 ${log.color === "cyan" ? "text-[#00f0ff]" :
                  log.color === "purple" ? "text-[#7c4dff]" :
                    log.color === "amber" ? "text-amber-400" :
                      log.color === "red" ? "text-red-400" :
                        "text-green-400"
                }`}>
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${log.color === "cyan" ? "bg-[#00f0ff]" :
                    log.color === "purple" ? "bg-[#7c4dff]" :
                      log.color === "amber" ? "bg-amber-400" :
                        log.color === "red" ? "bg-red-400" :
                          "bg-green-400"
                  }`} />
                <span className="font-medium">{log.msg}</span>
              </div>
            ))}
            {moveLog.length === 0 && (
              <div className="text-gray-600 text-[10px] italic">Waiting for commands...</div>
            )}
          </div>
        </div>

        {/* Settings toggle */}
        <div className="px-3 pb-3 mt-auto border-t border-[#1a2744] pt-2">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="w-full text-[10px] text-gray-500 hover:text-[#00f0ff] uppercase tracking-widest py-1.5 border border-[#1a2744] rounded hover:border-[#00f0ff]/30 transition-colors"
          >
            {showSettings ? "▲ HIDE SETTINGS" : "▼ SHOW SETTINGS"}
          </button>

          {showSettings && (
            <div className="mt-2 flex flex-col gap-3 animate-in fade-in duration-200">
              {[{
                label: "Gaze deadzone", val: sensitivity, min: 0.03, max: 0.2, step: 0.01,
                set: setSensitivity, unit: "",
              }].map(({ label, val, min, max, step, set, unit }) => (
                <div key={label} className="flex flex-col gap-1">
                  <div className="flex justify-between text-[9px] text-gray-400">
                    <span>{label}</span>
                    <span className="text-[#00f0ff]">{typeof val === "number" ? val.toFixed(2) : val}{unit}</span>
                  </div>
                  <input type="range" min={min} max={max} step={step} value={val}
                    onChange={e => set(Number(e.target.value))}
                    className="w-full h-1 accent-[#00f0ff] bg-[#1a2744] appearance-none rounded cursor-pointer" />
                </div>
              ))}

              <div className="flex items-center justify-between">
                <span className="text-[9px] text-gray-400 tracking-widest">VOICE FEEDBACK</span>
                <div className="flex items-center gap-2 cursor-pointer" onClick={() => setVoiceEnabled(!voiceEnabled)}>
                  <div className={`w-7 h-3.5 rounded-full transition-colors relative ${voiceEnabled ? "bg-[#00f0ff]" : "bg-[#1a2744]"}`}>
                    <div className={`absolute top-0.5 left-0.5 w-2.5 h-2.5 bg-white rounded-full transition-transform ${voiceEnabled ? "translate-x-3.5" : ""}`} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── MAIN AREA ── */}
      <div className="flex-1 flex flex-col">

        {/* Top status bar */}
        <div className="flex items-center justify-between px-6 py-2 border-b border-[#1a2744] bg-[#080b13]/60 backdrop-blur-sm">
          <div className="flex items-center gap-6">
            {/* Direction indicator */}
            <div className="flex items-center gap-2">
              <div className="text-[9px] text-gray-500 tracking-widest">DIRECTION</div>
              <div className={`text-sm font-bold tracking-wider px-3 py-1 rounded border transition-all duration-200 ${gaze.direction === "center"
                  ? "text-gray-400 border-[#1a2744]"
                  : "text-[#00f0ff] border-[#00f0ff]/30 bg-[#00f0ff]/5 shadow-[0_0_10px_rgba(0,240,255,0.1)]"
                }`}>
                {DIR_LABELS[gaze.direction]}
              </div>
            </div>

            {/* Face detected */}
            <div className="flex items-center gap-2">
              <div className="text-[9px] text-gray-500 tracking-widest">FACE</div>
              <div className={`w-4 h-4 rounded transition-all duration-300 ${gaze.faceDetected
                  ? "bg-[#4ade80] shadow-[0_0_8px_rgba(74,222,128,0.5)]"
                  : "bg-red-500/50"
                }`} />
            </div>

            {/* Head pose warning */}
            {(Math.abs(gaze.headYaw) > 20 || Math.abs(gaze.headPitch) > 15) && (
              <div className="flex items-center gap-1.5 text-[9px] text-amber-400 animate-pulse">
                <span>⚠</span>
                <span>HEAD {Math.abs(gaze.headYaw) > 20 ? 'TURNED' : 'TILTED'}</span>
              </div>
            )}
          </div>
        </div>

        {/* 3D Canvas */}
        <div ref={canvasContainerRef} className="flex-1 relative">
          {/* Vignette overlay */}
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: "radial-gradient(ellipse at center, transparent 60%, rgba(6,9,16,0.6) 100%)" }} />

          {/* Error overlay */}
          {gaze.error && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#060910]/90 z-20">
              <div className="text-center">
                <div className="text-red-400 text-xl font-bold mb-2">⚠ CAMERA ERROR</div>
                <div className="text-gray-400 text-sm max-w-md">{gaze.error}</div>
                <div className="text-gray-500 text-xs mt-4">Check camera permissions and refresh</div>
              </div>
            </div>
          )}

          {/* Calibration overlay */}
          {gaze.cameraReady && !gaze.error && !gaze.isCalibrated && gaze.faceDetected && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-5 py-3 bg-[#00f0ff]/10 border border-[#00f0ff]/40 rounded-lg text-[#00f0ff] text-xs tracking-wider text-center">
              <div className="font-bold animate-pulse mb-1">◌ AUTO-CALIBRATING GAZE</div>
              <div className="text-gray-400 text-[10px]">Look straight at the screen — learning your neutral center...</div>
            </div>
          )}

          {/* No face warning */}
          {!gaze.faceDetected && gaze.cameraReady && !gaze.error && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-4 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400 text-xs tracking-wider animate-pulse">
              ⚠ NO FACE DETECTED — POSITION YOUR FACE IN THE CAMERA
            </div>
          )}
        </div>

        {/* Bottom Status Panel */}
        <div className="border-t border-[#1a2744] bg-[#080b13]/80 backdrop-blur-sm px-6 py-3">
          <div className="flex items-center justify-between">
            {/* Legend */}
            <div className="flex items-center gap-6 text-[10px] text-gray-500">
              <div className="flex items-center gap-1.5">
                <span className="text-[#00f0ff] font-bold">●</span>
                <span>Look to Move (Continuous)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-gray-400 font-bold">○</span>
                <span>Center to Stop</span>
              </div>
            </div>

            {/* Reset button */}
            <div className="flex gap-2">
              <button
                onClick={() => handleCommand("reset")}
                className="text-[10px] text-gray-500 hover:text-red-400 border border-[#1a2744] hover:border-red-400/50 px-3 py-1.5 rounded transition-colors tracking-widest"
              >
                ↺ RESET
              </button>
              <button
                onClick={() => handleCommand("stop")}
                className="text-[10px] text-gray-500 hover:text-amber-400 border border-[#1a2744] hover:border-amber-400/50 px-3 py-1.5 rounded transition-colors tracking-widest"
              >
                ■ STOP
              </button>
            </div>
          </div>

          {/* Keyboard shortcut help */}
          <div className="flex gap-4 mt-2 text-[9px] text-gray-600">
            <span>⌨ Arrow keys = move</span>
            <span>R = reset</span>
            <span>Space = stop</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CubeControl;
