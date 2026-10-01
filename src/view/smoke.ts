import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, NormalBlending, Points, ShaderMaterial, Vector3, SRGBColorSpace } from "three";

function puffTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.5, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Fumée de meeting : des particules qui grossissent et s'estompent, poussées par le vent. */
export class SmokeSystem {
  readonly points: Points;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly geometry: BufferGeometry;
  private cursor = 0;
  private carry = 0;
  /** Vent appliqué aux particules. */
  readonly wind = new Vector3();

  constructor(max = 900) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max).fill(1e9);
    this.life = new Float32Array(max).fill(1);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute("position", new BufferAttribute(this.pos, 3));
    this.geometry.setAttribute("aSize", new BufferAttribute(this.size, 1));
    this.geometry.setAttribute("aAlpha", new BufferAttribute(this.alpha, 1));
    const material = new ShaderMaterial({
      uniforms: { map: { value: puffTexture() }, scale: { value: 400 } },
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      vertexShader: `
        attribute float aSize; attribute float aAlpha; varying float vAlpha; uniform float scale;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * scale / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying float vAlpha;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(0.97, 0.97, 0.97, t.a * vAlpha);
        }`,
    });
    void AdditiveBlending;
    this.points = new Points(this.geometry, material);
    this.points.frustumCulled = false;
    this.geometry.setDrawRange(0, 0);
  }

  /** Taille à l'écran cohérente avec la perspective : hauteur de la vue et champ vertical de la caméra. */
  setScale(viewportHeight: number, fovDeg: number): void {
    (this.points.material as ShaderMaterial).uniforms.scale.value = viewportHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  /** Émet des particules depuis un point, à un débit donné (particules par seconde). */
  emit(origin: Vector3, velocity: Vector3, rate: number, dt: number): void {
    this.carry += rate * dt;
    while (this.carry >= 1) {
      this.carry -= 1;
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const j = i * 3;
      const r = () => (Math.random() - 0.5) * 2;
      this.pos[j] = origin.x + r() * 0.1;
      this.pos[j + 1] = origin.y + r() * 0.1;
      this.pos[j + 2] = origin.z + r() * 0.1;
      // Les particules gardent une fraction de la vitesse de l'avion, puis dérivent.
      this.vel[j] = velocity.x * 0.25 + r() * 1.2;
      this.vel[j + 1] = velocity.y * 0.25 + r() * 1.2 + 0.4;
      this.vel[j + 2] = velocity.z * 0.25 + r() * 1.2;
      this.age[i] = 0;
      this.life[i] = 4 + Math.random() * 3;
    }
  }

  update(dt: number): void {
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= this.life[i]) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      const j = i * 3;
      const damp = Math.max(0, 1 - 1.5 * dt);
      this.vel[j] = this.vel[j] * damp + this.wind.x * (1 - damp);
      this.vel[j + 1] = this.vel[j + 1] * damp + (this.wind.y + 0.35) * (1 - damp);
      this.vel[j + 2] = this.vel[j + 2] * damp + this.wind.z * (1 - damp);
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      this.size[i] = 0.8 + 5 * t;
      this.alpha[i] = 0.5 * (1 - t) * Math.min(1, t * 8);
      alive++;
    }
    this.geometry.setDrawRange(0, this.max);
    (this.geometry.getAttribute("position") as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("aSize") as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("aAlpha") as BufferAttribute).needsUpdate = true;
    this.points.visible = alive > 0;
  }
}
