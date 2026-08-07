"use client";

import React, {
  useRef,
  useState,
  useEffect,
  useMemo,
  useCallback,
  createContext,
  useContext,
} from "react";
import * as THREE from "three";
import { Canvas, useFrame, ThreeEvent } from "@react-three/fiber";
import {
  Environment,
  ContactShadows,
  Html,
  RoundedBox,
} from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { motion, AnimatePresence } from "framer-motion";

/* ============================================================
   TYPES
============================================================ */

type RobotState =
  | "booting"
  | "idle"
  | "thinking"
  | "searching"
  | "listening"
  | "typing"
  | "answering"
  | "happy"
  | "excited"
  | "celebrating"
  | "confused"
  | "curious"
  | "warning"
  | "error"
  | "offline"
  | "sleeping"
  | "charging"
  | "lowBattery"
  | "updating"
  | "disconnected";

type Expression =
  | "neutral"
  | "smile"
  | "sad"
  | "surprised"
  | "angry"
  | "curious"
  | "sleepy"
  | "heartEyes"
  | "loading"
  | "scanning"
  | "blink"
  | "wink"
  | "happyEyes";

interface StateConfig {
  expression: Expression;
  glow: number;
  color: string;
  speed: number; // animation speed multiplier
  chestPulse: number;
}

interface RobotContextValue {
  state: RobotState;
  setState: (s: RobotState) => void;
  config: StateConfig;
  reducedMotion: boolean;
}

/* ============================================================
   CONSTANTS
============================================================ */

const COLOR = {
  shellLight: "#e9edf1",
  shellDark: "#232629",
  carbon: "#15171a",
  accent: "#37e6e0",
  accentWarm: "#ffb648",
  accentRed: "#ff5b5b",
  visorGlass: "#0a1012",
  rubber: "#1c1e21",
};

const STATE_CONFIG: Record<RobotState, StateConfig> = {
  booting: { expression: "loading", glow: 0.6, color: COLOR.accent, speed: 0.6, chestPulse: 0.4 },
  idle: { expression: "neutral", glow: 1.0, color: COLOR.accent, speed: 1.0, chestPulse: 1.0 },
  thinking: { expression: "curious", glow: 1.1, color: COLOR.accent, speed: 0.8, chestPulse: 1.3 },
  searching: { expression: "scanning", glow: 1.2, color: COLOR.accent, speed: 1.4, chestPulse: 1.4 },
  listening: { expression: "surprised", glow: 1.15, color: COLOR.accent, speed: 1.0, chestPulse: 1.1 },
  typing: { expression: "neutral", glow: 1.0, color: COLOR.accent, speed: 1.6, chestPulse: 1.6 },
  answering: { expression: "smile", glow: 1.1, color: COLOR.accent, speed: 1.0, chestPulse: 1.2 },
  happy: { expression: "happyEyes", glow: 1.3, color: COLOR.accent, speed: 1.1, chestPulse: 1.3 },
  excited: { expression: "surprised", glow: 1.5, color: COLOR.accentWarm, speed: 1.8, chestPulse: 1.8 },
  celebrating: { expression: "heartEyes", glow: 1.6, color: COLOR.accentWarm, speed: 2.0, chestPulse: 2.0 },
  confused: { expression: "sad", glow: 0.9, color: COLOR.accentWarm, speed: 0.7, chestPulse: 0.8 },
  curious: { expression: "curious", glow: 1.1, color: COLOR.accent, speed: 0.9, chestPulse: 1.1 },
  warning: { expression: "surprised", glow: 1.3, color: COLOR.accentWarm, speed: 1.3, chestPulse: 1.5 },
  error: { expression: "angry", glow: 1.4, color: COLOR.accentRed, speed: 0.4, chestPulse: 0.3 },
  offline: { expression: "sleepy", glow: 0.2, color: COLOR.shellDark, speed: 0.2, chestPulse: 0.1 },
  sleeping: { expression: "sleepy", glow: 0.15, color: COLOR.accent, speed: 0.3, chestPulse: 0.3 },
  charging: { expression: "sleepy", glow: 0.8, color: COLOR.accentWarm, speed: 0.5, chestPulse: 1.0 },
  lowBattery: { expression: "sad", glow: 0.5, color: COLOR.accentRed, speed: 0.5, chestPulse: 0.4 },
  updating: { expression: "loading", glow: 1.0, color: COLOR.accent, speed: 0.9, chestPulse: 1.2 },
  disconnected: { expression: "confused" as Expression, glow: 0.3, color: COLOR.accentRed, speed: 0.3, chestPulse: 0.2 },
};

