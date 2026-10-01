import type { ControlVector } from "../core/aero";

export interface AxisCalibration {
  axis: number;
  min: number;
  max: number;
  center: number;
  invert: boolean;
}

export interface ButtonBinding {
  kind: "button" | "axis";
  index: number;
  /** Pour un axe : valeur au repos. */
  rest: number;
  /** Pour un axe : valeur quand l'interrupteur est activé (si connue). */
  on?: number;
}

export interface RadioCalibration {
  version: 1;
  gamepadId: string;
  throttle: AxisCalibration;
  pitch: AxisCalibration;
  roll: AxisCalibration;
  yaw: AxisCalibration;
  reset?: ButtonBinding;
  smoke?: ButtonBinding;
  deadband: number;
}

export type StickChannel = "throttle" | "pitch" | "roll" | "yaw";
export const STICK_CHANNELS: StickChannel[] = ["throttle", "pitch", "roll", "yaw"];

const STORAGE_KEY = "rcsim.calibration.v1";

export interface RawGamepad {
  id: string;
  axes: number[];
  buttons: number[];
}

export function listGamepads(): Gamepad[] {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return [];
  try {
    return Array.from(navigator.getGamepads()).filter((g): g is Gamepad => !!g && g.connected);
  } catch {
    return [];
  }
}

export function readRaw(g: Gamepad): RawGamepad {
  return { id: g.id, axes: Array.from(g.axes), buttons: g.buttons.map((b) => (typeof b === "number" ? b : b.value)) };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function normalizeCentered(c: AxisCalibration, raw: number, deadband: number): number {
  const up = Math.max(1e-3, c.max - c.center);
  const down = Math.max(1e-3, c.center - c.min);
  let v = raw >= c.center ? (raw - c.center) / up : (raw - c.center) / down;
  v = clamp(v, -1, 1);
  if (c.invert) v = -v;
  if (Math.abs(v) < deadband) return 0;
  return clamp((v - Math.sign(v) * deadband) / (1 - deadband), -1, 1);
}

export function normalizeThrottle(c: AxisCalibration, raw: number): number {
  let v = (raw - c.min) / Math.max(1e-3, c.max - c.min);
  v = clamp(v, 0, 1);
  if (c.invert) v = 1 - v;
  // Petite zone morte en bas pour que « gaz coupés » soit vraiment zéro.
  return v < 0.03 ? 0 : v;
}

export function loadCalibrations(): RadioCalibration[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RadioCalibration[]) : [];
  } catch {
    return [];
  }
}

export function saveCalibration(cal: RadioCalibration): void {
  try {
    const all = loadCalibrations().filter((c) => c.gamepadId !== cal.gamepadId);
    all.push(cal);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* stockage indisponible : on garde la calibration en mémoire seulement */
  }
}

export function findCalibration(gamepadId: string): RadioCalibration | undefined {
  return loadCalibrations().find((c) => c.gamepadId === gamepadId);
}

/** Lit la radio et remplit un vecteur de commandes. Renvoie false si aucune radio calibrée n'est branchée. */
export class GamepadReader {
  calibration: RadioCalibration | null = null;
  private resetWasActive = false;
  private resetEdge = false;
  /** Interrupteur de fumée, niveau courant. */
  smokeActive = false;

  /** La première manette branchée, ou celle qui correspond à la calibration. */
  current(): Gamepad | null {
    const pads = listGamepads();
    if (pads.length === 0) return null;
    if (this.calibration) {
      const match = pads.find((p) => p.id === this.calibration!.gamepadId);
      if (match) return match;
    }
    return pads[0];
  }

  /** Charge la calibration enregistrée pour la manette branchée, si elle existe. */
  refreshCalibration(): void {
    const pad = this.current();
    if (!pad) return;
    if (this.calibration && this.calibration.gamepadId === pad.id) return;
    this.calibration = findCalibration(pad.id) ?? null;
  }

  read(out: ControlVector): boolean {
    const pad = this.current();
    const cal = this.calibration;
    if (!pad || !cal || cal.gamepadId !== pad.id) return false;
    const axes = pad.axes;
    const axis = (c: AxisCalibration) => (c.axis < axes.length ? axes[c.axis] : 0);
    out.throttle = normalizeThrottle(cal.throttle, axis(cal.throttle));
    out.pitch = normalizeCentered(cal.pitch, axis(cal.pitch), cal.deadband);
    out.roll = normalizeCentered(cal.roll, axis(cal.roll), cal.deadband);
    out.yaw = normalizeCentered(cal.yaw, axis(cal.yaw), cal.deadband);

    const bindingActive = (b?: ButtonBinding): boolean => {
      if (!b) return false;
      if (b.kind === "button") {
        const btn = pad.buttons[b.index];
        return !!btn && (typeof btn === "number" ? btn > 0.5 : btn.pressed || btn.value > 0.5);
      }
      const v = b.index < axes.length ? axes[b.index] : b.rest;
      if (b.on !== undefined) return Math.abs(v - b.on) < Math.abs(v - b.rest);
      return Math.abs(v - b.rest) > 0.5;
    };
    const resetActive = bindingActive(cal.reset);
    this.smokeActive = bindingActive(cal.smoke);
    this.resetEdge = resetActive && !this.resetWasActive;
    this.resetWasActive = resetActive;
    return true;
  }

  /** Vrai une seule fois quand la commande « recommencer » vient d'être activée. */
  consumeReset(): boolean {
    const e = this.resetEdge;
    this.resetEdge = false;
    return e;
  }
}
