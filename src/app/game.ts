import { Vector3, Quaternion } from "three";
import { buildAircraft, findAircraft, type AircraftSpec } from "../core/aircraft";
import type { ControlVector } from "../core/aero";
import { applyAssist, type AssistLevel } from "../core/assist";
import { Simulation, FIXED_DT, attitude, placeInAir, placeOnGround, type Attitude } from "../core/sim";
import { InputManager } from "../input/controls";
import { CameraRig } from "../view/camera";
import { AIR_START, GROUND_START, PILOT_POSITION, createField, createRings, type Ring } from "../view/field";
import { createPlaneModel, type PlaneModel } from "../view/planeMesh";
import { createScene, followShadow, type SceneContext } from "../view/scene";
import { SmokeSystem } from "../view/smoke";
import { Hud } from "./hud";
import { SoundManager } from "./audio";

export type StartMode = "air" | "ground";
export type WindLevel = "none" | "light" | "medium";
const WIND_PRESETS: Record<WindLevel, [number, number]> = { none: [0, 0], light: [2, 0.8], medium: [4, 1.8] };
export type GameState = "menu" | "flying" | "crashed" | "paused";

export interface GameSettings {
  aircraftId: string;
  assist: AssistLevel;
  start: StartMode;
  wind: WindLevel;
}

const SETTINGS_KEY = "rcsim.settings.v1";