const RobotCtx = createContext<RobotContextValue | null>(null);
const useRobot = () => {
  const ctx = useContext(RobotCtx);
  if (!ctx) throw new Error("useRobot must be used inside RobotProvider");
  return ctx;
};

/* ============================================================
   MATERIALS
============================================================ */

function useRobotMaterials() {
  return useMemo(() => {
    const shellWhite = new THREE.MeshPhysicalMaterial({
      color: COLOR.shellLight,
      roughness: 0.45,
      metalness: 0.1,
      clearcoat: 0.1,
      clearcoatRoughness: 0.3,
      envMapIntensity: 0.6,
    });

    const shellDark = new THREE.MeshPhysicalMaterial({
      color: COLOR.shellDark,
      roughness: 0.35,
      metalness: 0.4,
      clearcoat: 0.6,
      clearcoatRoughness: 0.25,
    });

    const carbon = new THREE.MeshPhysicalMaterial({
      color: COLOR.carbon,
      roughness: 0.55,
      metalness: 0.2,
      clearcoat: 0.3,
    });

    const rubber = new THREE.MeshPhysicalMaterial({
      color: COLOR.rubber,
      roughness: 0.95,
      metalness: 0,
    });

    const glass = new THREE.MeshPhysicalMaterial({
      color: COLOR.visorGlass,
      roughness: 0.05,
      metalness: 0,
      transmission: 0.9,
      thickness: 0.4,
      ior: 1.4,
      clearcoat: 1,
    });

    const chrome = new THREE.MeshPhysicalMaterial({
      color: "#c9ced3",
      roughness: 0.12,
      metalness: 1,
      clearcoat: 1,
    });

    const led = (color: string, intensity: number) =>
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: intensity,
        toneMapped: false,
      });

    return { shellWhite, shellDark, carbon, rubber, glass, chrome, led };
  }, []);
}

/* ============================================================
   HELPERS
============================================================ */

/** Small hex/phillips-style screw head used to scatter engineering detail. */
const Screw: React.FC<{ position: [number, number, number]; scale?: number; mat: THREE.Material }> = ({
  position,
  scale = 1,
  mat,
}) => (
  <mesh position={position} scale={scale} castShadow>
    <cylinderGeometry args={[0.018, 0.018, 0.01, 8]} />
    <primitive object={mat} attach="material" />
  </mesh>
);

/** Thin seam line to fake a panel gap. */
const PanelSeam: React.FC<{
  position: [number, number, number];
  rotation?: [number, number, number];
  length?: number;
  mat: THREE.Material;
}> = ({ position, rotation = [0, 0, 0], length = 0.3, mat }) => (
  <mesh position={position} rotation={rotation}>
    <boxGeometry args={[length, 0.004, 0.004]} />
    <primitive object={mat} attach="material" />
  </mesh>
);

/** A row of vent slats. */
const VentGrill: React.FC<{
  position: [number, number, number];
  rotation?: [number, number, number];
  count?: number;
  mat: THREE.Material;
}> = ({ position, rotation = [0, 0, 0], count = 5, mat }) => (
  <group position={position} rotation={rotation}>
    {Array.from({ length: count }).map((_, i) => (
      <mesh key={i} position={[0, i * 0.014, 0]} castShadow>
        <boxGeometry args={[0.09, 0.006, 0.01]} />
        <primitive object={mat} attach="material" />
      </mesh>
    ))}
  </group>
);

function scatterScrews(
  positions: [number, number, number][],
  mat: THREE.Material,
  scale = 1
) {
  return positions.map((p, i) => <Screw key={i} position={p} scale={scale} mat={mat} />);
}

/** Damped spring-to-target helper (critically damped-ish). */
function springTo(
  current: THREE.Vector3 | THREE.Euler,
  target: THREE.Vector3 | THREE.Euler,
  lambda: number,
  dt: number
) {
  const t = 1 - Math.exp(-lambda * dt);
  if (current instanceof THREE.Vector3 && target instanceof THREE.Vector3) {
    current.lerp(target, t);
  } else if (current instanceof THREE.Euler && target instanceof THREE.Euler) {
    current.x += (target.x - current.x) * t;
    current.y += (target.y - current.y) * t;
    current.z += (target.z - current.z) * t;
  }
}

/* ============================================================
   CUSTOM HOOKS
============================================================ */

