import { ASSIST_LABELS, type AssistLevel } from "../core/assist";

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Élément manquant : #${id}`);
  return e as T;
}

export class Hud {
  readonly root = el<HTMLDivElement>("hud");
  private readonly alt = el<HTMLElement>("hud-alt");
  private readonly speed = el<HTMLElement>("hud-speed");
  private readonly score = el<HTMLElement>("hud-score");
  private readonly assist = el<HTMLElement>("hud-assist");
  private readonly message = el<HTMLElement>("hud-message");
  private readonly sub = el<HTMLElement>("hud-sub");
  private readonly throttle = el<HTMLElement>("hud-throttle");
  private messageUntil = 0;

  show(visible: boolean): void {
    this.root.classList.toggle("hidden", !visible);
  }

  update(altitude: number, speedMs: number, throttle: number, score: number, assist: AssistLevel, now: number): void {
    this.alt.textContent = Math.max(0, altitude).toFixed(0);
    this.speed.textContent = (speedMs * 3.6).toFixed(0);
    this.throttle.style.width = `${Math.round(throttle * 100)}%`;
    this.score.textContent = String(score);
    this.assist.textContent = ASSIST_LABELS[assist];
    if (this.messageUntil && now > this.messageUntil) {
      this.message.textContent = "";
      this.sub.textContent = "";
      this.messageUntil = 0;
    }
  }

  say(text: string, sub = "", durationMs = 2500, now = performance.now()): void {
    this.message.textContent = text;
    this.sub.textContent = sub;
    this.messageUntil = durationMs > 0 ? now + durationMs : Number.POSITIVE_INFINITY;
  }

  clear(): void {
    this.message.textContent = "";
    this.sub.textContent = "";
    this.messageUntil = 0;
  }
}
