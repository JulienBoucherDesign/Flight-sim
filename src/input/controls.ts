import type { ControlVector } from "../core/aero";
import { GamepadReader, listGamepads } from "./gamepad";
import { KeyboardInput, type KeyAction } from "./keyboard";

export type InputSource = "radio" | "keyboard";

export interface InputStatus {
  source: InputSource;
  gamepadName: string | null;
  calibrated: boolean;
}

/** Combine la radio (prioritaire quand elle est calibrée) et le clavier de secours. */
export class InputManager {
  readonly gamepad = new GamepadReader();
  readonly keyboard: KeyboardInput;
  readonly raw: ControlVector = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
  private lastSource: InputSource = "keyboard";
  private actionListeners: ((a: KeyAction) => void)[] = [];

  constructor() {
    this.keyboard = new KeyboardInput();
    this.keyboard.onAction((a) => { for (const l of this.actionListeners) l(a); });
  }

  onAction(listener: (a: KeyAction) => void): void {
    this.actionListeners.push(listener);
  }

  status(): InputStatus {
    const pad = this.gamepad.current();
    const calibrated = !!pad && !!this.gamepad.calibration && this.gamepad.calibration.gamepadId === pad.id;
    return { source: calibrated ? "radio" : "keyboard", gamepadName: pad ? pad.id : null, calibrated };
  }

  get source(): InputSource {
    return this.lastSource;
  }

  update(dt: number): ControlVector {
    this.gamepad.refreshCalibration();
    if (this.gamepad.read(this.raw)) {
      this.lastSource = "radio";
      if (this.gamepad.consumeReset()) for (const l of this.actionListeners) l("reset");
    } else {
      this.lastSource = "keyboard";
      this.keyboard.update(dt, this.raw);
    }
    return this.raw;
  }

  hasAnyGamepad(): boolean {
    return listGamepads().length > 0;
  }
}