/** Tracks normalized pointer position across the whole window (-1..1). */
function usePointerTarget() {
  const target = useRef(new THREE.Vector2(0, 0));
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      target.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      target.current.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    const onLeave = () => {
      target.current.set(0, 0);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, []);
  return target;
}

/** Fires a callback on single/double click and on long-press, from pointer down/up. */
function useClickGestures(opts: {
  onClick: () => void;
  onDoubleClick: () => void;
  onLongPress: () => void;
  longPressMs?: number;
  doubleClickMs?: number;
}) {
  const { onClick, onDoubleClick, onLongPress, longPressMs = 550, doubleClickMs = 280 } = opts;
  const lastClick = useRef(0);
  const pressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  const onPointerDown = useCallback(() => {
    longPressFired.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      onLongPress();
    }, longPressMs);
  }, [onLongPress, longPressMs]);

  const onPointerUp = useCallback(() => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    if (longPressFired.current) return;
    const now = performance.now();
    if (now - lastClick.current < doubleClickMs) {
      onDoubleClick();
      lastClick.current = 0;
    } else {
      lastClick.current = now;
      window.setTimeout(() => {
        // if no second click arrived, treat as single click
        if (performance.now() - lastClick.current >= doubleClickMs - 10) {
          onClick();
        }
      }, doubleClickMs);
    }
  }, [onClick, onDoubleClick, doubleClickMs]);

  return { onPointerDown, onPointerUp };
}

/** Random blink timing: schedules occasional blinks with irregular gaps. */
function useBlinkTimer(enabled: boolean, onBlink: () => void) {
  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    const schedule = () => {
      const delay = 2200 + Math.random() * 3600;
      window.setTimeout(() => {
        if (!mounted) return;
        onBlink();
        schedule();
      }, delay);
    };
    schedule();
    return () => {
      mounted = false;
    };
  }, [enabled, onBlink]);
}

/** Battery Status API, feature-detected; safely no-ops where unsupported. */
function useBatteryStatus() {
  const [battery, setBattery] = useState<{ level: number; charging: boolean } | null>(null);
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<any> };
    if (!nav.getBattery) return;
    let batteryRef: any;
    nav.getBattery().then((b) => {
      batteryRef = b;
      const update = () => setBattery({ level: b.level, charging: b.charging });
      update();
      b.addEventListener("levelchange", update);
      b.addEventListener("chargingchange", update);
    });
    return () => {
      if (batteryRef) {
        batteryRef.removeEventListener?.("levelchange", () => {});
        batteryRef.removeEventListener?.("chargingchange", () => {});
      }
    };
  }, []);
  return battery;
}

/** Tracks online/offline, tab visibility, and window focus. */
function useEnvironmentSignals() {
  const [online, setOnline] = useState(true);
  const [visible, setVisible] = useState(true);
  const [focused, setFocused] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    const onVis = () => setVisible(document.visibilityState === "visible");
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);

    const motionMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const darkMq = window.matchMedia("(prefers-color-scheme: dark)");
    setReducedMotion(motionMq.matches);
    setDark(darkMq.matches);
    const onMotion = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    const onDark = (e: MediaQueryListEvent) => setDark(e.matches);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    motionMq.addEventListener("change", onMotion);
    darkMq.addEventListener("change", onDark);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      motionMq.removeEventListener("change", onMotion);
      darkMq.removeEventListener("change", onDark);
    };
  }, []);

  return { online, visible, focused, reducedMotion, dark };
}

/* ============================================================
   EYE COMPONENT
============================================================ */

const Eye: React.FC<{
  side: "left" | "right";
  expression: Expression;
  blinkAmount: number; // 0 = open, 1 = closed
  lookTarget: React.MutableRefObject<THREE.Vector2>;
  color: string;
  glow: number;
}> = ({ side, expression, blinkAmount, lookTarget, color, glow }) => {
  const group = useRef<THREE.Group>(null!);
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: glow * 1.5, toneMapped: false }),
    [color, glow]
  );

  useFrame(() => {
    if (!group.current) return;
    const targetX = lookTarget.current.x * 0.04;
    const targetY = lookTarget.current.y * 0.02;
    group.current.position.x += (targetX - group.current.position.x) * 0.15;
    group.current.position.y += (targetY - group.current.position.y) * 0.15;

    let closeFactor = blinkAmount;
    if (expression === "sleepy") closeFactor = Math.max(closeFactor, 0.75);
    if (expression === "wink" && side === "right") closeFactor = Math.max(closeFactor, 1);
    group.current.scale.y = THREE.MathUtils.lerp(1, 0.05, closeFactor);
  });

  return (
    <group position={[side === "left" ? -0.1 : 0.1, 0.04, 0.28]}>
      <group ref={group}>
        <mesh rotation={[0, 0, side === "left" ? 0.05 : -0.05]}>
          <capsuleGeometry args={[0.03, 0.05, 16, 16]} />
          <primitive object={mat} attach="material" />
        </mesh>
      </group>
    </group>
  );
};

