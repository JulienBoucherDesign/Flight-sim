import type { ControlVector } from "../core/aero";

export type KeyAction = "reset" | "camera" | "pause" | "menu" | "smoke";

/** Clavier de secours : flèches pour le manche droit, Z/S pour les gaz, Q/D pour la dérive (positions physiques). */
export class KeyboardInput {
  private down = new Set<string>();
  private throttle = 0;
  private pitch = 0;
  private roll = 0;
  private yaw = 0;
  private listeners: ((a: KeyAction) => void)[] = [];

  constructor(target: Window = window) {
    target.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.repeat) return;
      this.down.add(e.code);
      const action = this.actionFor(e.code);
      if (action) {
        e.preventDefault();
        for (const l of this.listeners) l(action);
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    });
    target.addEventListener("keyup", (e) => this.down.delete(e.code));
    target.addEventListener("blur", () => this.down.clear());
  }

  onAction(listener: (a: KeyAction) => void): void {
    this.listeners.push(listener);
  }

  private actionFor(code: string): KeyAction | null {
    switch (code) {
      case "Space": return "reset";
      case "KeyC": return "camera";
      case "KeyF": return "smoke";
      case "KeyP": return "pause";
      case "Escape": return "menu";
      default: return null;
    }
  }

  get active(): boolean {
    return this.down.size > 0 || this.throttle > 0;
  }

  update(dt: number, out: ControlVector): void {
    const d = this.down;
    const target = (neg: string, pos: string) => (d.has(pos) ? 1 : 0) - (d.has(neg) ? 1 : 0);
    const rate = 7 * dt;
    const approach = (cur: number, t: number) => (t > cur ? Math.min(t, cur + rate) : Math.max(t, cur - rate));
    // Convention RC : flèche bas = manche tiré vers soi = nez qui monte.
    this.pitch = approach(this.pitch, target("ArrowUp", "ArrowDown"));
    this.roll = approach(this.roll, target("ArrowLeft", "ArrowRight"));
    this.yaw = approach(this.yaw, target("KeyA", "KeyD"));
    const thr = target("KeyS", "KeyW");
    this.throttle = Math.min(1, Math.max(0, this.throttle + thr * 0.7 * dt));
    out.pitch = this.pitch;
    out.roll = this.roll;
    out.yaw = this.yaw;
    out.throttle = this.throttle;
  }

  setThrottle(v: number): void {
    this.throttle = Math.min(1, Math.max(0, v));
  }
}
