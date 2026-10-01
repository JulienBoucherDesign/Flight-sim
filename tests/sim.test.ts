import { describe, expect, it } from "vitest";
import { Vector3, Quaternion } from "three";
import { buildAircraft, TRAINER_4CH, TRAINER_3CH, type AircraftSpec } from "../src/core/aircraft";
import { Simulation, FIXED_DT, GRAVITY, attitude, placeInAir, placeOnGround } from "../src/core/sim";
import { applyAssist, type AssistLevel } from "../src/core/assist";
import type { ControlVector } from "../src/core/aero";

const DEG = Math.PI / 180;

function pitchMomentAtAlpha(sim: Simulation, speed: number, alphaRad: number, pitchCmd = 0): { moment: number; lift: number } {
  const s = sim.state;
  s.orientation.identity();
  s.omega.set(0, 0, 0);
  // Vitesse inclinée sous le nez : alpha positif.
  s.velocity.set(0, -speed * Math.sin(alphaRad), -speed * Math.cos(alphaRad));
  const f = new Vector3();
  const m = new Vector3();
  sim.computeBodyForces({ roll: 0, pitch: pitchCmd, yaw: 0, throttle: 0 }, f, m);
  return { moment: m.x, lift: f.y };
}

interface FlightResult {
  crashed: boolean;
  minAlt: number;
  maxAlt: number;
  maxRoll: number;
  finalSpeed: number;
  finalAlt: number;
  reason: string;
}

function fly(spec: AircraftSpec, opts: { seconds: number; throttle: number; assist: AssistLevel; roll?: number; pitch?: number; speed?: number; alt?: number }): FlightResult {
  const sim = new Simulation(buildAircraft(spec));
  placeInAir(sim.state, new Vector3(0, opts.alt ?? 50, 0), 0, opts.speed ?? spec.cruiseSpeed);
  const raw: ControlVector = { roll: opts.roll ?? 0, pitch: opts.pitch ?? 0, yaw: 0, throttle: opts.throttle };
  const ctrl: ControlVector = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
  let minAlt = Infinity, maxAlt = -Infinity, maxRoll = 0;
  const steps = Math.round(opts.seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    const att = attitude(sim.state);
    applyAssist(raw, att, spec, opts.assist, ctrl);
    sim.step(ctrl);
    minAlt = Math.min(minAlt, sim.state.position.y);
    maxAlt = Math.max(maxAlt, sim.state.position.y);
    maxRoll = Math.max(maxRoll, Math.abs(att.roll));
    if (sim.state.crashed) break;
  }
  return { crashed: sim.state.crashed, minAlt, maxAlt, maxRoll, finalSpeed: sim.state.airspeed, finalAlt: sim.state.position.y, reason: sim.state.crashReason };
}

