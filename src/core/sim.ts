import { Vector3, Quaternion, Euler } from "three";
import type { Aircraft, ContactPoint } from "./aircraft";
import { AIR_DENSITY, surfaceDeflection, surfaceForces, type AirEnvironment, type ControlVector, type SurfaceForces } from "./aero";

export const GRAVITY = 9.81;
export const FIXED_DT = 1 / 240;

export interface SimState {
  position: Vector3;
  velocity: Vector3;
  orientation: Quaternion;
  /** Vitesse angulaire dans le repère avion. */
  omega: Vector3;
  /** Commande de gaz demandée, 0..1. */
  throttle: number;
  /** Régime réel du moteur, 0..1 (suit la commande avec retard). */
  engine: number;
  onGround: boolean;
  crashed: boolean;
  crashReason: string;
  airspeed: number;
  time: number;
}

export interface Attitude {
  /** Roulis, positif aile droite basse (rad). */
  roll: number;
  /** Assiette, positif nez haut (rad). */
  pitch: number;
  /** Cap (rad). */
  heading: number;
  /** Vitesse de roulis positive vers la droite (rad/s). */
  rollRate: number;
  /** Vitesse de tangage positive à cabrer (rad/s). */
  pitchRate: number;
  /** Vitesse de lacet positive vers la droite (rad/s). */
  yawRate: number;
}

export interface ContactState {
  touching: boolean;
  worldPos: Vector3;
}

export interface Telemetry {
  surfaces: SurfaceForces[];
  thrust: number;
  wash: number;
  downwash: number;
  groundEffect: number;
  contacts: ContactState[];
  alphaWing: number;
  /** Braquage réel de chaque panneau (rad), même ordre que les panneaux. */
  deflections: number[];
}

const FORWARD = new Vector3(0, 0, -1);

/** Vent moyen plus rafales lisses, un peu plus faible près du sol. */
export class WindModel {
  /** Vitesse moyenne à 10 m, m/s. */
  speed = 0;
  /** Amplitude des rafales, m/s. */
  gust = 0;
  /** Direction vers laquelle le vent souffle (unitaire). Par défaut : vent de face au décollage. */
  readonly direction = new Vector3(0, 0, 1);
  private t = 0;

  set(speed: number, gust: number): void {
    this.speed = speed;
    this.gust = gust;
  }

  sample(height: number, dt: number, out: Vector3): Vector3 {
    this.t += dt;
    const t = this.t;
    const h = Math.max(height, 0.5);
    const profile = Math.min(1.3, Math.max(0.55, Math.pow(h / 10, 0.16)));
    const g = this.gust;
    const gx = g * (Math.sin(0.61 * t) + 0.5 * Math.sin(1.73 * t + 1.1) + 0.3 * Math.sin(4.1 * t + 2.3)) / 1.8;
    const gy = g * 0.4 * (Math.sin(0.83 * t + 0.7) + 0.5 * Math.sin(2.31 * t + 2.0)) / 1.5;
    const gz = g * (Math.sin(0.47 * t + 2.5) + 0.5 * Math.sin(1.51 * t + 0.4) + 0.3 * Math.sin(3.7 * t + 1.9)) / 1.8;
    out.copy(this.direction).multiplyScalar(this.speed * profile);
    out.x += gx * profile;
    out.y += gy * Math.min(1, h / 15);
    out.z += gz * profile;
    return out;
  }
}

export function createState(): SimState {
  return {
    position: new Vector3(0, 0.15, 0),
    velocity: new Vector3(),
    orientation: new Quaternion(),
    omega: new Vector3(),
    throttle: 0,
    engine: 0,
    onGround: true,
    crashed: false,
    crashReason: "",
    airspeed: 0,
    time: 0,
  };
}

