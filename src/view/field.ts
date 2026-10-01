import {
  BoxGeometry, CanvasTexture, ConeGeometry, CylinderGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial, MeshStandardMaterial,
  PlaneGeometry, RepeatWrapping, SRGBColorSpace, SphereGeometry, Vector3, Object3D, Quaternion, TorusGeometry,
} from "three";

export const RUNWAY_LENGTH = 120;
export const RUNWAY_WIDTH = 14;
/** Le pilote est debout à côté de la piste. */
export const PILOT_POSITION = new Vector3(-13, 1.7, 22);
/** Point de départ au sol, au bout de la piste, face à −Z. */
export const GROUND_START = new Vector3(0, 0, 40);
export const AIR_START = new Vector3(0, 40, 45);

function grassTexture(): CanvasTexture {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#5f9a3c";
  ctx.fillRect(0, 0, size, size);
  // Bandes de tonte.
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
    ctx.fillRect(i * (size / 8), 0, size / 8, size);
  }
  // Grain.
  let seed = 3;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 9000; i++) {
    const g = 120 + Math.floor(rand() * 60);
    ctx.fillStyle = `rgba(${g * 0.55},${g},${g * 0.35},0.35)`;
    ctx.fillRect(rand() * size, rand() * size, 2 + rand() * 3, 2 + rand() * 3);
  }
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(300, 300);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function runwayTexture(): CanvasTexture {
  const w = 1024, h = 128;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#4b4f55";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#e8e8e8";
  // Ligne centrale en tirets.
  for (let x = 40; x < w - 40; x += 80) ctx.fillRect(x, h / 2 - 3, 40, 6);
  // Seuils.
  for (let i = 0; i < 6; i++) {
    ctx.fillRect(6, 12 + i * 18, 28, 10);
    ctx.fillRect(w - 34, 12 + i * 18, 28, 10);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function createField(): Group {
  const group = new Group();
  group.name = "terrain";

  const ground = new Mesh(new PlaneGeometry(6000, 6000), new MeshLambertMaterial({ map: grassTexture() }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Longueur le long de Z : la texture est dessinée dans la longueur.
  const runway = new Mesh(new PlaneGeometry(RUNWAY_LENGTH, RUNWAY_WIDTH), new MeshLambertMaterial({ map: runwayTexture() }));
  runway.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
  runway.position.y = 0.02;
  runway.receiveShadow = true;
  group.add(runway);

  // Arbres en lisière.
  const trunkGeo = new CylinderGeometry(0.25, 0.4, 2.2, 6);
  const crownGeo = new ConeGeometry(2.6, 7, 8);
  const trunkMat = new MeshLambertMaterial({ color: 0x6b4a2b });
  const crownMat = new MeshLambertMaterial({ color: 0x2f6b2a });
  const count = 220;
  const trunks = new InstancedMesh(trunkGeo, trunkMat, count);
  const crowns = new InstancedMesh(crownGeo, crownMat, count);
  let seed = 11;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const m = new Matrix4();
  const dummy = new Object3D();
  for (let i = 0; i < count; i++) {
    let x = 0, z = 0;
    // Pas d'arbre dans la clairière de vol.
    for (let tries = 0; tries < 20; tries++) {
      const a = rand() * Math.PI * 2;
      const d = 170 + rand() * 450;
      x = Math.cos(a) * d; z = Math.sin(a) * d;
      if (Math.abs(x) > 60 || Math.abs(z) > 120) break;
    }
    const s = 0.7 + rand() * 0.9;
    dummy.position.set(x, 1.1 * s, z);
    dummy.scale.set(s, s, s);
    dummy.rotation.set(0, rand() * Math.PI, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.y = (2.2 + 3.5) * s;
    dummy.updateMatrix();
    m.copy(dummy.matrix);
    crowns.setMatrixAt(i, m);
  }
  trunks.castShadow = true;
  crowns.castShadow = true;
  group.add(trunks, crowns);

  // Buissons près de la piste, repères d'échelle.
  const bushGeo = new SphereGeometry(1.1, 8, 6);
  const bushMat = new MeshLambertMaterial({ color: 0x3f8a33 });
  for (let i = 0; i < 30; i++) {
    const b = new Mesh(bushGeo, bushMat);
    const side = i % 2 ? 1 : -1;
    b.position.set(side * (14 + rand() * 30), 0.6, -90 + rand() * 180);
    b.scale.set(1 + rand(), 0.7 + rand() * 0.5, 1 + rand());
    b.castShadow = true;
    group.add(b);
  }

  // Un hangar et une table de pilote.
  const hangar = new Mesh(new BoxGeometry(14, 5, 9), new MeshStandardMaterial({ color: 0xc9c4b4, roughness: 0.9 }));
  hangar.position.set(-34, 2.5, 30);
  hangar.castShadow = true; hangar.receiveShadow = true;
  group.add(hangar);
  const roof = new Mesh(new ConeGeometry(10, 3, 4), new MeshStandardMaterial({ color: 0x8c3b2b, roughness: 0.9 }));
  roof.rotation.y = Math.PI / 4;
  roof.position.set(-34, 6.5, 30);
  roof.castShadow = true;
  group.add(roof);

  const table = new Mesh(new BoxGeometry(1.4, 0.8, 0.6), new MeshStandardMaterial({ color: 0x9c7a4a }));
  table.position.set(PILOT_POSITION.x - 1.5, 0.4, PILOT_POSITION.z);
  table.castShadow = true;
  group.add(table);

  // Manche à air.
  const mast = new Mesh(new CylinderGeometry(0.05, 0.07, 6, 6), new MeshStandardMaterial({ color: 0xdddddd }));
  mast.position.set(-20, 3, -40);
  group.add(mast);
  const sock = new Mesh(new ConeGeometry(0.4, 2.2, 8), new MeshStandardMaterial({ color: 0xff7a1a }));
  sock.rotation.z = Math.PI / 2;
  sock.position.set(-21, 5.8, -40);
  group.add(sock);

  // Cônes de balisage de la piste.
  const coneGeo = new ConeGeometry(0.3, 0.7, 8);
  const coneMat = new MeshLambertMaterial({ color: 0xff6a00 });
  for (let z = -RUNWAY_LENGTH / 2; z <= RUNWAY_LENGTH / 2; z += 20) {
    for (const x of [-RUNWAY_WIDTH / 2 - 1, RUNWAY_WIDTH / 2 + 1]) {
      const cone = new Mesh(coneGeo, coneMat);
      cone.position.set(x, 0.35, z);
      cone.castShadow = true;
      group.add(cone);
    }
  }

  return group;
}

export interface Ring {
  mesh: Mesh;
  center: Vector3;
  normal: Vector3;
  radius: number;
}

/** Un parcours d'anneaux en boucle devant le pilote. */
export function createRings(): Ring[] {
  const rings: Ring[] = [];
  const n = 8;
  const cx = 0, cz = -140, rx = 120, rz = 80;
  const radius = 7;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const center = new Vector3(cx + Math.cos(t) * rx, 28 + 8 * Math.sin(t * 2), cz + Math.sin(t) * rz);
    // Tangente à l'ellipse : sens de parcours.
    const tangent = new Vector3(-Math.sin(t) * rx, 0, Math.cos(t) * rz).normalize();
    const mesh = new Mesh(
      new TorusGeometry(radius, 0.45, 10, 40),
      new MeshStandardMaterial({ color: 0xffffff, emissive: 0x000000, roughness: 0.5, metalness: 0.1, transparent: true, opacity: 0.85 }),
    );
    mesh.position.copy(center);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), tangent);
    mesh.quaternion.copy(q);
    mesh.castShadow = true;
    rings.push({ mesh, center, normal: tangent, radius });
  }
  return rings;
}
