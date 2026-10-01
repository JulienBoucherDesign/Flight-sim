import type { ControlVector } from "./aero";
import type { AircraftSpec } from "./aircraft";
import type { Attitude } from "./sim";

export type AssistLevel = 0 | 1 | 2;

export const ASSIST_LABELS: Record<AssistLevel, string> = { 0: "Aucune", 1: "Légère", 2: "Forte" };

const DEG = Math.PI / 180;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Aide au pilotage.
 * Niveau 2 : mode « angle », le manche commande une inclinaison, l'avion revient à plat manche lâché.
 * Niveau 1 : mise à plat douce quand le manche est au centre, sinon pilotage direct.
 * Niveau 0 : aucune aide.
 */
export function applyAssist(raw: ControlVector, att: Attitude, spec: AircraftSpec, level: AssistLevel, out: ControlVector): ControlVector {
  const g = spec.assist;
  out.throttle = raw.throttle;
  out.yaw = raw.yaw;
  out.roll = raw.roll;
  out.pitch = raw.pitch;
  if (level === 0) return out;

  const trim = g.pitchTrimDeg * DEG;
  if (level === 2) {
    const maxBank = 50 * DEG;
    const maxPitch = 22 * DEG;
    const rollTarget = raw.roll * maxBank;
    const pitchTarget = trim + raw.pitch * maxPitch;
    out.roll = clamp(g.rollGain * (rollTarget - att.roll) - g.rollDamping * att.rollRate, -1, 1);
    out.pitch = clamp(g.pitchGain * (pitchTarget - att.pitch) - g.pitchDamping * att.pitchRate, -1, 1);
    // Un peu de dérive dans le sens du virage pour des virages propres.
    out.yaw = clamp(raw.yaw + 0.25 * raw.roll, -1, 1);
    return out;
  }

  // Niveau 1 : on mélange l'aide et la commande directe selon l'éloignement du manche.
  const rollHold = 1 - clamp(Math.abs(raw.roll) / 0.35, 0, 1);
  const pitchHold = 1 - clamp(Math.abs(raw.pitch) / 0.35, 0, 1);
  const rollAssist = clamp(g.rollGain * 0.6 * (0 - att.roll) - g.rollDamping * att.rollRate, -0.7, 0.7);
  const pitchAssist = clamp(g.pitchGain * 0.6 * (trim - att.pitch) - g.pitchDamping * att.pitchRate, -0.5, 0.5);
  out.roll = clamp(raw.roll + rollHold * rollAssist, -1, 1);
  out.pitch = clamp(raw.pitch + pitchHold * pitchAssist, -1, 1);
  return out;
}