export function placeOnGround(state: SimState, aircraft: Aircraft, position: Vector3, headingRad: number): void {
  state.position.copy(position);
  state.velocity.set(0, 0, 0);
  state.orientation.setFromAxisAngle(new Vector3(0, 1, 0), headingRad);
  state.omega.set(0, 0, 0);
  state.throttle = 0;
  state.engine = 0;
  state.crashed = false;
  state.crashReason = "";
  state.onGround = true;
  state.airspeed = 0;
  // Pose les roues sur le sol.
  const lowest = Math.min(...aircraft.spec.contacts.filter((c) => c.kind === "wheel").map((c) => c.pos[1]));
  state.position.y = position.y - lowest + 0.005;
}

export function placeInAir(state: SimState, position: Vector3, headingRad: number, speed: number, throttle = 0.55): void {
  state.position.copy(position);
  state.orientation.setFromAxisAngle(new Vector3(0, 1, 0), headingRad);
  state.velocity.copy(FORWARD).applyQuaternion(state.orientation).multiplyScalar(speed);
  state.omega.set(0, 0, 0);
  state.throttle = throttle;
  state.engine = throttle;
  state.crashed = false;
  state.crashReason = "";
  state.onGround = false;
  state.airspeed = speed;
}

const tmpEuler = new Euler();
export function attitude(state: SimState, out?: Attitude): Attitude {
  tmpEuler.setFromQuaternion(state.orientation, "YXZ");
  const a = out ?? { roll: 0, pitch: 0, heading: 0, rollRate: 0, pitchRate: 0, yawRate: 0 };
  a.heading = tmpEuler.y;
  a.pitch = tmpEuler.x;
  a.roll = -tmpEuler.z;
  a.pitchRate = state.omega.x;
  a.yawRate = -state.omega.y;
  a.rollRate = -state.omega.z;
  return a;
}

export class Simulation {
  readonly aircraft: Aircraft;
  readonly state: SimState;
  readonly telemetry: Telemetry;
  readonly wind = new WindModel();
  /** Niveau de sol (m). */
  groundY = 0;