// Visor removed as it is now integrated into the Head component

/* ============================================================
   HEAD COMPONENT
============================================================ */

const Head = React.forwardRef<
  THREE.Group,
  {
    mats: ReturnType<typeof useRobotMaterials>;
    lookTarget: React.MutableRefObject<THREE.Vector2>;
    expression: Expression;
    blinkAmount: number;
    color: string;
    glow: number;
  }
>(({ mats, lookTarget, expression, blinkAmount, color, glow }, ref) => {
  return (
    <group ref={ref} position={[0, 1.35, 0]}>
      {/* massive cute helmet (rounded box) */}
      <RoundedBox args={[0.5, 0.42, 0.45]} radius={0.16} smoothness={8} position={[0, 0, 0]} castShadow receiveShadow>
        <primitive object={mats.shellWhite} attach="material" />
      </RoundedBox>

      {/* black glass visor recessed into helmet */}
      <RoundedBox args={[0.42, 0.32, 0.1]} radius={0.12} smoothness={6} position={[0, 0.02, 0.22]} castShadow>
        <primitive object={mats.glass} attach="material" />
      </RoundedBox>

      {/* Always use cyan for the cute reference look */}
      <Eye side="left" expression={expression} blinkAmount={blinkAmount} lookTarget={lookTarget} color={"#37e6e0"} glow={glow} />
      <Eye side="right" expression={expression} blinkAmount={blinkAmount} lookTarget={lookTarget} color={"#37e6e0"} glow={glow} />

      {/* small cute side ear caps */}
      {(["left", "right"] as const).map((side) => (
        <group key={side} position={[side === "left" ? -0.26 : 0.26, 0, 0]}>
          <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.07, 0.07, 0.03, 32]} />
            <primitive object={mats.shellWhite} attach="material" />
          </mesh>
          <mesh position={[side === "left" ? -0.016 : 0.016, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.03, 0.03, 0.01, 16]} />
            <primitive object={mats.carbon} attach="material" />
          </mesh>
        </group>
      ))}
    </group>
  );
});
Head.displayName = "Head";

/* ============================================================
   ARM COMPONENT
============================================================ */

const Hand = React.forwardRef<THREE.Group, { mats: ReturnType<typeof useRobotMaterials>; fingerPhase: number }>(
  ({ mats, fingerPhase }, ref) => {
    const fingers = useRef<THREE.Group[]>([]);
    useFrame(({ clock }) => {
      fingers.current.forEach((f, i) => {
        if (!f) return;
        f.rotation.x = -0.08 + Math.sin(clock.elapsedTime * 1.4 + i + fingerPhase) * 0.05;
      });
    });
    return (
      <group ref={ref}>
        <RoundedBox args={[0.09, 0.1, 0.06]} radius={0.03} castShadow>
          <primitive object={mats.shellDark} attach="material" />
        </RoundedBox>
        {[-0.03, 0, 0.03].map((x, i) => (
          <group
            key={i}
            ref={(el) => (fingers.current[i] = el as THREE.Group)}
            position={[x, -0.07, 0.02]}
          >
            <mesh castShadow>
              <capsuleGeometry args={[0.012, 0.05, 4, 8]} />
              <primitive object={mats.rubber} attach="material" />
            </mesh>
          </group>
        ))}
        {/* thumb */}
        <group position={[-0.05, -0.02, 0.03]} rotation={[0, 0, -0.9]}>
          <mesh castShadow>
            <capsuleGeometry args={[0.013, 0.045, 4, 8]} />
            <primitive object={mats.rubber} attach="material" />
          </mesh>
        </group>
      </group>
    );
  }
);
Hand.displayName = "Hand";

const Arm = React.forwardRef<
  THREE.Group,
  { side: "left" | "right"; mats: ReturnType<typeof useRobotMaterials>; fingerPhase: number }
