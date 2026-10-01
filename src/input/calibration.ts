import { readRaw, type AxisCalibration, type ButtonBinding, type RadioCalibration, type StickChannel, STICK_CHANNELS } from "./gamepad";

export type WizardStep =
  | { type: "range"; channel: StickChannel }
  | { type: "direction"; channel: StickChannel }
  | { type: "center" }
  | { type: "reset" }
  | { type: "smoke" };

export const CHANNEL_LABELS: Record<StickChannel, string> = {
  throttle: "des GAZ",
  pitch: "de PROFONDEUR (monter / descendre)",
  roll: "des AILERONS (pencher à gauche / à droite)",
  yaw: "de DÉRIVE (tourner le nez)",
};

export const DIRECTION_TEXT: Record<StickChannel, string> = {
  throttle: "Mets le manche des GAZ tout en HAUT (plein gaz), puis clique sur Suivant.",
  pitch: "Tire le manche de PROFONDEUR vers TOI (vers le bas), comme pour faire monter le nez, puis clique sur Suivant.",
  roll: "Pousse le manche des AILERONS à DROITE, puis clique sur Suivant.",
  yaw: "Pousse le manche de DÉRIVE à DROITE, puis clique sur Suivant.",
};

export interface WizardView {
  step: WizardStep;
  title: string;
  text: string;
  axes: { index: number; value: number; min: number; max: number; hot: boolean; used: boolean }[];
  detected: string;
  canNext: boolean;
  canSkip: boolean;
}

/** Assistant de calibration : détecte l'axe de chaque manche en regardant lequel bouge. */
export class CalibrationWizard {
  readonly gamepadId: string;
  private steps: WizardStep[];
  private index = 0;
  private axisMin: number[] = [];
  private axisMax: number[] = [];
  private baseline: number[] = [];
  private baselineButtons: number[] = [];
  private latest: number[] = [];
  private result: Partial<Record<StickChannel, AxisCalibration>> = {};
  private resetBinding: ButtonBinding | undefined;
  private smokeBinding: ButtonBinding | undefined;
  private candidate = -1;

  constructor(gamepad: Gamepad) {
    this.gamepadId = gamepad.id;
    this.steps = [];
    for (const ch of STICK_CHANNELS) {
      this.steps.push({ type: "range", channel: ch });
      this.steps.push({ type: "direction", channel: ch });
    }
    this.steps.push({ type: "center" });
    this.steps.push({ type: "reset" });
    this.steps.push({ type: "smoke" });
    this.beginStep(gamepad);
  }

  get step(): WizardStep {
    return this.steps[this.index];
  }

  private beginStep(gamepad: Gamepad): void {
    const raw = readRaw(gamepad);
    this.baseline = raw.axes.slice();
    this.baselineButtons = raw.buttons.slice();
    this.axisMin = raw.axes.slice();
    this.axisMax = raw.axes.slice();
    this.latest = raw.axes.slice();
    this.candidate = -1;
  }

  private usedAxes(): Set<number> {
    return new Set(Object.values(this.result).map((c) => c.axis));
  }

  /** À appeler à chaque image avec la manette courante. */
  update(gamepad: Gamepad): void {
    const raw = readRaw(gamepad);
    this.latest = raw.axes.slice();
    for (let i = 0; i < raw.axes.length; i++) {
      this.axisMin[i] = Math.min(this.axisMin[i] ?? raw.axes[i], raw.axes[i]);
      this.axisMax[i] = Math.max(this.axisMax[i] ?? raw.axes[i], raw.axes[i]);
    }
    const step = this.step;
    if (step.type === "range") {
      const used = this.usedAxes();
      let best = -1;
      let bestRange = 0.5;
      for (let i = 0; i < raw.axes.length; i++) {
        if (used.has(i)) continue;
        const range = this.axisMax[i] - this.axisMin[i];
        if (range > bestRange) { bestRange = range; best = i; }
      }
      this.candidate = best;
    } else if (step.type === "reset" || step.type === "smoke") {
      // Un bouton pressé ou un axe qui a bougé depuis le début de l'étape.
      const used = this.usedAxes();
      if (this.resetBinding?.kind === "axis" && step.type === "smoke") used.add(this.resetBinding.index);
      this.candidate = -1;
      for (let i = 0; i < raw.buttons.length; i++) {
        if (step.type === "smoke" && this.resetBinding?.kind === "button" && this.resetBinding.index === i) continue;
        if (raw.buttons[i] > 0.5 && (this.baselineButtons[i] ?? 0) <= 0.5) { this.candidate = 1000 + i; break; }
      }
      if (this.candidate < 0) {
        for (let i = 0; i < raw.axes.length; i++) {
          if (used.has(i)) continue;
          if (Math.abs(raw.axes[i] - (this.baseline[i] ?? 0)) > 0.5) { this.candidate = i; break; }
        }
      }
    }
  }

