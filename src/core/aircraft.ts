import { Vector3, Quaternion } from "three";

/**
 * Repère avion (le même que Three.js) : +X à droite, +Y vers le haut, −Z vers l'avant.
 * Toutes les longueurs sont en mètres, les masses en kg, les angles des définitions en degrés.
 */

export interface Airfoil {
  /** CL à incidence nulle (profil 2D). */
  cl0: number;
  /** Pente de portance 2D, par radian. */
  clAlpha: number;
  /** Incidence de décrochage positive, radians. */
  alphaStallPos: number;
  /** Incidence de décrochage négative, radians (valeur négative). */
  alphaStallNeg: number;
  /** Traînée de profil. */
  cd0: number;
  /** Moment de tangage au foyer. */
  cmac: number;
}

export type ControlChannel = "roll" | "pitch" | "yaw";

export interface ControlLink {
  channel: ControlChannel;
  /** +1 : une commande positive braque le volet dans le sens qui augmente la portance selon la normale. */
  sign: number;
}

export interface SurfaceControl {
  links: ControlLink[];
  maxDeflectionDeg: number;
  /** Fraction de corde occupée par le volet, 0..1. */
  flapFraction: number;
}

/** Surface portante prête pour le calcul : un panneau plan. */
export interface Surface {
  name: string;
  /** Foyer aérodynamique (quart de corde) dans le repère avion. */
  pos: Vector3;
  /** Du bord d'attaque vers le bord de fuite, unitaire. */
  chordDir: Vector3;
  /** Normale, direction de la portance à incidence nulle, unitaire. */
  normal: Vector3;
  /** Direction de l'envergure, unitaire. */
  spanDir: Vector3;
  chord: number;
  span: number;
  area: number;
  /** Allongement de la voilure complète dont ce panneau fait partie. */
  aspectRatio: number;
  /** Coefficient d'Oswald. */
  efficiency: number;
  airfoil: Airfoil;
  control?: SurfaceControl;
  /** Fraction du souffle d'hélice reçue, 0..1. */
  wash: number;
}

export interface PanelSpec {
  name: string;
  kind: "wing" | "hstab" | "vstab";
  /** Point du quart de corde à l'emplanture du panneau. */
  root: [number, number, number];
  /** Envergure du panneau (pour une dérive : sa hauteur). Négative pour aller vers la gauche. */
  span: number;
  chord: number;
  dihedralDeg?: number;
  incidenceDeg?: number;
  airfoil: Airfoil;
  efficiency?: number;
  control?: SurfaceControl;
  wash?: number;
  /** Allongement de la voilure complète. Par défaut : envergure totale²/surface du panneau seul. */
  aspectRatio?: number;
  /** Couleur de rendu. */
  color?: number;
  colorBottom?: number;
  thickness?: number;
}

export type ContactKind = "wheel" | "skid" | "body" | "wingtip";

export interface ContactPoint {
  name: string;
  pos: [number, number, number];
  kind: ContactKind;
}

export interface PropSpec {
  pos: [number, number, number];
  diameter: number;
  /** Poussée statique maximale, newtons. */
  maxThrust: number;
  /** Vitesse à laquelle la poussée s'annule, m/s. */
  pitchSpeed: number;
}

export interface FuselageSpec {
  length: number;
  width: number;
  height: number;
  /** Décalage du centre du fuselage par rapport au CG. */
  center: [number, number, number];
  color: number;
  colorBottom: number;
}

export interface AircraftSpec {
  id: string;
  name: string;
  description: string;
  mass: number;
  /** Inerties principales [autour de X (tangage), Y (lacet), Z (roulis)], kg·m². */
  inertia: [number, number, number];
  panels: PanelSpec[];
  prop: PropSpec;
  contacts: ContactPoint[];
  fuselage: FuselageSpec;
  /** Vitesse de croisière conseillée, m/s. */
  cruiseSpeed: number;
  /** Traînée parasite du fuselage et des accessoires, m² (Cd·S). */
  bodyDragArea: number;
  /** Gains du mode assisté, adaptés à l'avion. */
  assist: { rollGain: number; rollDamping: number; pitchGain: number; pitchDamping: number; pitchTrimDeg: number };
}

export interface Aircraft {
  spec: AircraftSpec;
  surfaces: Surface[];
}

const DEG = Math.PI / 180;

export const CLARK_Y: Airfoil = {
  cl0: 0.4,
  clAlpha: 5.7,
  alphaStallPos: 13 * DEG,
  alphaStallNeg: -9 * DEG,
  cd0: 0.02,
  cmac: -0.05,
};

export const FLAT_SYMMETRIC: Airfoil = {
  cl0: 0,
  clAlpha: 5.5,
  alphaStallPos: 12 * DEG,
  alphaStallNeg: -12 * DEG,
  cd0: 0.015,
  cmac: 0,
};

