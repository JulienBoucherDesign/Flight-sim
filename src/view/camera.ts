import { PerspectiveCamera, Vector3, Quaternion } from "three";

export type CameraMode = "pilot" | "chase";

const FORWARD = new Vector3(0, 0, -1);
const UP = new Vector3(0, 1, 0);

/** Caméra pilote au sol (zoom automatique) ou caméra de poursuite. */
export class CameraRig {
  mode: CameraMode = "pilot";
  private readonly lookTarget = new Vector3();
  private readonly chasePos = new Vector3();
  private fov = 50;
  private readonly tmp = new Vector3();
  private readonly tmpQ = new Quaternion();

  constructor(private readonly camera: PerspectiveCamera, readonly pilotPosition: Vector3) {
    this.camera.position.copy(pilotPosition);
    this.lookTarget.set(0, 2, -30);
  }

  toggle(): CameraMode {
    this.mode = this.mode === "pilot" ? "chase" : "pilot";
    this.fov = 50;
    return this.mode;
  }

  snap(planePos: Vector3, planeQ: Quaternion): void {
    this.lookTarget.copy(planePos);
    this.tmp.copy(FORWARD).applyQuaternion(planeQ);
    this.chasePos.copy(planePos).addScaledVector(this.tmp, -7).addScaledVector(UP, 2.2);
    this.update(planePos, planeQ, 1);
  }

  update(planePos: Vector3, planeQ: Quaternion, dt: number): void {
    const cam = this.camera;
    if (this.mode === "pilot") {
      cam.position.copy(this.pilotPosition);
      const k = 1 - Math.exp(-12 * dt);
      this.lookTarget.lerp(planePos, k);
      cam.lookAt(this.lookTarget);
      const dist = this.tmp.copy(planePos).sub(this.pilotPosition).length();
      // Un avion d'environ 1,3 m doit rester lisible : on resserre le champ avec la distance.
      const target = Math.min(55, Math.max(7, (1.3 / dist) * (180 / Math.PI) * 16));
      this.fov += (target - this.fov) * (1 - Math.exp(-3 * dt));
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    } else {
      this.tmp.copy(FORWARD).applyQuaternion(planeQ);
      this.tmp.y *= 0.4;
      this.tmp.normalize();
      const desired = new Vector3().copy(planePos).addScaledVector(this.tmp, -7).addScaledVector(UP, 2.2);
      if (desired.y < 0.6) desired.y = 0.6;
      const k = 1 - Math.exp(-6 * dt);
      this.chasePos.lerp(desired, k);
      cam.position.copy(this.chasePos);
      this.tmpQ.copy(planeQ);
      const ahead = new Vector3().copy(FORWARD).applyQuaternion(this.tmpQ).multiplyScalar(6).add(planePos);
      this.lookTarget.lerp(ahead, 1 - Math.exp(-10 * dt));
      cam.lookAt(this.lookTarget);
      this.fov += (60 - this.fov) * (1 - Math.exp(-3 * dt));
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