>(({ side, mats, fingerPhase }, ref) => {
  const sign = side === "left" ? -1 : 1;
  return (
    <group ref={ref} position={[sign * 0.24, 1.0, 0]}>
      {/* perfectly spherical shoulder */}
      <mesh castShadow>
        <sphereGeometry args={[0.09, 32, 32]} />
        <primitive object={mats.shellWhite} attach="material" />
      </mesh>

      {/* upper arm */}
      <group position={[0, -0.14, 0]}>
        <mesh castShadow>
          <capsuleGeometry args={[0.065, 0.1, 32, 32]} />
          <primitive object={mats.shellWhite} attach="material" />
        </mesh>

        {/* elbow joint */}
        <mesh position={[0, -0.11, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 0.08, 16]} />
          <primitive object={mats.carbon} attach="material" />
        </mesh>

        {/* forearm */}
        <group position={[0, -0.22, 0]}>
          <mesh castShadow>
            <capsuleGeometry args={[0.065, 0.12, 32, 32]} />
            <primitive object={mats.shellWhite} attach="material" />
          </mesh>
          <group position={[0, -0.12, 0]}>
            <Hand mats={mats} fingerPhase={fingerPhase} />
          </group>
        </group>
      </group>
    </group>
  );
});
Arm.displayName = "Arm";

/* ============================================================
   LEG COMPONENT
============================================================ */

const Foot: React.FC<{ mats: ReturnType<typeof useRobotMaterials> }> = ({ mats }) => (
  <group>
    {/* white upper shoe */}
    <RoundedBox args={[0.18, 0.1, 0.22]} radius={0.05} position={[0, 0, 0.04]} castShadow>
      <primitive object={mats.shellWhite} attach="material" />
    </RoundedBox>
    {/* black sole */}
    <RoundedBox args={[0.19, 0.05, 0.23]} radius={0.02} position={[0, -0.06, 0.04]} castShadow>
      <primitive object={mats.shellDark} attach="material" />
    </RoundedBox>
  </group>
);

const Leg = React.forwardRef<
  THREE.Group,
  { side: "left" | "right"; mats: ReturnType<typeof useRobotMaterials> }
>(({ side, mats }, ref) => {
  const sign = side === "left" ? -1 : 1;
  return (
    <group ref={ref} position={[sign * 0.1, 0.65, 0]}>
      {/* hip joint */}
      <mesh castShadow>
        <sphereGeometry args={[0.06, 32, 32]} />
        <primitive object={mats.carbon} attach="material" />
      </mesh>

      <group position={[0, -0.1, 0]}>
        {/* thick white thigh */}
        <mesh castShadow>
          <capsuleGeometry args={[0.07, 0.12, 32, 32]} />
          <primitive object={mats.shellWhite} attach="material" />
        </mesh>

        <group position={[0, -0.16, 0]}>
          {/* dark shin */}
          <mesh castShadow>
            <capsuleGeometry args={[0.065, 0.1, 16, 16]} />
            <primitive object={mats.shellDark} attach="material" />
          </mesh>
          
          <group position={[0, -0.14, 0]}>
            <Foot mats={mats} />
          </group>
        </group>
      </group>
    </group>
  );
});
Leg.displayName = "Leg";

/* ============================================================
   ROBOT BODY (torso + chest)
============================================================ */

const Torso = React.forwardRef<
  THREE.Group,
  { mats: ReturnType<typeof useRobotMaterials>; color: string; glow: number; chestPulse: number }
>(({ mats, color, glow, chestPulse }, ref) => {
  const ledMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#37e6e0", emissive: "#37e6e0", emissiveIntensity: glow * 1.5, toneMapped: false }),
    [glow]
  );

  return (
    <group ref={ref} position={[0, 0.9, 0]}>
      {/* dark core chassis */}
      <RoundedBox args={[0.36, 0.34, 0.26]} radius={0.1} smoothness={8} castShadow receiveShadow>
        <primitive object={mats.carbon} attach="material" />
      </RoundedBox>

      {/* white armor plates */}
      {/* upper chest plate */}
      <RoundedBox args={[0.38, 0.16, 0.28]} radius={0.06} position={[0, 0.08, 0]} castShadow>
        <primitive object={mats.shellWhite} attach="material" />
      </RoundedBox>
      {/* lower belly plate */}
      <RoundedBox args={[0.34, 0.1, 0.29]} radius={0.04} position={[0, -0.08, 0]} castShadow>
        <primitive object={mats.shellWhite} attach="material" />
      </RoundedBox>

      {/* cyan accent strips */}
      {/* chest strip */}
      <mesh position={[0, -0.01, 0.135]}>
        <boxGeometry args={[0.14, 0.012, 0.02]} />
        <primitive object={ledMat} attach="material" />
      </mesh>
      {/* belly strip */}
      <mesh position={[0, -0.14, 0.14]}>
        <boxGeometry args={[0.08, 0.01, 0.02]} />
        <primitive object={ledMat} attach="material" />
      </mesh>
    </group>
  );
});
Torso.displayName = "Torso";