/** Construit un panneau de calcul à partir de sa description géométrique. */
export function buildSurface(p: PanelSpec): Surface {
  const incidence = (p.incidenceDeg ?? 0) * DEG;
  const dihedral = (p.dihedralDeg ?? 0) * DEG;
  const toward = Math.sign(p.span) || 1;
  const spanLen = Math.abs(p.span);

  let chordDir: Vector3;
  let normal: Vector3;
  let spanDir: Vector3;

  if (p.kind === "vstab") {
    // Dérive : plan vertical, la normale pointe vers la droite.
    chordDir = new Vector3(0, 0, 1);
    normal = new Vector3(1, 0, 0);
    spanDir = new Vector3(0, 1, 0);
  } else {
    chordDir = new Vector3(0, 0, 1);
    normal = new Vector3(0, 1, 0);
    spanDir = new Vector3(toward, 0, 0);
    // Calage : rotation autour de X (bord d'attaque qui monte pour un calage positif).
    const qInc = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), incidence);
    chordDir.applyQuaternion(qInc);
    normal.applyQuaternion(qInc);
    // Dièdre : rotation autour de Z, le saumon monte.
    const qDih = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), dihedral * toward);
    chordDir.applyQuaternion(qDih);
    normal.applyQuaternion(qDih);
    spanDir.applyQuaternion(qDih);
  }

  const root = new Vector3(...p.root);
  const pos = root.clone().addScaledVector(spanDir, spanLen / 2);
  const area = spanLen * p.chord;
  const aspectRatio = p.aspectRatio ?? (p.kind === "vstab" ? (spanLen * spanLen) / area * 1.5 : (2 * spanLen) ** 2 / (2 * area));

  return {
    name: p.name,
    pos,
    chordDir: chordDir.normalize(),
    normal: normal.normalize(),
    spanDir: spanDir.normalize(),
    chord: p.chord,
    span: spanLen,
    area,
    aspectRatio,
    efficiency: p.efficiency ?? 0.85,
    airfoil: p.airfoil,
    control: p.control,
    wash: p.wash ?? 0,
  };
}

export function buildAircraft(spec: AircraftSpec): Aircraft {
  return { spec, surfaces: spec.panels.map(buildSurface) };
}

/* ------------------------------------------------------------------------- */
/* Les avions                                                                 */
/* ------------------------------------------------------------------------- */

const YELLOW = 0xffc83c;
const YELLOW_BOTTOM = 0xff8c1a;
const RED = 0xe53935;
const RED_BOTTOM = 0xff8c1a;
const WHITE = 0xf4f4f4;
const WHITE_BOTTOM = 0x9ec5e8;

function trainerPanels(opts: { ailerons: boolean; dihedralDeg: number; chord: number; halfSpan: number; wash: number }): PanelSpec[] {
  const { ailerons, dihedralDeg, chord, halfSpan, wash } = opts;
  const wingY = 0.09;
  const wingZ = -0.02;
  const inner = halfSpan * 0.5;
  const outer = halfSpan - inner;
  const fullAR = (2 * halfSpan) ** 2 / (2 * halfSpan * chord);
  const aileron: SurfaceControl | undefined = ailerons
    ? { links: [{ channel: "roll", sign: -1 }], maxDeflectionDeg: 22, flapFraction: 0.25 }
    : undefined;
  const aileronLeft: SurfaceControl | undefined = ailerons
    ? { links: [{ channel: "roll", sign: 1 }], maxDeflectionDeg: 22, flapFraction: 0.25 }
    : undefined;
  const rudderLinks: ControlLink[] = ailerons
    ? [{ channel: "yaw", sign: -1 }]
    : [{ channel: "yaw", sign: -1 }, { channel: "roll", sign: -1 }];

  const panels: PanelSpec[] = [
    {
      name: "aile droite int.", kind: "wing", root: [0.06, wingY, wingZ], span: inner, chord,
      dihedralDeg, incidenceDeg: 2, airfoil: CLARK_Y, wash, aspectRatio: fullAR, color: YELLOW, colorBottom: YELLOW_BOTTOM,
    },
    {
      name: "aile gauche int.", kind: "wing", root: [-0.06, wingY, wingZ], span: -inner, chord,
      dihedralDeg, incidenceDeg: 2, airfoil: CLARK_Y, wash, aspectRatio: fullAR, color: YELLOW, colorBottom: YELLOW_BOTTOM,
    },
    {
      name: "aile droite ext.", kind: "wing",
      root: [0.06 + inner * Math.cos(dihedralDeg * DEG), wingY + inner * Math.sin(dihedralDeg * DEG), wingZ],
      span: outer, chord, dihedralDeg, incidenceDeg: 1.5, airfoil: CLARK_Y, aspectRatio: fullAR,
      control: aileron, color: RED, colorBottom: RED_BOTTOM,
    },
    {
      name: "aile gauche ext.", kind: "wing",
      root: [-(0.06 + inner * Math.cos(dihedralDeg * DEG)), wingY + inner * Math.sin(dihedralDeg * DEG), wingZ],
      span: -outer, chord, dihedralDeg, incidenceDeg: 1.5, airfoil: CLARK_Y, aspectRatio: fullAR,
      control: aileronLeft, color: YELLOW, colorBottom: YELLOW_BOTTOM,
    },
    {
      name: "stab droit", kind: "hstab", root: [0.0, 0.02, 0.56], span: 0.23, chord: 0.14,
      incidenceDeg: -1, airfoil: FLAT_SYMMETRIC, wash: 0.5, aspectRatio: 3.3,
      control: { links: [{ channel: "pitch", sign: -1 }], maxDeflectionDeg: 25, flapFraction: 0.4 },
      color: RED, colorBottom: RED_BOTTOM,
    },
    {
      name: "stab gauche", kind: "hstab", root: [0.0, 0.02, 0.56], span: -0.23, chord: 0.14,
      incidenceDeg: -1, airfoil: FLAT_SYMMETRIC, wash: 0.5, aspectRatio: 3.3,
      control: { links: [{ channel: "pitch", sign: -1 }], maxDeflectionDeg: 25, flapFraction: 0.4 },
      color: RED, colorBottom: RED_BOTTOM,
    },
    {
      name: "dérive", kind: "vstab", root: [0, 0.02, 0.57], span: 0.2, chord: 0.15,
      airfoil: FLAT_SYMMETRIC, wash: 0.5, aspectRatio: 1.6,
      control: { links: rudderLinks, maxDeflectionDeg: 30, flapFraction: 0.45 },
      color: RED, colorBottom: RED,
    },
  ];
  return panels;
}