  view(): WizardView {
    const step = this.step;
    const used = this.usedAxes();
    const axes = this.latest.map((value, index) => ({
      index,
      value,
      min: this.axisMin[index] ?? value,
      max: this.axisMax[index] ?? value,
      hot: index === this.candidate || (step.type === "direction" && this.result[step.channel]?.axis === index),
      used: used.has(index),
    }));
    let title = "Réglage de la radio";
    let text = "";
    let detected = "";
    let canNext = true;
    let canSkip = false;
    switch (step.type) {
      case "range": {
        const n = STICK_CHANNELS.indexOf(step.channel) + 1;
        title = `Manche ${n} sur 4`;
        text = `Bouge le manche ${CHANNEL_LABELS[step.channel]} à fond dans les deux sens, plusieurs fois.`;
        detected = this.candidate >= 0 ? `Axe détecté : ${this.candidate + 1}` : "J'attends de voir un manche bouger…";
        canNext = this.candidate >= 0;
        break;
      }
      case "direction": {
        const n = STICK_CHANNELS.indexOf(step.channel) + 1;
        title = `Manche ${n} sur 4 : le sens`;
        text = DIRECTION_TEXT[step.channel];
        const cal = this.result[step.channel];
        detected = cal ? `Axe ${cal.axis + 1}, valeur actuelle ${this.latest[cal.axis]?.toFixed(2) ?? "?"}` : "";
        break;
      }
      case "center":
        title = "Position de repos";
        text = "Lâche les trois manches à ressort et mets les GAZ tout en BAS, puis clique sur Suivant.";
        detected = "Je mémorise le centre de chaque manche.";
        break;
      case "reset":
        title = "Bouton « Recommencer » (facultatif)";
        text = "Bascule un interrupteur ou appuie sur un bouton de la radio pour lui donner le rôle « Recommencer ». Sinon clique sur Passer.";
        detected = this.candidate >= 1000 ? `Bouton ${this.candidate - 1000 + 1} détecté` : this.candidate >= 0 ? `Interrupteur sur l'axe ${this.candidate + 1} détecté` : "Rien détecté pour l'instant.";
        canNext = this.candidate >= 0;
        canSkip = true;
        break;
      case "smoke":
        title = "Interrupteur de FUMÉE (facultatif)";
        text = "Bascule un interrupteur du haut de la radio pour commander la fumée (il faut l'avoir affecté à une voie dans la radio). Sinon clique sur Passer.";
        detected = this.candidate >= 1000 ? `Bouton ${this.candidate - 1000 + 1} détecté` : this.candidate >= 0 ? `Interrupteur sur l'axe ${this.candidate + 1} détecté` : "Rien détecté pour l'instant.";
        canNext = this.candidate >= 0;
        canSkip = true;
        break;
    }
    return { step, title, text, axes, detected, canNext, canSkip };
  }

  /** Avance d'une étape. Renvoie la calibration finale quand elle est complète. */
  next(gamepad: Gamepad, skip = false): RadioCalibration | null {
    const step = this.step;
    switch (step.type) {
      case "range": {
        if (this.candidate < 0) return null;
        const i = this.candidate;
        this.result[step.channel] = { axis: i, min: this.axisMin[i], max: this.axisMax[i], center: (this.axisMin[i] + this.axisMax[i]) / 2, invert: false };
        break;
      }
      case "direction": {
        const cal = this.result[step.channel];
        if (cal) {
          const v = this.latest[cal.axis] ?? cal.center;
          const mid = (cal.min + cal.max) / 2;
          // Le manche est dans la position « positive » : si la valeur lue est basse, l'axe est inversé.
          cal.invert = v < mid;
        }
        break;
      }
      case "center": {
        for (const ch of STICK_CHANNELS) {
          const cal = this.result[ch];
          if (!cal) continue;
          const v = this.latest[cal.axis] ?? cal.center;
          if (ch === "throttle") {
            // Gaz en bas : on resserre la borne basse si besoin.
            if (cal.invert) cal.max = Math.max(cal.max, v); else cal.min = Math.min(cal.min, v);
          } else {
            cal.center = v;
          }
        }
        break;
      }
      case "reset": {
        if (!skip && this.candidate >= 0) {
          if (this.candidate >= 1000) this.resetBinding = { kind: "button", index: this.candidate - 1000, rest: 0 };
          else this.resetBinding = { kind: "axis", index: this.candidate, rest: this.baseline[this.candidate] ?? 0, on: this.latest[this.candidate] };
        }
        break;
      }
      case "smoke": {
        if (!skip && this.candidate >= 0) {
          if (this.candidate >= 1000) this.smokeBinding = { kind: "button", index: this.candidate - 1000, rest: 0 };
          else this.smokeBinding = { kind: "axis", index: this.candidate, rest: this.baseline[this.candidate] ?? 0, on: this.latest[this.candidate] };
        }
        // Dernière étape : la calibration est complète.
        return this.build();
      }
    }
    this.index++;
    this.beginStep(gamepad);
    return null;
  }

  back(gamepad: Gamepad): void {
    if (this.index === 0) return;
    this.index--;
    const step = this.step;
    if (step.type === "range") delete this.result[step.channel];
    this.beginStep(gamepad);
  }

  private build(): RadioCalibration | null {
    const t = this.result.throttle, p = this.result.pitch, r = this.result.roll, y = this.result.yaw;
    if (!t || !p || !r || !y) return null;
    return { version: 1, gamepadId: this.gamepadId, throttle: t, pitch: p, roll: r, yaw: y, reset: this.resetBinding, smoke: this.smokeBinding, deadband: 0.04 };
  }
}