/* ============================================================
   ANIMATIONS + INTERACTIONS (driving component)
============================================================ */

const RobotRig: React.FC<{ mats: ReturnType<typeof useRobotMaterials> }> = ({ mats }) => {
  const { state, config, reducedMotion } = useRobot();

  const root = useRef<THREE.Group>(null!);
  const head = useRef<THREE.Group>(null!);
  const torso = useRef<THREE.Group>(null!);
  const armL = useRef<THREE.Group>(null!);
  const armR = useRef<THREE.Group>(null!);
  const legL = useRef<THREE.Group>(null!);
  const legR = useRef<THREE.Group>(null!);

  const lookTarget = usePointerTarget();
  const eyeLook = useRef(new THREE.Vector2(0, 0));

  const [blink, setBlink] = useState(0);
  const blinkStart = useRef<number | null>(null);
  useBlinkTimer(!reducedMotion, () => {
    blinkStart.current = performance.now();
  });

  // drag / throw state
  const dragging = useRef(false);
  const dragOffset = useRef(new THREE.Vector3());
  const velocity = useRef(new THREE.Vector3());
  const basePosition = useRef(new THREE.Vector3(0, -0.6, 0));
  const targetPosition = useRef(new THREE.Vector3(0, -0.6, 0));

  // gesture / bounce impulses
  const bounce = useRef(0);
  const wave = useRef(0);
  const celebrate = useRef(0);
  const scrollLean = useRef(0);
  const rotationOffset = useRef(0);

  const { onPointerDown, onPointerUp } = useClickGestures({
    onClick: () => (bounce.current = 1),
    onDoubleClick: () => (wave.current = 1),
    onLongPress: () => (celebrate.current = 1),
  });

  // scroll reactions
  useEffect(() => {
    let lastY = window.scrollY;
    let inertia = 0;
    const onScroll = () => {
      const dy = window.scrollY - lastY;
      lastY = window.scrollY;
      scrollLean.current = THREE.MathUtils.clamp(scrollLean.current + dy * 0.002, -0.4, 0.4);
      inertia = dy * 0.01;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Enter":
          bounce.current = 1;
          break;
        case "Escape":
          targetPosition.current.copy(basePosition.current);
          break;
        case " ":
          wave.current = 1;
          e.preventDefault();
          break;
        case "ArrowLeft":
          rotationOffset.current -= 0.3;
          break;
        case "ArrowRight":
          rotationOffset.current += 0.3;
          break;
        case "r":
        case "R":
          rotationOffset.current = 0;
          targetPosition.current.copy(basePosition.current);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // pointer drag on the root group (registered via R3F events on a big invisible hit box)
  const onPointerDownDrag = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      dragging.current = true;
      (e.target as any)?.setPointerCapture?.(e.pointerId);
      dragOffset.current.set(e.point.x - root.current.position.x, 0, 0);
      onPointerDown();
    },
    [onPointerDown]
  );

  const onPointerUpDrag = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      dragging.current = false;
      velocity.current.x = THREE.MathUtils.clamp(velocity.current.x, -2, 2);
      onPointerUp();
    },
    [onPointerUp]
  );

  const onPointerMoveDrag = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return;
    const nx = e.point.x - dragOffset.current.x;
    velocity.current.x = nx - targetPosition.current.x;
    targetPosition.current.x = THREE.MathUtils.clamp(nx, -1.6, 1.6);
  }, []);

  useFrame(({ clock, viewport }, dt) => {
    const t = clock.elapsedTime;
    const speed = config.speed * (reducedMotion ? 0.35 : 1);

    // --- physics: throw / spring back / edge collision / corner snap ---
    if (!dragging.current) {
      targetPosition.current.x += velocity.current.x * dt * 6;
      velocity.current.x *= 0.9;
      const edge = viewport.width / 2 - 0.4;
      if (Math.abs(targetPosition.current.x) > edge) {
        targetPosition.current.x = THREE.MathUtils.clamp(targetPosition.current.x, -edge, edge);
        velocity.current.x *= -0.3;
      }
      if (Math.abs(velocity.current.x) < 0.02 && Math.abs(targetPosition.current.x) > edge * 0.6) {
        // snap toward nearest corner when it settles near an edge
        targetPosition.current.x += (Math.sign(targetPosition.current.x) * edge - targetPosition.current.x) * 0.02;
      }
    }
    springTo(root.current.position, targetPosition.current, 6, dt);

    // idle floating + breathing
    const floatY = reducedMotion ? 0 : Math.sin(t * 1.2 * speed) * 0.02;
    const breathe = reducedMotion ? 1 : 1 + Math.sin(t * 1.6 * speed) * 0.012;
    root.current.position.y = basePosition.current.y + floatY;
    torso.current.scale.setScalar(breathe);

    // click bounce decay
    if (bounce.current > 0.001) {
      root.current.position.y += Math.sin(bounce.current * Math.PI) * 0.06;
      bounce.current *= 0.9;
    }
    if (celebrate.current > 0.001) {
      root.current.position.y += Math.abs(Math.sin(t * 10)) * 0.05 * celebrate.current;
      root.current.rotation.z = Math.sin(t * 8) * 0.08 * celebrate.current;
      celebrate.current *= 0.965;
    } else {
      root.current.rotation.z += (0 - root.current.rotation.z) * 0.1;
    }

    root.current.rotation.y += (rotationOffset.current + scrollLean.current * 0.5 - root.current.rotation.y) * 0.08;

    // head + eye tracking
    eyeLook.current.lerp(lookTarget.current, 0.08);
    const headTargetY = lookTarget.current.x * 0.35 + rotationOffset.current * 0.2;
    const headTargetX = lookTarget.current.y * 0.15;
    const tilt = reducedMotion ? 0 : Math.sin(t * 0.35) * 0.04;
    head.current.rotation.y += (headTargetY - head.current.rotation.y) * 0.08;
    head.current.rotation.x += (headTargetX - head.current.rotation.x) * 0.08;
    head.current.rotation.z += (tilt - head.current.rotation.z) * 0.05;

    // torso follow (lags behind head) + shoulder compensation
    torso.current.rotation.y += (headTargetY * 0.3 - torso.current.rotation.y) * 0.04;
    const shoulderComp = -torso.current.rotation.y * 0.6;
    armL.current.rotation.z = 0.45 + shoulderComp;
    armR.current.rotation.z = -0.45 - shoulderComp;

    // wave gesture (right arm)
    if (wave.current > 0.001) {
      armR.current.rotation.z = -1.6 + Math.sin(t * 14) * 0.35;
      wave.current *= 0.985;
      if (wave.current < 0.02) wave.current = 0;
    }

    // idle arm sway
    armL.current.rotation.x = Math.sin(t * 1.1 * speed) * 0.05;
    armR.current.rotation.x = Math.sin(t * 1.1 * speed + 1) * 0.05;

    // leg idle micro-shift
    legL.current.rotation.x = Math.sin(t * 0.8) * 0.015;
    legR.current.rotation.x = Math.sin(t * 0.8 + Math.PI) * 0.015;

    // blink easing
    if (blinkStart.current !== null) {
      const elapsed = performance.now() - blinkStart.current;
      const dur = 220;
      const p = Math.min(elapsed / dur, 1);
      const val = p < 0.5 ? p * 2 : 1 - (p - 0.5) * 2;
      setBlink(val);
      if (p >= 1) blinkStart.current = null;
    }
  });

  const expression = config.expression;

  return (
    <group>
      {/* invisible drag hitbox covering the whole robot */}
      <mesh
        visible={false}
        position={[0, 1.1, 0]}
        onPointerDown={onPointerDownDrag}
        onPointerUp={onPointerUpDrag}
        onPointerMove={onPointerMoveDrag}
      >
        <boxGeometry args={[0.6, 1.7, 0.4]} />
      </mesh>

      <group ref={root} scale={1.0} position={[0, -0.6, 0]}>
        <Torso ref={torso} mats={mats} color={config.color} glow={config.glow} chestPulse={config.chestPulse} />
        <Head
          ref={head}
          mats={mats}
          lookTarget={eyeLook}
          expression={expression}
          blinkAmount={expression === "blink" || expression === "wink" ? 1 : blink}
          color={config.color}
          glow={config.glow}
        />
        <Arm ref={armL} side="left" mats={mats} fingerPhase={0} />
        <Arm ref={armR} side="right" mats={mats} fingerPhase={1.3} />
        <Leg ref={legL} side="left" mats={mats} />
        <Leg ref={legR} side="right" mats={mats} />
      </group>
    </group>
  );
};

