import { Vector3 } from "three";
import type { Surface, ControlChannel } from "./aircraft";

export const AIR_DENSITY = 1.225;

export interface ControlVector {
  /** −1..1, positif = roulis à droite. */
  roll: number;
  /** −1..1, positif = nez vers le haut. */
  pitch: number;
  /** −1..1, positif = nez vers la droite. */
  yaw: number;
  /** 0..1 */
  throttle: number;
}

export interface SurfaceForces {
  force: Vector3;
  moment: Vector3;
  alpha: number;
  cl: number;
  cd: number;
  deflection: number;
  stalled: number;
}

/** Efficacité théorique d'un volet de fraction de corde donnée (théorie des profils minces). */
export function flapEffectiveness(flapFraction: number): number {
  const f = Math.min(Math.max(flapFraction, 0), 1);
  const theta = Math.acos(2 * f - 1);
  return 1 - (theta - Math.sin(theta)) / Math.PI;
}

export function controlValue(controls: ControlVector, channel: ControlChannel): number {
  return channel === "roll" ? controls.roll : channel === "pitch" ? controls.pitch : controls.yaw;
}

export function surfaceDeflection(s: Surface, controls: ControlVector): number {
  if (!s.control) return 0;
  let cmd = 0;
  for (const link of s.control.links) cmd += link.sign * controlValue(controls, link.channel);
  cmd = Math.max(-1, Math.min(1, cmd));
  return cmd * s.control.maxDeflectionDeg * (Math.PI / 180);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * Coefficients d'un panneau à l'incidence alpha (radians) et avec un braquage de volet (radians).
 * Régime attaché linéaire, puis transition progressive vers une plaque plane au-delà du décrochage.
 */
export function surfaceCoefficients(s: Surface, alpha: number, deflection: number): { cl: number; cd: number; cm: number; stalled: number } {
  const af = s.airfoil;
  const ar = s.aspectRatio;
  // Pente de portance 3D (Khan & Nahon 2015).
  const a3d = af.clAlpha * (ar / (ar + (2 * (ar + 4)) / (ar + 2)));
  const alpha0 = -af.cl0 / af.clAlpha;
  const tau = s.control ? flapEffectiveness(s.control.flapFraction) : 0;
  // Efficacité réduite aux grands braquages.
  const eta = 1 - 0.5 * Math.min(Math.abs(deflection) / (40 * Math.PI / 180), 1);
  const dAlpha0 = -tau * eta * deflection;
  const alpha0Eff = alpha0 + dAlpha0;
  const stallPos = af.alphaStallPos + 0.6 * dAlpha0;
  const stallNeg = af.alphaStallNeg + 0.6 * dAlpha0;

  const attached = (a: number) => {
    const cl = a3d * (a - alpha0Eff);
    const cd = af.cd0 + (cl * cl) / (Math.PI * s.efficiency * ar);
    return { cl, cd };
  };

  // Plaque plane en régime décroché.
  const flatPlate = (a: number) => {
    const sa = Math.sin(a);
    const ca = Math.cos(a);
    const cd90 = 1.98 - 0.0426 * deflection * deflection + 0.21 * deflection;
    const cn = cd90 * sa * (1 / (0.56 + 0.44 * Math.abs(sa)) - 0.41 * (1 - Math.exp(-17 / ar)));
    const cl = cn * ca;
    const cd = Math.abs(cn * sa) + af.cd0 * Math.abs(ca);
    return { cl, cd };
  };

  const transition = 8 * (Math.PI / 180);
  let cl: number;
  let cd: number;
  let stalled: number;
  if (alpha >= stallNeg && alpha <= stallPos) {
    ({ cl, cd } = attached(alpha));
    stalled = 0;
  } else if (alpha > stallPos) {
    const t = smoothstep(stallPos, stallPos + transition, alpha);
    const atStall = attached(stallPos);
    const plate = flatPlate(alpha);
    cl = atStall.cl * (1 - t) + plate.cl * t;
    cd = atStall.cd * (1 - t) + plate.cd * t;
    stalled = t;
  } else {
    const t = smoothstep(stallNeg, stallNeg - transition, alpha);
    const atStall = attached(stallNeg);
    const plate = flatPlate(alpha);
    cl = atStall.cl * (1 - t) + plate.cl * t;
    cd = atStall.cd * (1 - t) + plate.cd * t;
    stalled = t;
  }
  // Un volet braqué ajoute un léger moment piqueur autour du foyer.
  const cm = af.cmac - 0.1 * tau * deflection;
  return { cl, cd, cm, stalled };
}

const tmpW = new Vector3();
const tmpWin = new Vector3();
const tmpLift = new Vector3();
const tmpArm = new Vector3();
const tmpF = new Vector3();
const tmpM = new Vector3();

/**
 * Force et moment (au CG) d'un panneau.
 * @param vBody vitesse du CG dans le repère avion (m/s)
 * @param omega vitesse angulaire dans le repère avion (rad/s)
 * @param washSpeed vitesse du souffle d'hélice vers l'arrière (m/s)
 * @param windBody vent dans le repère avion (m/s)
 */
export function surfaceForces(
  s: Surface,
  vBody: Vector3,
  omega: Vector3,
  controls: ControlVector,
  washSpeed: number,
  windBody: Vector3,
  out?: SurfaceForces,
): SurfaceForces {
  const result = out ?? { force: new Vector3(), moment: new Vector3(), alpha: 0, cl: 0, cd: 0, deflection: 0, stalled: 0 };
  // Vitesse du panneau = vitesse du CG + omega × r.
  tmpArm.copy(s.pos);
  tmpW.copy(omega).cross(tmpArm).add(vBody);
  // Vitesse de l'air vue par le panneau.
  tmpW.negate().add(windBody);
  // Souffle d'hélice : l'air est poussé vers l'arrière (+Z).
  tmpW.z += washSpeed * s.wash;
  // On retire la composante le long de l'envergure.
  const along = tmpW.dot(s.spanDir);
  tmpWin.copy(tmpW).addScaledVector(s.spanDir, -along);
  const speed2 = tmpWin.lengthSq();
  const deflection = surfaceDeflection(s, controls);
  result.deflection = deflection;
  if (speed2 < 1e-4) {
    result.force.set(0, 0, 0);
    result.moment.set(0, 0, 0);
    result.alpha = 0; result.cl = 0; result.cd = 0; result.stalled = 0;
    return result;
  }
  const speed = Math.sqrt(speed2);
  const alpha = Math.atan2(tmpWin.dot(s.normal), tmpWin.dot(s.chordDir));
  const { cl, cd, cm, stalled } = surfaceCoefficients(s, alpha, deflection);
  const q = 0.5 * AIR_DENSITY * speed2;
  // Direction de la portance : perpendiculaire au flux, dans le plan du panneau.
  tmpLift.copy(s.normal).addScaledVector(tmpWin, -tmpWin.dot(s.normal) / speed2).normalize();
  tmpF.copy(tmpLift).multiplyScalar(q * s.area * cl);
  tmpF.addScaledVector(tmpWin, (q * s.area * cd) / speed);
  // Moment de tangage propre autour de l'axe d'envergure.
  tmpM.copy(s.spanDir).multiplyScalar(q * s.area * s.chord * cm);
  result.force.copy(tmpF);
  result.moment.copy(tmpArm).cross(tmpF).add(tmpM);
  result.alpha = alpha; result.cl = cl; result.cd = cd; result.stalled = stalled;
  return result;
}
