import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { buildAircraft, TRAINER_4CH, TRAINER_3CH } from "../src/core/aircraft";
import { flapEffectiveness, surfaceCoefficients, surfaceDeflection, surfaceForces, type AirEnvironment } from "../src/core/aero";

const DEG = Math.PI / 180;
const calm = (): AirEnvironment => ({ washSpeed: 0, windBody: new Vector3(), downwashSpeed: 0, groundEffect: 0 });

describe("aérodynamique d'un panneau", () => {
  const ac = buildAircraft(TRAINER_4CH);
  const wing = ac.surfaces.find((s) => s.name === "aile droite int.")!;
  const stab = ac.surfaces.find((s) => s.name === "stab droit")!;

  it("l'efficacité d'un volet suit la théorie des profils minces", () => {
    expect(flapEffectiveness(0)).toBeCloseTo(0, 5);
    expect(flapEffectiveness(1)).toBeCloseTo(1, 5);
    expect(flapEffectiveness(0.3)).toBeGreaterThan(0.6);
    expect(flapEffectiveness(0.3)).toBeLessThan(0.7);
  });

  it("la portance croît avec l'incidence puis décroche", () => {
    const c0 = surfaceCoefficients(wing, 0, 0);
    const c5 = surfaceCoefficients(wing, 5 * DEG, 0);
    const c10 = surfaceCoefficients(wing, 10 * DEG, 0);
    const c30 = surfaceCoefficients(wing, 30 * DEG, 0);
    expect(c5.cl).toBeGreaterThan(c0.cl);
    expect(c10.cl).toBeGreaterThan(c5.cl);
    expect(c30.cl).toBeLessThan(c10.cl);
    expect(c30.cd).toBeGreaterThan(c10.cd * 3);
    expect(c30.stalled).toBeGreaterThan(0.9);
  });

  it("les coefficients sont continus au décrochage", () => {
    const stall = wing.airfoil.alphaStallPos;
    const before = surfaceCoefficients(wing, stall - 0.001, 0);
    const after = surfaceCoefficients(wing, stall + 0.001, 0);
    expect(Math.abs(before.cl - after.cl)).toBeLessThan(0.02);
    expect(Math.abs(before.cd - after.cd)).toBeLessThan(0.02);
  });

  it("un braquage de volet augmente la portance", () => {
    const plain = surfaceCoefficients(stab, 2 * DEG, 0);
    const flapped = surfaceCoefficients(stab, 2 * DEG, 15 * DEG);
    expect(flapped.cl).toBeGreaterThan(plain.cl + 0.3);
  });

  it("l'effet de sol réduit la traînée induite et augmente un peu la portance", () => {
    const free = surfaceCoefficients(wing, 6 * DEG, 0, 0);
    const near = surfaceCoefficients(wing, 6 * DEG, 0, 1);
    expect(near.cl).toBeGreaterThan(free.cl);
    expect(near.cd).toBeLessThan(free.cd);
  });

  it("la déflexion de l'aile réduit l'incidence vue par le stabilisateur", () => {
    const v = new Vector3(0, 0, -10);
    const env = calm();
    const plain = surfaceForces(stab, v, new Vector3(), 0, env);
    env.downwashSpeed = 0.6;
    const washed = surfaceForces(stab, v, new Vector3(), 0, env);
    expect(washed.alpha).toBeLessThan(plain.alpha);
  });

  it("une aile en vol horizontal produit une force vers le haut et vers l'arrière", () => {
    const v = new Vector3(0, 0, -10);
    const r = surfaceForces(wing, v, new Vector3(), 0, calm());
    expect(r.force.y).toBeGreaterThan(0);
    expect(r.force.z).toBeGreaterThan(0);
    expect(r.alpha).toBeCloseTo(2 * DEG, 2);
  });

  it("une commande de roulis à droite braque les ailerons en sens opposé", () => {
    const right = ac.surfaces.find((s) => s.name === "aile droite ext.")!;
    const left = ac.surfaces.find((s) => s.name === "aile gauche ext.")!;
    const v = new Vector3(0, 0, -10);
    const ctrl = { roll: 1, pitch: 0, yaw: 0, throttle: 0 };
    const fr = surfaceForces(right, v, new Vector3(), surfaceDeflection(right, ctrl), calm());
    const fl = surfaceForces(left, v, new Vector3(), surfaceDeflection(left, ctrl), calm());
    expect(fr.force.y).toBeLessThan(fl.force.y);
    // Moment autour de Z : aile droite qui descend = rotation négative autour de +Z.
    const mz = fr.moment.z + fl.moment.z;
    expect(mz).toBeLessThan(0);
  });

  it("le trainer 3 voies tourne avec la dérive quand on met du roulis", () => {
    const ac3 = buildAircraft(TRAINER_3CH);
    const fin = ac3.surfaces.find((s) => s.name === "dérive")!;
    const v = new Vector3(0, 0, -10);
    const r = surfaceForces(fin, v, new Vector3(), surfaceDeflection(fin, { roll: 1, pitch: 0, yaw: 0, throttle: 0 }), calm());
    // Force vers la gauche sur la queue → le nez part à droite (rotation négative autour de +Y).
    expect(r.force.x).toBeLessThan(0);
    expect(r.moment.y).toBeLessThan(0);
  });
});
