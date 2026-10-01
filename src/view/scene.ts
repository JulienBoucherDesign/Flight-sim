import {
  Color, DirectionalLight, Fog, HemisphereLight, Mesh, PerspectiveCamera, Scene, ShaderMaterial, SphereGeometry, Sprite, SpriteMaterial,
  CanvasTexture, WebGLRenderer, PCFSoftShadowMap, Vector3, BackSide, Group, SRGBColorSpace,
} from "three";

export interface SceneContext {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  sun: DirectionalLight;
  resize(): void;
}

function makeSky(): Mesh {
  const geo = new SphereGeometry(3000, 24, 12);
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new Color(0x3d7fd6) },
      horizon: { value: new Color(0xcfe6f7) },
    },
    vertexShader: `
      varying float vY;
      void main() {
        vY = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; varying float vY;
      void main() {
        float t = smoothstep(-0.05, 0.6, vY);
        gl_FragColor = vec4(mix(horizon, top, t), 1.0);
      }`,
  });
  const mesh = new Mesh(geo, mat);
  mesh.name = "ciel";
  return mesh;
}

function cloudTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 256, 128);
  const blobs = [[60, 80, 40], [110, 60, 50], [160, 75, 45], [200, 85, 32], [90, 95, 35], [140, 95, 38]];
  for (const [x, y, r] of blobs) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(0.7, "rgba(255,255,255,0.6)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function makeClouds(): Group {
  const group = new Group();
  const tex = cloudTexture();
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 18; i++) {
    const mat = new SpriteMaterial({ map: tex, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
    const s = new Sprite(mat);
    const angle = rand() * Math.PI * 2;
    const dist = 500 + rand() * 900;
    s.position.set(Math.cos(angle) * dist, 180 + rand() * 160, Math.sin(angle) * dist);
    const w = 180 + rand() * 220;
    s.scale.set(w, w * 0.5, 1);
    group.add(s);
  }
  return group;
}

export function createScene(canvas: HTMLCanvasElement): SceneContext {
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  scene.background = new Color(0xcfe6f7);
  scene.fog = new Fog(0xcfe6f7, 400, 2200);
  scene.add(makeSky());
  scene.add(makeClouds());

  const hemi = new HemisphereLight(0xbfdfff, 0x6f9a5a, 1.1);
  scene.add(hemi);

  const sun = new DirectionalLight(0xfff4d6, 2.2);
  sun.position.set(80, 140, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 500;
  sun.shadow.camera.left = -90;
  sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90;
  sun.shadow.camera.bottom = -90;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  // Lumière d'appoint venant du bas : l'avion vu du sol reste lisible contre le ciel.
  const fill = new DirectionalLight(0xdfeaff, 0.9);
  fill.position.set(-30, -50, 40);
  scene.add(fill);

  const camera = new PerspectiveCamera(50, 1, 0.1, 4000);
  camera.position.set(0, 1.7, 10);

  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  resize();

  return { renderer, scene, camera, sun, resize };
}

const sunOffset = new Vector3(80, 140, 60);
/** Fait suivre la zone d'ombre à l'avion pour garder une ombre nette. */
export function followShadow(ctx: SceneContext, target: Vector3): void {
  ctx.sun.position.copy(target).add(sunOffset);
  ctx.sun.target.position.copy(target);
  ctx.sun.target.updateMatrixWorld();
}