export function loadSettings(): GameSettings {
  const defaults: GameSettings = { aircraftId: "trainer3", assist: 2, start: "air", wind: "none" };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      aircraftId: typeof parsed.aircraftId === "string" ? parsed.aircraftId : defaults.aircraftId,
      assist: parsed.assist === 0 || parsed.assist === 1 || parsed.assist === 2 ? parsed.assist : defaults.assist,
      start: parsed.start === "ground" ? "ground" : "air",
      wind: parsed.wind === "light" || parsed.wind === "medium" ? parsed.wind : "none",
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(s: GameSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export class Game {
  readonly ctx: SceneContext;
  readonly input = new InputManager();
  readonly hud = new Hud();
  readonly sound = new SoundManager();
  readonly camera: CameraRig;
  settings: GameSettings;
  state: GameState = "menu";
  spec: AircraftSpec;
  sim: Simulation;
  model: PlaneModel;
  rings: Ring[];
  readonly smoke = new SmokeSystem();
  nextRing = 0;
  score = 0;
  laps = 0;
  private readonly controls: ControlVector = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
  private readonly att: Attitude = { roll: 0, pitch: 0, heading: 0, rollRate: 0, pitchRate: 0, yawRate: 0 };
  private accumulator = 0;
  private lastTime = 0;
  private crashTimer = 0;
  private ringSide = 0;
  private readonly tmp = new Vector3();
  private readonly tmpQ = new Quaternion();
  private readonly smokeOrigin = new Vector3();
  private smokeWasOn = false;
  onStateChange: ((s: GameState) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = createScene(canvas);
    this.ctx.scene.add(createField());
    this.rings = createRings();
    for (const r of this.rings) this.ctx.scene.add(r.mesh);
    this.camera = new CameraRig(this.ctx.camera, PILOT_POSITION);
    this.settings = loadSettings();
    this.spec = findAircraft(this.settings.aircraftId);
    this.sim = new Simulation(buildAircraft(this.spec));
    this.applyWind();
    this.model = createPlaneModel(this.spec);
    this.ctx.scene.add(this.model.group);
    this.ctx.scene.add(this.smoke.points);
    this.resetAircraft();
    this.highlightRings();

    this.input.onAction((a) => {
      if (a === "reset") this.resetAircraft();
      else if (a === "camera") this.toggleCamera();
      else if (a === "pause") this.togglePause();
      else if (a === "menu") this.openMenu();
    });
  }

  setAircraft(id: string): void {
    if (id === this.spec.id) return;
    this.spec = findAircraft(id);
    this.settings.aircraftId = this.spec.id;
    saveSettings(this.settings);
    this.ctx.scene.remove(this.model.group);
    this.model.dispose();
    this.sim = new Simulation(buildAircraft(this.spec));
    this.applyWind();
    this.model = createPlaneModel(this.spec);
    this.ctx.scene.add(this.model.group);
    this.resetAircraft();
  }

  setWind(level: WindLevel): void {
    this.settings.wind = level;
    saveSettings(this.settings);
    this.applyWind();
  }

  private applyWind(): void {
    const [speed, gust] = WIND_PRESETS[this.settings.wind];
    this.sim.wind.set(speed, gust);
  }

  setAssist(level: AssistLevel): void {
    this.settings.assist = level;
    saveSettings(this.settings);
  }

  setStart(mode: StartMode): void {
    this.settings.start = mode;
    saveSettings(this.settings);
    this.resetAircraft();
  }

  resetAircraft(): void {
    const s = this.sim.state;
    if (this.settings.start === "ground") {
      placeOnGround(s, this.sim.aircraft, GROUND_START, 0);
    } else {
      placeInAir(s, AIR_START, 0, this.spec.cruiseSpeed, 0.55);
    }
    this.input.keyboard.setThrottle(this.settings.start === "ground" ? 0 : 0.55);
    this.crashTimer = 0;
    this.ringSide = 0;
    this.syncModel();
    this.camera.snap(s.position, s.orientation);
    if (this.state === "crashed") this.setState("flying");
    this.hud.clear();
    if (this.state === "flying") {
      this.hud.say(this.settings.start === "ground" ? "Mets les gaz !" : "C'est parti !", this.settings.start === "ground" ? "Pousse les gaz à fond, puis tire doucement sur le manche." : "Vise les anneaux.", 3000);
    }
  }

  setState(s: GameState): void {
    if (this.state === s) return;
    this.state = s;
    this.hud.show(s !== "menu");
    this.onStateChange?.(s);
  }

  startFlight(): void {
    this.sound.ensure();
    this.setState("flying");
    this.resetAircraft();
    this.hud.say("C'est parti !", this.settings.start === "ground" ? "Pousse les gaz à fond, puis tire doucement sur le manche." : "Vise les anneaux.", 3000);
  }

  openMenu(): void {
    this.setState("menu");
  }

  togglePause(): void {
    if (this.state === "flying") { this.setState("paused"); this.hud.say("Pause", "Appuie sur P pour reprendre.", 0); }
    else if (this.state === "paused") { this.setState("flying"); this.hud.clear(); }
  }

  toggleCamera(): string {
    const mode = this.camera.toggle();
    const s = this.sim.state;
    this.camera.snap(s.position, s.orientation);
    return mode;
  }

  toggleSound(): boolean {
    this.sound.ensure();
    return this.sound.toggleMute();
  }

  private highlightRings(): void {
    this.rings.forEach((r, i) => {
      const mat = r.mesh.material as import("three").MeshStandardMaterial;
      if (i === this.nextRing) { mat.color.set(0xffd23c); mat.emissive.set(0x7a5a00); mat.opacity = 1; }
      else if (i < this.nextRing) { mat.color.set(0x5fd37a); mat.emissive.set(0x0c3a18); mat.opacity = 0.6; }
      else { mat.color.set(0xffffff); mat.emissive.set(0x000000); mat.opacity = 0.75; }
    });
  }

  private checkRings(): void {
    const ring = this.rings[this.nextRing];
    const p = this.sim.state.position;
    const d = this.tmp.copy(p).sub(ring.center);
    const along = d.dot(ring.normal);
    const side = Math.sign(along);
    if (this.ringSide !== 0 && side !== 0 && side !== this.ringSide && Math.abs(along) < 6) {
      const lateral = d.addScaledVector(ring.normal, -along).length();
      if (lateral < ring.radius) {
        this.score++;
        this.sound.ding();
        this.nextRing = (this.nextRing + 1) % this.rings.length;
        if (this.nextRing === 0) {
          this.laps++;
          this.hud.say("Tour complet !", "Bravo, encore un ?", 3000);
        } else {
          this.hud.say("Bravo !", `Encore ${this.rings.length - this.nextRing} anneau${this.rings.length - this.nextRing > 1 ? "x" : ""}.`, 1500);
        }
        this.highlightRings();
        this.ringSide = 0;
        return;
      }
    }
    this.ringSide = side;
  }

  private syncModel(): void {
    const s = this.sim.state;
    this.model.group.position.copy(s.position);
    this.model.group.quaternion.copy(s.orientation);
  }

  private readonly shaped: ControlVector = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };

  private stepSim(raw: ControlVector): void {
    attitude(this.sim.state, this.att);
    // Expo de 30 % comme sur une vraie radio : plus doux autour du neutre, pleine course en butée.
    const expo = (x: number) => 0.7 * x + 0.3 * x * x * x;
    this.shaped.roll = expo(raw.roll);
    this.shaped.pitch = expo(raw.pitch);
    this.shaped.yaw = expo(raw.yaw);
    this.shaped.throttle = raw.throttle;
    applyAssist(this.shaped, this.att, this.spec, this.settings.assist, this.controls, this.sim.state.airspeed);
    this.sim.step(this.controls, FIXED_DT);
  }

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const dtReal = this.lastTime ? Math.min(0.1, (now - this.lastTime) / 1000) : 0;
    this.lastTime = now;
    const raw = this.input.update(dtReal);

    if (this.state === "flying") {
      this.accumulator += dtReal;
      let guard = 0;
      while (this.accumulator >= FIXED_DT && guard++ < 40) {
        this.stepSim(raw);
        this.accumulator -= FIXED_DT;
        if (this.sim.state.crashed) break;
      }
      if (this.sim.state.crashed) {
        this.setState("crashed");
        this.crashTimer = 3;
        this.sound.crash();
        this.hud.say("Oups !", `${this.sim.state.crashReason}. On recommence dans 3 s.`, 0);
      } else {
        this.checkRings();
      }
    } else if (this.state === "crashed") {
      // On laisse l'avion s'immobiliser et on compte à rebours.
      this.accumulator += dtReal;
      while (this.accumulator >= FIXED_DT) { this.sim.step(this.controls, FIXED_DT); this.accumulator -= FIXED_DT; }
      this.crashTimer -= dtReal;
      if (this.crashTimer <= 0) this.resetAircraft();
    }

    const s = this.sim.state;
    this.syncModel();
    this.model.update(this.sim.telemetry.deflections, s.engine, dtReal);
    this.updateSmoke(dtReal);
    this.camera.update(s.position, s.orientation, dtReal);
    followShadow(this.ctx, s.position);
    this.sound.setEngine(s.engine, s.airspeed, this.state === "flying" || this.state === "crashed", this.spec.engine.type);
    if (this.state !== "menu") {
      this.hud.update(s.position.y, s.airspeed, s.throttle, this.score, this.settings.assist, now);
    }
    this.tmpQ.copy(s.orientation);
    this.ctx.renderer.render(this.ctx.scene, this.ctx.camera);
  };

  private updateSmoke(dt: number): void {
    const s = this.sim.state;
    const on = this.input.smokeActive && this.state === "flying";
    if (on !== this.smokeWasOn && this.state === "flying") {
      this.hud.say(on ? "Fumée !" : "", "", 1200);
      this.smokeWasOn = on;
    }
    if (on) {
      this.smokeOrigin.set(...this.spec.smokePos).applyQuaternion(s.orientation).add(s.position);
      this.smoke.emit(this.smokeOrigin, s.velocity, 140, dt);
    }
    this.sim.wind.sample(10, 0, this.smoke.wind);
    this.smoke.setScale(this.ctx.renderer.domElement.clientHeight || window.innerHeight, this.ctx.camera.fov);
    this.smoke.update(dt);
  }

  run(): void {
    requestAnimationFrame(this.frame);
  }
}