for (const spec of [TRAINER_4CH, TRAINER_3CH]) {
  describe(`stabilité statique : ${spec.name}`, () => {
    const sim = new Simulation(buildAircraft(spec));

    it("est stable en tangage (dCm/dα < 0)", () => {
      const m2 = pitchMomentAtAlpha(sim, spec.cruiseSpeed, 2 * DEG).moment;
      const m6 = pitchMomentAtAlpha(sim, spec.cruiseSpeed, 6 * DEG).moment;
      expect(m6).toBeLessThan(m2);
    });

    it("porte son poids à la vitesse de croisière avec une incidence raisonnable", () => {
      const weight = spec.mass * GRAVITY;
      let found = false;
      for (let a = -2; a <= 10; a += 0.5) {
        const { lift } = pitchMomentAtAlpha(sim, spec.cruiseSpeed, a * DEG);
        if (lift >= weight) { found = true; expect(a).toBeLessThan(9); break; }
      }
      expect(found).toBe(true);
    });

    it("se trime : un braquage de profondeur modéré annule le moment en croisière", () => {
      let best = Infinity, bestCmd = 0;
      for (let cmd = -0.6; cmd <= 0.6; cmd += 0.05) {
        const { moment } = pitchMomentAtAlpha(sim, spec.cruiseSpeed, 3 * DEG, cmd);
        if (Math.abs(moment) < best) { best = Math.abs(moment); bestCmd = cmd; }
      }
      expect(best).toBeLessThan(0.05);
      expect(Math.abs(bestCmd)).toBeLessThan(0.5);
    });
  });

  describe(`vol : ${spec.name}`, () => {
    it("vole 30 s droit avec l'aide forte sans s'écraser", () => {
      const r = fly(spec, { seconds: 30, throttle: 0.6, assist: 2 });
      expect(r.crashed, r.reason).toBe(false);
      expect(r.minAlt).toBeGreaterThan(15);
      expect(r.maxAlt).toBeLessThan(150);
      expect(r.maxRoll).toBeLessThan(15 * DEG);
    });

    it("reste maîtrisable 20 s sans aucune aide, manches au neutre", () => {
      const r = fly(spec, { seconds: 20, throttle: 0.55, assist: 0 });
      expect(r.crashed, r.reason).toBe(false);
      expect(r.minAlt).toBeGreaterThan(5);
      expect(r.maxRoll).toBeLessThan(60 * DEG);
    });

    it("vire à droite avec l'aide forte et le manche à droite", () => {
      const sim = new Simulation(buildAircraft(spec));
      placeInAir(sim.state, new Vector3(0, 50, 0), 0, spec.cruiseSpeed);
      const raw: ControlVector = { roll: 0.6, pitch: 0, yaw: 0, throttle: 0.65 };
      const ctrl: ControlVector = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
      let turned = 0;
      let lastHeading = attitude(sim.state).heading;
      for (let i = 0; i < 8 / FIXED_DT; i++) {
        const att = attitude(sim.state);
        let dh = att.heading - lastHeading;
        while (dh > Math.PI) dh -= 2 * Math.PI;
        while (dh < -Math.PI) dh += 2 * Math.PI;
        turned += dh;
        lastHeading = att.heading;
        applyAssist(raw, att, spec, 2, ctrl);
        sim.step(ctrl);
      }
      const att = attitude(sim.state);
      expect(sim.state.crashed).toBe(false);
      expect(att.roll).toBeGreaterThan(15 * DEG);
      // Virage à droite = cap qui décroît dans le repère Three.js (rotation négative autour de +Y).
      expect(turned).toBeLessThan(-60 * DEG);
    });

    it("plane moteur coupé sans tomber comme une pierre", () => {
      const r = fly(spec, { seconds: 10, throttle: 0, assist: 2 });
      expect(r.crashed).toBe(false);
      // Un planeur de ce type descend à 1 ou 2 m/s.
      expect(50 - r.finalAlt).toBeLessThan(30);
      expect(r.finalSpeed).toBeGreaterThan(6);
      expect(r.finalSpeed).toBeLessThan(20);
    });
  });

  describe(`sol : ${spec.name}`, () => {
    it("reste posé sur ses roues moteur coupé", () => {
      const sim = new Simulation(buildAircraft(spec));
      placeOnGround(sim.state, sim.aircraft, new Vector3(0, 0, 0), 0);
      const y0 = sim.state.position.y;
      const ctrl: ControlVector = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
      for (let i = 0; i < 3 / FIXED_DT; i++) sim.step(ctrl);
      expect(sim.state.crashed).toBe(false);
      expect(Math.abs(sim.state.position.y - y0)).toBeLessThan(0.03);
      expect(sim.state.velocity.length()).toBeLessThan(0.05);
      const up = new Vector3(0, 1, 0).applyQuaternion(sim.state.orientation);
      expect(up.y).toBeGreaterThan(0.99);
    });

    it("décolle plein gaz en moins de 12 s", () => {
      const sim = new Simulation(buildAircraft(spec));
      placeOnGround(sim.state, sim.aircraft, new Vector3(0, 0, 0), 0);
      const raw: ControlVector = { roll: 0, pitch: 0, yaw: 0, throttle: 1 };
      const ctrl: ControlVector = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
      let airborneAt = -1;
      for (let i = 0; i < 12 / FIXED_DT; i++) {
        const t = i * FIXED_DT;
        raw.pitch = t > 2 ? 0.35 : 0;
        applyAssist(raw, attitude(sim.state), spec, 2, ctrl);
        sim.step(ctrl);
        if (sim.state.crashed) break;
        if (sim.state.position.y > 3 && airborneAt < 0) airborneAt = t;
      }
      expect(sim.state.crashed, sim.state.crashReason).toBe(false);
      expect(airborneAt).toBeGreaterThan(0);
      expect(airborneAt).toBeLessThan(12);
    });
  });
}

describe("attitude", () => {
  it("lit le roulis à droite et le cabré avec les bons signes", () => {
    const sim = new Simulation(buildAircraft(TRAINER_4CH));
    sim.state.orientation.setFromAxisAngle(new Vector3(0, 0, 1), -20 * DEG);
    expect(attitude(sim.state).roll).toBeCloseTo(20 * DEG, 3);
    sim.state.orientation.setFromAxisAngle(new Vector3(1, 0, 0), 10 * DEG);
    expect(attitude(sim.state).pitch).toBeCloseTo(10 * DEG, 3);
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -30 * DEG);
    sim.state.orientation.copy(q);
    expect(attitude(sim.state).heading).toBeCloseTo(-30 * DEG, 3);
  });
});
