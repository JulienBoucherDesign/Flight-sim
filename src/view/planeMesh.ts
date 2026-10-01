import { BoxGeometry, CylinderGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Vector3, DoubleSide, type Material } from "three";
import type { AircraftSpec, PanelSpec } from "../core/aircraft";
import { buildSurface } from "../core/aircraft";
import { surfaceDeflection, type ControlVector } from "../core/aero";

export interface PlaneModel {
  group: Group;
  /** Met à jour les gouvernes et l'hélice. */
  update(controls: ControlVector, throttle: number, dt: number): void;
  dispose(): void;
}

function sixSided(top: number, bottom: number, side: number): Material[] {
  const mk = (c: number) => new MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.05 });
  // Ordre BoxGeometry : +x, −x, +y, −y, +z, −z
  return [mk(side), mk(side), mk(top), mk(bottom), mk(side), mk(side)];
}

interface Hinge {
  group: Group;
  panel: PanelSpec;
  axis: Vector3;
}

export function createPlaneModel(spec: AircraftSpec): PlaneModel {
  const root = new Group();
  root.name = spec.name;
  const materials: Material[] = [];
  const hinges: Hinge[] = [];
  const surfacesForPanels = spec.panels.map((p) => ({ panel: p, surface: buildSurface(p) }));

  // Fuselage : caisson principal, nez, verrière, poutre.
  const f = spec.fuselage;
  const bodyMats = sixSided(f.color, f.colorBottom, f.color);
  materials.push(...bodyMats);
  const body = new Mesh(new BoxGeometry(f.width, f.height, f.length * 0.55), bodyMats);
  body.position.set(f.center[0], f.center[1], f.center[2] - f.length * 0.12);
  body.castShadow = true;
  root.add(body);

  const noseMats = sixSided(f.color, f.colorBottom, 0xd8d8d8);
  materials.push(...noseMats);
  const nose = new Mesh(new BoxGeometry(f.width * 0.9, f.height * 0.85, f.length * 0.2), noseMats);
  nose.position.set(0, -0.005, -f.length * 0.47 + 0.02);
  nose.castShadow = true;
  root.add(nose);

  const canopyMat = new MeshStandardMaterial({ color: 0x2b5c8a, roughness: 0.2, metalness: 0.3 });
  materials.push(canopyMat);
  const canopy = new Mesh(new BoxGeometry(f.width * 0.8, f.height * 0.5, f.length * 0.22), canopyMat);
  canopy.position.set(0, f.height * 0.55, -f.length * 0.2);
  canopy.castShadow = true;
  root.add(canopy);

  const boomMats = sixSided(f.color, f.colorBottom, f.color);
  materials.push(...boomMats);
  const boom = new Mesh(new BoxGeometry(f.width * 0.55, f.height * 0.5, f.length * 0.5), boomMats);
  boom.position.set(0, 0.0, f.length * 0.35);
  boom.castShadow = true;
  root.add(boom);

  // Panneaux portants.
  for (const { panel, surface } of surfacesForPanels) {
    const thickness = panel.thickness ?? (panel.kind === "wing" ? 0.022 : 0.012);
    const basis = new Matrix4().makeBasis(surface.spanDir, surface.normal, surface.chordDir);
    const ff = panel.control?.flapFraction ?? 0;
    const fixedChord = panel.chord * (1 - ff);
    const flapChord = panel.chord * ff;
    const color = panel.color ?? 0xffc83c;
    const colorBottom = panel.colorBottom ?? 0x2b2b2b;

    // Partie fixe : du bord d'attaque (−0.25c depuis le foyer) jusqu'à la charnière.
    const panelGroup = new Group();
    panelGroup.position.copy(surface.pos);
    panelGroup.quaternion.setFromRotationMatrix(basis);
    root.add(panelGroup);

    const fixedMats = panel.kind === "vstab" ? sixSided(color, color, color) : sixSided(color, colorBottom, color);
    materials.push(...fixedMats);
    const fixed = new Mesh(new BoxGeometry(surface.span, thickness, fixedChord), fixedMats);
    fixed.position.set(0, 0, -0.25 * panel.chord + fixedChord / 2);
    fixed.castShadow = true;
    panelGroup.add(fixed);

    if (panel.control && flapChord > 0) {
      const hinge = new Group();
      hinge.position.set(0, 0, -0.25 * panel.chord + fixedChord);
      panelGroup.add(hinge);
      const flapMats = panel.kind === "vstab" ? sixSided(0xffffff, 0xffffff, 0xffffff) : sixSided(0xffffff, 0xbdbdbd, 0xffffff);
      materials.push(...flapMats);
      const flap = new Mesh(new BoxGeometry(surface.span * 0.96, thickness * 0.8, flapChord), flapMats);
      flap.position.set(0, 0, flapChord / 2);
      flap.castShadow = true;
      hinge.add(flap);
      hinges.push({ group: hinge, panel, axis: new Vector3(1, 0, 0) });
    }
  }

  // Train d'atterrissage.
  const wheelMat = new MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
  const legMat = new MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5, metalness: 0.4 });
  materials.push(wheelMat, legMat);
  for (const c of spec.contacts) {
    if (c.kind !== "wheel") continue;
    const wheel = new Mesh(new CylinderGeometry(0.028, 0.028, 0.016, 12), wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(c.pos[0], c.pos[1] + 0.028, c.pos[2]);
    wheel.castShadow = true;
    root.add(wheel);
    const legH = Math.abs(c.pos[1]) - 0.03;
    const leg = new Mesh(new CylinderGeometry(0.005, 0.005, legH, 6), legMat);
    leg.position.set(c.pos[0] * 0.9, c.pos[1] + 0.028 + legH / 2, c.pos[2]);
    root.add(leg);
  }

  // Hélice : disque translucide quand elle tourne, deux pales au repos.
  const propGroup = new Group();
  propGroup.position.set(...spec.prop.pos);
  root.add(propGroup);
  const spinner = new Mesh(new CylinderGeometry(0.012, 0.025, 0.04, 10), legMat);
  spinner.rotation.x = Math.PI / 2;
  propGroup.add(spinner);
  const bladeMat = new MeshStandardMaterial({ color: 0x333333, roughness: 0.6 });
  materials.push(bladeMat);
  const blades = new Group();
  for (const a of [0, Math.PI]) {
    const blade = new Mesh(new BoxGeometry(0.02, spec.prop.diameter / 2, 0.006), bladeMat);
    blade.position.set(Math.sin(a) * spec.prop.diameter / 4, Math.cos(a) * spec.prop.diameter / 4, 0);
    blade.rotation.z = -a;
    blades.add(blade);
  }
  propGroup.add(blades);
  const discMat = new MeshStandardMaterial({ color: 0x555555, transparent: true, opacity: 0.0, side: DoubleSide, depthWrite: false });
  materials.push(discMat);
  const disc = new Mesh(new CylinderGeometry(spec.prop.diameter / 2, spec.prop.diameter / 2, 0.004, 24), discMat);
  disc.rotation.x = Math.PI / 2;
  propGroup.add(disc);

  let bladeAngle = 0;
  const update = (controls: ControlVector, throttle: number, dt: number) => {
    for (const h of hinges) {
      const surface = surfacesForPanels.find((s) => s.panel === h.panel)!.surface;
      const d = surfaceDeflection(surface, controls);
      h.group.rotation.x = d;
    }
    bladeAngle += (4 + throttle * 60) * dt;
    blades.rotation.z = bladeAngle;
    discMat.opacity = Math.min(0.35, throttle * 0.6);
    blades.visible = throttle < 0.15;
  };

  const dispose = () => {
    root.traverse((o) => { if (o instanceof Mesh) o.geometry.dispose(); });
    for (const m of materials) m.dispose();
  };

  return { group: root, update, dispose };
}