/* ============================================================
   MAIN CANVAS
============================================================ */

const StatusOverlay: React.FC = () => {
  const { state } = useRobot();
  return (
    <Html position={[0, 1.95, 0]} center distanceFactor={6} style={{ pointerEvents: "none" }}>
      <AnimatePresence mode="wait">
        <motion.div
          key={state}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.25 }}
          style={{
            background: "rgba(10,14,16,0.7)",
            color: "#9ffcf7",
            fontFamily: "monospace",
            fontSize: 11,
            padding: "3px 10px",
            borderRadius: 999,
            border: "1px solid rgba(159,252,247,0.35)",
            whiteSpace: "nowrap",
            letterSpacing: 0.5,
          }}
        >
          {state.toUpperCase()}
        </motion.div>
      </AnimatePresence>
    </Html>
  );
};

const SceneLighting: React.FC = () => (
  <>
    <ambientLight intensity={0.35} />
    <directionalLight position={[2, 3, 2]} intensity={1.4} castShadow shadow-mapSize={[1024, 1024]} />
    <directionalLight position={[-2, 1.5, -1]} intensity={0.4} color="#88c9ff" />
    <directionalLight position={[0, 0.5, -2]} intensity={0.6} color="#ffffff" />
    <pointLight position={[0, 1.5, 1]} intensity={0.3} color="#37e6e0" />
  </>
);