  private readonly windNow = new Vector3();
  private readonly invQ = new Quaternion();
  private readonly vBody = new Vector3();
  private readonly windBody = new Vector3();
  private readonly forceBody = new Vector3();
  private readonly momentBody = new Vector3();
  private readonly forceWorld = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly tmp3 = new Vector3();
  private readonly dq = new Quaternion();
  private readonly inertia: Vector3;
  private readonly invInertia: Vector3;
  private readonly env: AirEnvironment;
  private readonly wingSpan: number;
  private readonly wingAR: number;
  private lastControls: ControlVector = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };

  constructor(aircraft: Aircraft) {
    this.aircraft = aircraft;
    this.state = createState();
    this.inertia = new Vector3(...aircraft.spec.inertia);
    this.invInertia = new Vector3(1 / this.inertia.x, 1 / this.inertia.y, 1 / this.inertia.z);
    this.env = { washSpeed: 0, windBody: this.windBody, downwashSpeed: 0, groundEffect: 0 };
    const wings = aircraft.surfaces.filter((s) => s.groundEffect);
    this.wingSpan = wings.reduce((acc, s) => acc + s.span, 0) || 1;
    this.wingAR = wings.length ? wings[0].aspectRatio : 6;
    this.telemetry = {
      surfaces: aircraft.surfaces.map(() => ({ force: new Vector3(), moment: new Vector3(), alpha: 0, cl: 0, cd: 0, deflection: 0, stalled: 0 })),
      thrust: 0,
      wash: 0,
      downwash: 0,
      groundEffect: 0,
      contacts: aircraft.spec.contacts.map(() => ({ touching: false, worldPos: new Vector3() })),
      alphaWing: 0,
      deflections: aircraft.surfaces.map(() => 0),
    };
  }

  /** Vitesse du souffle (m/s) derrière l'hélice, par la théorie de la quantité de mouvement. */
  propWash(thrust: number, axialSpeed: number): number {
    const e = this.aircraft.spec.engine;
    if (e.type !== "prop") return 0;
    const area = Math.PI * (e.diameter / 2) ** 2;
    const v = Math.max(axialSpeed, 0);
    return Math.sqrt(v * v + (2 * Math.max(thrust, 0)) / (AIR_DENSITY * area)) - v;
  }

  thrustAt(engine: number, axialSpeed: number): number {
    const e = this.aircraft.spec.engine;
    const factor = Math.max(0, 1 - Math.max(axialSpeed, 0) / e.pitchSpeed);
    // Une hélice garde un peu de poussée résiduelle en moulinet, un réacteur non.
    return engine * e.maxThrust * factor;
  }

  /** Déflexion de l'aile au niveau de l'empennage, en m/s vers le bas, d'après la portance du pas précédent. */
  private tailDownwash(airspeed: number): number {
    let clArea = 0;
    let area = 0;
    for (let i = 0; i < this.aircraft.surfaces.length; i++) {
      const s = this.aircraft.surfaces[i];
      if (!s.groundEffect) continue;
      clArea += this.telemetry.surfaces[i].cl * s.area;
      area += s.area;
    }
    if (area <= 0) return 0;
    const cl = clArea / area;
    const epsilon = (2 * cl) / (Math.PI * this.wingAR);
    return epsilon * airspeed;
  }

  /** Calcule force et moment aérodynamiques et propulsifs dans le repère avion pour l'état courant. */
  computeBodyForces(controls: ControlVector, outForce: Vector3, outMoment: Vector3, deflections?: number[]): void {
    const s = this.state;
    const spec = this.aircraft.spec;
    this.invQ.copy(s.orientation).invert();
    this.vBody.copy(s.velocity).applyQuaternion(this.invQ);
    this.windBody.copy(this.windNow).applyQuaternion(this.invQ);
    const axialSpeed = -this.vBody.z + this.windBody.z;
    s.airspeed = this.tmp.copy(this.vBody).sub(this.windBody).length();

    const thrust = this.thrustAt(s.engine, axialSpeed);
    const wash = this.propWash(thrust, axialSpeed);
    const height = s.position.y - this.groundY;
    this.env.washSpeed = wash;
    this.env.downwashSpeed = this.tailDownwash(s.airspeed);
    this.env.groundEffect = Math.exp((-4 * Math.max(height, 0)) / this.wingSpan);
    this.telemetry.thrust = thrust;
    this.telemetry.wash = wash;
    this.telemetry.downwash = this.env.downwashSpeed;
    this.telemetry.groundEffect = this.env.groundEffect;

    outForce.set(0, 0, 0);
    outMoment.set(0, 0, 0);
    let alphaSum = 0;
    let alphaCount = 0;
    for (let i = 0; i < this.aircraft.surfaces.length; i++) {
      const surf = this.aircraft.surfaces[i];
      const d = deflections ? deflections[i] : surfaceDeflection(surf, controls);
      const r = surfaceForces(surf, this.vBody, s.omega, d, this.env, this.telemetry.surfaces[i]);
      outForce.add(r.force);
      outMoment.add(r.moment);
      if (surf.groundEffect) { alphaSum += r.alpha; alphaCount++; }
    }
    this.telemetry.alphaWing = alphaCount ? alphaSum / alphaCount : 0;

    // Poussée le long de l'axe avant, appliquée au moteur.
    this.tmp.set(0, 0, -thrust);
    outForce.add(this.tmp);
    this.tmp2.set(...spec.engine.pos);
    outMoment.add(this.tmp3.copy(this.tmp2).cross(this.tmp));
    if (spec.engine.type === "prop") {
      // Couple de réaction : l'hélice tourne à droite vue de l'arrière, l'avion roule à gauche.
      outMoment.z += spec.engine.torqueCoeff * thrust * spec.engine.diameter;
      // Souffle hélicoïdal sur la dérive : le nez part à gauche à forte puissance et basse vitesse.
      outMoment.y += 0.35 * spec.engine.torqueCoeff * thrust * spec.engine.diameter;
    }

    // Traînée du fuselage, au CG.
    this.tmp.copy(this.windBody).sub(this.vBody);
    const vrel = this.tmp.length();
    if (vrel > 1e-3) {
      outForce.addScaledVector(this.tmp, 0.5 * AIR_DENSITY * vrel * spec.bodyDragArea);
    }
    // Amortissement angulaire résiduel (friction de l'air sur le fuselage).
    outMoment.addScaledVector(s.omega, -0.004 * (1 + s.airspeed));
  }

  private groundContacts(outForceWorld: Vector3, outMomentBody: Vector3): void {
    const s = this.state;
    const spec = this.aircraft.spec;
    const m = spec.mass;
    const k = m * GRAVITY / 0.012;
    const c = 2 * Math.sqrt(k * m) * 0.8;
    let touching = false;
    const up = this.tmp3.set(0, 1, 0).applyQuaternion(s.orientation);
    const upright = up.y;
    const forwardWorld = this.tmp2.copy(FORWARD).applyQuaternion(s.orientation);
    const omegaWorld = new Vector3().copy(s.omega).applyQuaternion(s.orientation);
    const steer = -this.lastControls.yaw * spec.noseWheelSteerDeg * (Math.PI / 180);

    for (let i = 0; i < spec.contacts.length; i++) {
      const cp: ContactPoint = spec.contacts[i];
      const cs = this.telemetry.contacts[i];
      const rWorld = this.tmp.set(cp.pos[0], cp.pos[1], cp.pos[2]).applyQuaternion(s.orientation);
      cs.worldPos.copy(s.position).add(rWorld);
      const pen = this.groundY - cs.worldPos.y;
      cs.touching = pen > 0;
      if (pen <= 0) continue;
      touching = true;
      // Vitesse du point.
      const vPoint = new Vector3().copy(omegaWorld).cross(rWorld).add(s.velocity);
      const impactSpeed = -vPoint.y;
      if (cp.kind === "body" || (cp.kind === "wingtip" && impactSpeed > 2.5) || (cp.kind === "wheel" && impactSpeed > 6) || (cp.kind === "skid" && impactSpeed > 6) || upright < 0.2) {
        if (!s.crashed) {
          s.crashed = true;
          s.crashReason = cp.kind === "body" ? "Le fuselage a touché le sol" : cp.kind === "wingtip" ? "Une aile a touché le sol" : "Atterrissage trop dur";
        }
      }
      const normalForce = Math.max(0, k * pen - c * vPoint.y);
      const f = new Vector3(0, normalForce, 0);
      // Frottement.
      const vT = new Vector3(vPoint.x, 0, vPoint.z);
      const vTLen = vT.length();
      if (vTLen > 1e-3) {
        if (cp.kind === "wheel") {
          const fwd = new Vector3(forwardWorld.x, 0, forwardWorld.z).normalize();
          // La roue avant est directrice.
          if (cp.pos[2] < 0 && Math.abs(cp.pos[0]) < 0.02 && steer !== 0) fwd.applyAxisAngle(new Vector3(0, 1, 0), steer);
          const vLong = vT.dot(fwd);
          const vLat = new Vector3().copy(vT).addScaledVector(fwd, -vLong);
          const muLong = 0.04 + (s.throttle < 0.05 && vLong < 1 ? 0.12 : 0);
          const fLong = Math.min(muLong * normalForce, Math.abs(vLong) * 20 * m) * -Math.sign(vLong);
          f.addScaledVector(fwd, fLong);
          const vLatLen = vLat.length();
          if (vLatLen > 1e-3) {
            const fLat = Math.min(0.9 * normalForce, vLatLen * 40 * m);
            f.addScaledVector(vLat, -fLat / vLatLen);
          }
        } else {
          const fFric = Math.min(0.6 * normalForce, vTLen * 30 * m);
          f.addScaledVector(vT, -fFric / vTLen);
        }
      }
      outForceWorld.add(f);
      const mWorld = new Vector3().copy(rWorld).cross(f);
      outMomentBody.add(mWorld.applyQuaternion(this.invQ));
    }
    s.onGround = touching;
  }

  private updateActuators(controls: ControlVector, dt: number): void {
    const s = this.state;
    const spec = this.aircraft.spec;
    s.throttle = controls.throttle;
    // Montée en régime du moteur.
    const tau = Math.max(0.02, spec.engine.spoolTime);
    s.engine += (controls.throttle - s.engine) * (1 - Math.exp(-dt / tau));
    // Servos : vitesse de braquage limitée.
    const rate = spec.servoRateDegPerSec * (Math.PI / 180) * dt;
    const d = this.telemetry.deflections;
    for (let i = 0; i < this.aircraft.surfaces.length; i++) {
      const target = surfaceDeflection(this.aircraft.surfaces[i], controls);
      const delta = target - d[i];
      d[i] += Math.max(-rate, Math.min(rate, delta));
    }
  }

  step(controls: ControlVector, dt: number = FIXED_DT): void {
    const s = this.state;
    const spec = this.aircraft.spec;
    this.lastControls = controls;
    this.wind.sample(s.position.y - this.groundY, dt, this.windNow);
    if (s.crashed) {
      // L'avion reste au sol, on le freine.
      s.engine *= Math.max(0, 1 - 3 * dt);
      s.velocity.multiplyScalar(Math.max(0, 1 - 4 * dt));
      s.omega.multiplyScalar(Math.max(0, 1 - 4 * dt));
      this.forceWorld.set(0, -spec.mass * GRAVITY, 0);
      this.momentBody.set(0, 0, 0);
      this.invQ.copy(s.orientation).invert();
      this.groundContacts(this.forceWorld, this.momentBody);
      s.velocity.addScaledVector(this.forceWorld, dt / spec.mass);
      s.position.addScaledVector(s.velocity, dt);
      s.time += dt;
      return;
    }

    this.updateActuators(controls, dt);
    this.computeBodyForces(controls, this.forceBody, this.momentBody, this.telemetry.deflections);
    this.forceWorld.copy(this.forceBody).applyQuaternion(s.orientation);
    this.forceWorld.y -= spec.mass * GRAVITY;
    this.groundContacts(this.forceWorld, this.momentBody);

    // Intégration semi-implicite.
    s.velocity.addScaledVector(this.forceWorld, dt / spec.mass);
    const vmax = 90;
    if (s.velocity.lengthSq() > vmax * vmax) s.velocity.setLength(vmax);
    s.position.addScaledVector(s.velocity, dt);

    // Équation d'Euler : I·dω = M − ω × (I·ω).
    const Iw = this.tmp.set(this.inertia.x * s.omega.x, this.inertia.y * s.omega.y, this.inertia.z * s.omega.z);
    const gyro = this.tmp2.copy(s.omega).cross(Iw);
    const dOmega = this.tmp3.copy(this.momentBody).sub(gyro);
    dOmega.set(dOmega.x * this.invInertia.x, dOmega.y * this.invInertia.y, dOmega.z * this.invInertia.z);
    s.omega.addScaledVector(dOmega, dt);
    const wmax = 25;
    if (s.omega.lengthSq() > wmax * wmax) s.omega.setLength(wmax);

    // Orientation : q += 0.5 · q ⊗ (0, ω) · dt.
    this.dq.set(s.omega.x * dt * 0.5, s.omega.y * dt * 0.5, s.omega.z * dt * 0.5, 1).normalize();
    s.orientation.multiply(this.dq).normalize();
    s.time += dt;

    if (!Number.isFinite(s.position.x) || !Number.isFinite(s.velocity.x) || !Number.isFinite(s.orientation.x)) {
      s.crashed = true;
      s.crashReason = "Erreur de simulation";
      s.velocity.set(0, 0, 0);
      s.omega.set(0, 0, 0);
      s.orientation.identity();
      s.position.set(0, 1, 0);
    }
  }
}
