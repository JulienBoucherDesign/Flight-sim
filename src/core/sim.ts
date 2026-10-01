import { Vector3, Quaternion, Euler } from "three";
import type { Aircraft, ContactPoint } from "./aircraft";
import { AIR_DENSITY, surfaceForces, type ControlVector, type SurfaceForces } from "./aero";

export const GRAVITY = 9.81;
export const FIXED_DT = 1 / 240;

export interface SimState {
  position: Vector3;
  velocity: Vector3;
  orientation: Quaternion;
  /** Vitesse angulaire dans le repère avion. */
  omega: Vector3;
  throttle: number;
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
  contacts: ContactState[];
  alphaWing: number;
}

const FORWARD = new Vector3(0, 0, -1);

export function createState(): SimState {
  return {
    position: new Vector3(0, 0.15, 0),
    velocity: new Vector3(),
    orientation: new Quaternion(),
    omega: new Vector3(),
    throttle: 0,
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
  state.crashed = false;
  state.crashReason = "";
  state.onGround = true;
  state.airspeed = 0;
  // Pose les roues sur le sol.
  const lowest = Math.min(...aircraft.spec.contacts.filter((c) => c.kind === "wheel").map((c) => c.pos[1]));
  state.position.y = position.y - lowest + 0.005;
}

export function placeInAir(state: SimState, position: Vector3, headingRad: number, speed: number): void {
  state.position.copy(position);
  state.orientation.setFromAxisAngle(new Vector3(0, 1, 0), headingRad);
  state.velocity.copy(FORWARD).applyQuaternion(state.orientation).multiplyScalar(speed);
  state.omega.set(0, 0, 0);
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
  wind = new Vector3();
  /** Niveau de sol (m). */
  groundY = 0;

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

  constructor(aircraft: Aircraft) {
    this.aircraft = aircraft;
    this.state = createState();
    this.inertia = new Vector3(...aircraft.spec.inertia);
    this.invInertia = new Vector3(1 / this.inertia.x, 1 / this.inertia.y, 1 / this.inertia.z);
    this.telemetry = {
      surfaces: aircraft.surfaces.map(() => ({ force: new Vector3(), moment: new Vector3(), alpha: 0, cl: 0, cd: 0, deflection: 0, stalled: 0 })),
      thrust: 0,
      wash: 0,
      contacts: aircraft.spec.contacts.map(() => ({ touching: false, worldPos: new Vector3() })),
      alphaWing: 0,
    };
  }

  /** Vitesse du souffle (m/s) derrière l'hélice, par la théorie de la quantité de mouvement. */
  propWash(thrust: number, axialSpeed: number): number {
    const area = Math.PI * (this.aircraft.spec.prop.diameter / 2) ** 2;
    const v = Math.max(axialSpeed, 0);
    return Math.sqrt(v * v + (2 * Math.max(thrust, 0)) / (AIR_DENSITY * area)) - v;
  }

  thrustAt(throttle: number, axialSpeed: number): number {
    const p = this.aircraft.spec.prop;
    const factor = Math.max(0, 1 - Math.max(axialSpeed, 0) / p.pitchSpeed);
    return throttle * p.maxThrust * factor;
  }

  /** Calcule force et moment aérodynamiques et propulsifs dans le repère avion pour l'état courant. */
  computeBodyForces(controls: ControlVector, outForce: Vector3, outMoment: Vector3): void {
    const s = this.state;
    const spec = this.aircraft.spec;
    this.invQ.copy(s.orientation).invert();
    this.vBody.copy(s.velocity).applyQuaternion(this.invQ);
    this.windBody.copy(this.wind).applyQuaternion(this.invQ);
    const axialSpeed = -this.vBody.z + this.windBody.z;
    s.airspeed = this.tmp.copy(this.vBody).sub(this.windBody).length();

    const thrust = this.thrustAt(controls.throttle, axialSpeed);
    const wash = this.propWash(thrust, axialSpeed);
    this.telemetry.thrust = thrust;
    this.telemetry.wash = wash;

    outForce.set(0, 0, 0);
    outMoment.set(0, 0, 0);
    let alphaSum = 0;
    let alphaCount = 0;
    for (let i = 0; i < this.aircraft.surfaces.length; i++) {
      const surf = this.aircraft.surfaces[i];
      const r = surfaceForces(surf, this.vBody, s.omega, controls, wash, this.windBody, this.telemetry.surfaces[i]);
      outForce.add(r.force);
      outMoment.add(r.moment);
      if (surf.name.startsWith("aile")) { alphaSum += r.alpha; alphaCount++; }
    }
    this.telemetry.alphaWing = alphaCount ? alphaSum / alphaCount : 0;

    // Poussée le long de l'axe avant, appliquée à l'hélice.
    this.tmp.set(0, 0, -thrust);
    outForce.add(this.tmp);
    this.tmp2.set(...spec.prop.pos);
    outMoment.add(this.tmp3.copy(this.tmp2).cross(this.tmp));

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

  step(controls: ControlVector, dt: number = FIXED_DT): void {
    const s = this.state;
    const spec = this.aircraft.spec;
    s.throttle = controls.throttle;
    if (s.crashed) {
      // L'avion reste au sol, on le freine.
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

    this.computeBodyForces(controls, this.forceBody, this.momentBody);
    this.forceWorld.copy(this.forceBody).applyQuaternion(s.orientation);
    this.forceWorld.y -= spec.mass * GRAVITY;
    this.groundContacts(this.forceWorld, this.momentBody);

    // Intégration semi-implicite.
    s.velocity.addScaledVector(this.forceWorld, dt / spec.mass);
    const vmax = 70;
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