const trainerContacts: ContactPoint[] = [
  { name: "roue avant", pos: [0, -0.15, -0.3], kind: "wheel" },
  { name: "roue droite", pos: [0.13, -0.15, 0.06], kind: "wheel" },
  { name: "roue gauche", pos: [-0.13, -0.15, 0.06], kind: "wheel" },
  { name: "patin arrière", pos: [0, -0.04, 0.64], kind: "skid" },
  { name: "nez", pos: [0, 0, -0.48], kind: "body" },
  { name: "dos", pos: [0, 0.16, 0.0], kind: "body" },
  { name: "haut dérive", pos: [0, 0.24, 0.6], kind: "body" },
  { name: "saumon droit", pos: [0.66, 0.1, -0.02], kind: "wingtip" },
  { name: "saumon gauche", pos: [-0.66, 0.1, -0.02], kind: "wingtip" },
];

export const TRAINER_3CH: AircraftSpec = {
  id: "trainer3",
  name: "Débutant 3 voies",
  description: "Aile haute à grand dièdre, sans ailerons. Le manche de droite tourne avec la dérive, l'avion se redresse tout seul. Le plus facile.",
  mass: 0.7,
  inertia: [0.055, 0.085, 0.05],
  panels: trainerPanels({ ailerons: false, dihedralDeg: 7, chord: 0.24, halfSpan: 0.66, wash: 0.3 }),
  prop: { pos: [0, 0, -0.47], diameter: 0.23, maxThrust: 4.5, pitchSpeed: 20 },
  contacts: trainerContacts,
  fuselage: { length: 0.95, width: 0.09, height: 0.11, center: [0, 0.0, 0.06], color: WHITE, colorBottom: WHITE_BOTTOM },
  cruiseSpeed: 9,
  bodyDragArea: 0.012,
  assist: { rollGain: 2.2, rollDamping: 0.25, pitchGain: 1.6, pitchDamping: 0.22, pitchTrimDeg: 2 },
};

export const TRAINER_4CH: AircraftSpec = {
  id: "trainer4",
  name: "Trainer 4 voies",
  description: "Aile haute avec ailerons, dièdre modéré. Comme un vrai trainer de club : on tourne aux ailerons, la dérive aide au sol et en virage.",
  mass: 0.85,
  inertia: [0.06, 0.09, 0.05],
  panels: trainerPanels({ ailerons: true, dihedralDeg: 4, chord: 0.22, halfSpan: 0.66, wash: 0.3 }),
  prop: { pos: [0, 0, -0.47], diameter: 0.23, maxThrust: 6.5, pitchSpeed: 24 },
  contacts: trainerContacts,
  fuselage: { length: 0.95, width: 0.09, height: 0.11, center: [0, 0.0, 0.06], color: WHITE, colorBottom: WHITE_BOTTOM },
  cruiseSpeed: 11,
  bodyDragArea: 0.011,
  assist: { rollGain: 1.8, rollDamping: 0.2, pitchGain: 1.6, pitchDamping: 0.22, pitchTrimDeg: 2 },
};

export const AIRCRAFT_LIST: AircraftSpec[] = [TRAINER_3CH, TRAINER_4CH];

export function findAircraft(id: string): AircraftSpec {
  return AIRCRAFT_LIST.find((a) => a.id === id) ?? TRAINER_3CH;
}