interface RobotAssistantProps {
  initialState?: RobotState;
  onOpenChat?: () => void;
  onCloseChat?: () => void;
}

const RobotProvider: React.FC<{ initial: RobotState; children: React.ReactNode }> = ({ initial, children }) => {
  const [state, setState] = useState<RobotState>(initial);
  const env = useEnvironmentSignals();
  const battery = useBatteryStatus();

  // environment-driven automatic state transitions
  useEffect(() => {
    if (!env.online) return setState("disconnected");
    if (!env.visible) return setState("sleeping");
    if (battery && battery.charging) return setState("charging");
    if (battery && battery.level < 0.15 && !battery.charging) return setState("lowBattery");
  }, [env.online, env.visible, battery]);

  const config = STATE_CONFIG[state];
  const value: RobotContextValue = { state, setState, config, reducedMotion: env.reducedMotion };
  return <RobotCtx.Provider value={value}>{children}</RobotCtx.Provider>;
};

const InnerScene: React.FC<{ onOpenChat?: () => void; onCloseChat?: () => void }> = ({
  onOpenChat,
  onCloseChat,
}) => {
  const mats = useRobotMaterials();
  const { setState } = useRobot();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") onOpenChat?.();
      if (e.key === "Escape") onCloseChat?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenChat, onCloseChat]);

  return (
    <>
      <SceneLighting />
      <Environment preset="city" />
      <RobotRig mats={mats} />
      <StatusOverlay />
      <ContactShadows position={[0, -0.02, 0]} opacity={0.45} scale={2.2} blur={2.2} far={1.2} />
    </>
  );
};

/**
 * RobotAssistant — a premium, single-file R3F robot mascot with a full
 * emotional state machine, physically based materials, cinematic lighting,
 * pointer/keyboard/scroll interactions, drag-and-throw physics, and
 * best-effort reactions to browser/device signals (online state, tab
 * visibility, reduced-motion, dark mode, battery).
 */
const RobotAssistant: React.FC<RobotAssistantProps> = ({
  initialState = "idle",
  onOpenChat,
  onCloseChat,
}) => {
  return (
    <div style={{ position: "fixed", bottom: 20, right: 20, width: 340, height: 480, zIndex: 100, pointerEvents: "none" }}>
      <div style={{ width: "100%", height: "100%", pointerEvents: "auto" }}>
        {/* Set alpha: true so the background is transparent! */}
        <Canvas shadows camera={{ position: [0, 1.3, 2.6], fov: 32 }} gl={{ antialias: true, alpha: true }}>
          {/* Removed the black attach="background" so it floats cleanly on the user's screen */}
          <RobotProvider initial={initialState}>
            <InnerScene onOpenChat={onOpenChat} onCloseChat={onCloseChat} />
          </RobotProvider>
        </Canvas>
      </div>
    </div>
  );
};

export default RobotAssistant;
