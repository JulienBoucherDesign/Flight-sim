# Références : mécanique de vol dans les simulateurs open source

Complément de `references-sim-rc.md`, centré sur la façon dont chaque projet calcule
les forces et moments aérodynamiques. Relevé fait le 1er octobre 2026, code inspecté
localement pour CRRCsim, PicaSim, RCForge, RC Flight Lab et rcsim.

## Les trois familles de modèles

| Famille | Principe | Données nécessaires | Forces | Faiblesses |
| --- | --- | --- | --- | --- |
| **A. Coefficients globaux** (dérivées de stabilité) | Un seul jeu de coefficients pour tout l'avion : CL0, CLα, CLq, CLδe, CD0, CDi, CYβ, Clp, Cmα, Cmq, Cnr, etc. Forces = ½ρV²S × coefficient. | Une trentaine de coefficients, calculés avec AVL ou XFLR5, ou repris d'un avion existant | Très court (300 à 500 lignes), rapide, bien documenté dans les manuels | Linéaire autour du vol normal ; décrochage et vrille approximés ; pas de souffle d'hélice |
| **B. Par surfaces** (component-based, strip theory) | Chaque aile, stabilisateur, dérive, fuselage est découpé en panneaux. Chaque panneau a sa vitesse locale, son incidence, sa portance et sa traînée. La somme donne forces et moments. | Géométrie de l'avion, un profil par surface (pente de portance, angle de décrochage, CD) | Dièdre, polyèdre, virage à la dérive, décrochage de bout d'aile, souffle d'hélice, toute l'enveloppe de vol émergent naturellement | Un peu plus de code (500 à 1500 lignes), réglage empirique des profils |
| **C. Tables complètes** (haute fidélité) | Coefficients en tables multidimensionnelles de α, β, Mach, braquages, construits par « build-up ». | Données de soufflerie ou CFD | Référence académique, validée | Lourd, données rarement disponibles pour un avion RC |

Pour un simulateur RC d'apprentissage, la famille B est le meilleur compromis.
Elle est utilisée par PicaSim, FS One, Aircraft-Physics, YASim, RCForge et par
X-Plane (fermé). La famille A suffit pour un trainer docile et reste la plus simple
à écrire.

## Famille A : coefficients globaux

### LaRCsim (NASA, Bruce Jackson, années 1990)

- Domaine public. Ancêtre commun de CRRCsim et des premiers FDM de FlightGear.
- Équations du mouvement 6 degrés de liberté, modèle terre ronde, références NASA CR-2497.

### CRRCsim, modules `fdm_larcsim` et `fdm_002`

- Fork maintenu : [paparazzi/crrcsim-pprz](https://github.com/paparazzi/crrcsim-pprz), GPLv2, dernière activité avril 2026.
- `fdm_002` est une réécriture simplifiée de LaRCsim en terre plate : « on n'a pas besoin de plus pour un avion modèle ». Les deux modules font 1 640 lignes de C++ au total.
- Format d'avion XML très lisible, exemple `models/allegro.xml` (planeur de Mark Drela) :

```xml
<aero version="1" units="0">
  <ref chord="0.551667" span="6.55" area="3.61111" speed="19.685" />
  <misc Alpha_0="0.0349066" eta_loc="0.15" CG_arm="0.25" span_eff="0.95" />
  <lift CL_0="0.563172" CL_max="1.1" CL_min="-0.6" CL_a="5.5036" CL_q="7.50999"
        CL_de="0.162" CL_drop="0.5" CL_CD0="0" />
  <drag CD_prof="0.02" Uexp_CD="-0.5" CD_stall="0" CD_CLsq="0.01" CD_AIsq="0" CD_ELsq="0" />
  <Y CY_b="-0.41561"   CY_p="-0.42382"   CY_r= "0.29754"   CY_dr="0" CY_da="-0.13589" />
  <l Cl_b="-0.250926"  Cl_p="-0.611798"  Cl_r= "0.139581"  Cl_dr="0" Cl_da="-0.00307921" />
  <m Cm_0="-0.0112663" Cm_a="-0.575335" Cm_q="-11.4975" Cm_de="-0.597537" />
  <n Cn_b= "0.0567069" Cn_p="-0.0740898" Cn_r="-0.0687755" Cn_dr="0" Cn_da= "0.0527143" />
</aero>
```

- Les coefficients viennent d'AVL. Décrochage géré par CL_max, CL_min, CL_drop et CD_stall.
- Une vingtaine d'avions RC livrés (Allegro, Apogee, Gap65, FunJet, biplan, hélico, quad).

### ArduPilot SITL, `libraries/SITL/SIM_Plane.cpp`

- GPLv3, environ 400 lignes, lisible en une heure. Conçu pour des avions taille RC.
- Une quarantaine de coefficients (`c_lift_0`, `c_lift_a`, `c_drag_p`, `alpha_stall`, `oswald`, `c_m_a`, `c_m_q`, `c_m_deltae`, `c_n_b`, `c_l_deltaa`, surface `s`, envergure `b`, corde `c`, débattements max, décalage de centrage).
- Décrochage par sigmoïde : transition continue entre la pente linéaire et le comportement de plaque plane. Traînée parasite + induite.
- Lien : [SIM_Plane.cpp](https://github.com/ArduPilot/ardupilot/blob/master/libraries/SITL/SIM_Plane.cpp).

### Beard et McLain, *Small Unmanned Aircraft: Theory and Practice*

- Le manuel de référence pour la mécanique de vol des petits avions. Chapitre 4 : forces et moments, même sigmoïde de décrochage que SIM_Plane, modèle hélice simple.
- Code compagnon [mavsim_public](https://github.com/randybeard/mavsim_public), GPLv3, Python, MATLAB et Simulink. Coefficients Aerosonde et Zagi.

### PyFly

- [eivindeb/pyfly](https://github.com/eivindeb/pyfly), MIT, Python. Modèle 6 DDL avec extensions non linéaires en α et β, coefficients mesurés en soufflerie pour le Skywalker X8, turbulence de Dryden. Stable, peu maintenu depuis 2020.

### Gazebo LiftDragPlugin (PX4, ArduPilot)

- Apache 2. Un plugin par surface portante, mais avec un modèle minimal : alpha0, pente, décrochage, forces nulles au delà de 90°. Limites connues documentées dans les issues du projet.
- Un « Advanced Lift-Drag plugin » quasi stationnaire reprend les dérivées d'AVL avec post-décrochage. Lien : [PX4-SITL_gazebo-classic](https://github.com/PX4/PX4-SITL_gazebo-classic/blob/main/include/liftdrag_plugin/liftdrag_plugin.h).

## Famille B : par surfaces

### PicaSim (Danny Chapman)

- [Rowlhouse/PicaSim](https://github.com/Rowlhouse/PicaSim), licence PolyForm Noncommercial. Le code n'est pas réutilisable dans un projet libre, mais c'est la référence la plus complète pour un simulateur RC.
- Fichiers clés : `AerofoilDefinition.cpp` (914 lignes, la physique du profil), `AeroplanePhysics.cpp` (1 537 lignes), `Wing.cpp`, `Aerofoil.cpp`. Carcasse et contacts sol confiés à Bullet.
- Chaque `<Wing>` du XML est découpée en `numSections` panneaux. Chaque panneau reçoit un profil XML, exemple `ClarkY.xml` :

```xml
<Aerofoil name="ClarkY"
  CDFlying="0.01" CDStalled="1.7" CM0="-0.095" CMPerDeg="0.005"
  refRe="200000" CDPower="-0.15" minReFrac="0.1"
  CL0="0.44" CLPerDeg="0.10"
  positiveAttachedAngle="8.5" positiveStallRange="8.0"
  negativeAttachedAngle="-5.5" negativeStallRange="-8"
  dragBucketFactor="0.0" dragBucketLowerAngle="-1.0" dragBucketUpperAngle="6.0" />
```

- Ce que le modèle inclut : portance linéaire jusqu'à l'angle d'attache, transition progressive vers le régime décroché, post-décrochage en plaque plane avec sin(2α), efficacité des gouvernes réduite à 30 % en décrochage, traînée corrigée par le nombre de Reynolds (CD ∝ Re^pow), effet de sol, souffle d'hélice sur les surfaces (`washFromEngineName`), déflexion induite d'une aile sur une autre (`washFromWingName`), jeu des gouvernes, différentiel et expo par voie.
- Des dizaines de profils fournis : ClarkY, RG14, RG15, MH42, AG13, AG455ct, SA7036, NACA0009, etc.

### FS One et SeligSIM (Michael Selig, UIUC)

- Fermé, mais la méthode est publiée : [AIAA 2010-7635, « Modeling Full-Envelope Aerodynamics of Small UAVs in Realtime »](https://m-selig.ae.illinois.edu/publications.html) et [JoA 2014, « Real-Time Flight Simulation of Highly Maneuverable UAVs »](https://arc.aiaa.org/doi/10.2514/1.C032370).
- Approche par composants valable sur ±180° en α et β, souffle d'hélice, grandes déflexions. C'est ce qui permet la voltige 3D (torque roll, harrier) dans les simulateurs RC commerciaux.
- L'ancien modèle UIUC de FlightGear, dérivé de LaRCsim, a été retiré des versions récentes.

### Aircraft-Physics (Unity, Ivan Pensionerov)

- [gasgiant/Aircraft-Physics](https://github.com/gasgiant/Aircraft-Physics), MIT, 681 étoiles. Implémente Khan et Nahon 2015, « Real-time modeling of agile fixed-wing UAV aerodynamics ».
- Chaque `AeroSurface` a : pente de portance, frottement de peau, α de portance nulle, angles de décrochage haut et bas, corde, envergure, allongement, fraction de volet. Forces totales = somme des surfaces.
- Court et facile à porter en TypeScript. L'auteur signale une traînée environ 1,5 fois trop forte, à compenser par la poussée.

### YASim (FlightGear)

- GPLv2, C++, dans `src/FDM/YASim` de [FlightGear](https://github.com/FlightGear/flightgear/tree/next/src/FDM/YASim) : `Wing.cpp`, `Surface.cpp`, `Airplane.cpp`, `RigidBody.cpp`, `Integrator.cpp`, `Propeller.cpp`, `Turbulence.cpp`.
- Particularité : un solveur déduit les coefficients à partir de la géométrie et de deux points de vol (approche et croisière). Pas besoin de données de soufflerie.
- Décrochage grossier, pas de post-décrochage, fortement couplé à FlightGear.

### RCForge

- MIT, TypeScript. `src/core/aerodynamics.ts` (76 lignes) et `src/core/simulation.ts` (471 lignes). Quasi stationnaire par élément : l'aile polyèdre du Simple Trainer est découpée en quatre éléments pour résoudre le dérapage, pente de portance finie 2π/(1+2π/(πeAR)), décrochage à 14°, CD0 et Cm par surface. Pas de souffle d'hélice, pas de P-factor.

### RC Flight Lab (Godot)

- `src/aircraft/fixed_wing.gd` (417 lignes). Aile unique lumpée, portance et traînée en ½ρV², décrochage lissé, autorité des gouvernes proportionnelle à la pression dynamique. Mode avancé via JSBSim natif.

## Famille C : tables complètes

### JSBSim

- [JSBSim-Team/jsbsim](https://github.com/JSBSim-Team/jsbsim), LGPL 2.1, C++. Bindings Python (`pip install jsbsim`), MATLAB, Julia, Unreal. Utilisé par FlightGear, ArduPilot, PX4, Paparazzi ; plus de 1 000 citations.
- Avion en XML : masses, aérodynamique en fonctions et tables, propulsion, trains, commandes de vol. Coefficients construits par sommation de termes.
- `utils/aeromatic++` génère un modèle plausible à partir de quelques dimensions et du type d'avion.
- Modèle RC prêt à l'emploi : SIG Rascal 110 (FlightGear, ArduPilot, RC Flight Lab). C'est la « vérité terrain » utilisée par RCForge et RC Flight Lab pour vérifier leur physique.
- Navigateur : [JSBSim.js](https://github.com/csbrandt/JSBSim.js), ancien port emscripten, et [PR #1507](https://github.com/JSBSim-Team/jsbsim/pull/1507) ouverte en septembre 2026 pour un paquet `@jsbsim/wasm` TypeScript officiel.

### FlightGear

- GPL. Héberge JSBSim, YASim et des FDM externes. Trop gros pour notre usage, mais source de modèles et d'assets GPL.

### mscsim (Marek Cel)

- FDM maison alimenté par des données CFD (OpenFOAM, OpenVSP). Avions grandeur. Peu pertinent pour le RC.

### Fermés, pour situer

- X-Plane : blade element theory, famille B poussée.
- RealFlight, Phoenix, aerofly RC, neXt, Heli-X : fermés, pas de documentation du modèle.

## Outils pour obtenir des coefficients ou des profils

- [AVL](https://web.mit.edu/drela/Public/web/avl/) (Mark Drela, GPL) : vortex lattice, fournit les dérivées de la famille A. C'est la source des coefficients CRRCsim.
- [XFLR5](https://www.xflr5.tech/) (GPL) : XFoil + vortex lattice avec interface graphique, adapté aux bas Reynolds du RC.
- [XFoil](https://web.mit.edu/drela/Public/web/xfoil/) (GPL) : polaires de profils.
- [Base de profils UIUC](https://m-selig.ae.illinois.edu/ads/coord_database.html) : coordonnées de milliers de profils.
- [OpenVSP](https://openvsp.org/) (NASA, open source) : géométrie et VSPAero.
- [AeroSandbox](https://github.com/peterdsharpe/AeroSandbox) (MIT, Python) : analyse et optimisation.
- Aeromatic++ (JSBSim) : modèle complet depuis quelques dimensions.

## Ce que cela implique pour notre projet

1. **Modèle par surfaces, version courte.** Reprendre la structure d'Aircraft-Physics (MIT) :
   une liste de surfaces, chacune avec position, orientation, corde, envergure, profil
   et éventuellement une gouverne. Environ 300 lignes de TypeScript. Le dièdre, le
   virage à la dérive du trainer 3 voies et le décrochage sortent tout seuls.
2. **Profils façon PicaSim.** Reprendre l'idée du format, pas le code : CL0, pente,
   angle d'attache, plage de décrochage, CD en vol, CD décroché, plaque plane en sin(2α).
3. **Souffle d'hélice simple.** Ajouter la vitesse de l'hélice sur les surfaces situées
   derrière, comme `washFromEngine` de PicaSim. C'est ce qui rend l'avion contrôlable à
   basse vitesse et évite les décrochages frustrants pour un enfant.
4. **Intégration.** Pas de temps fixe de 2 à 5 ms, Euler semi-implicite, orientation en
   quaternion. Pas de moteur physique externe nécessaire pour l'avion ; un simple
   contact sol avec amortissement suffit.
5. **Validation optionnelle.** Comparer vitesse de décrochage, taux de roulis et finesse
   avec le Rascal 110 sous JSBSim via Python.
6. **Licences.** Copier du code : seulement MIT (Aircraft-Physics, RCForge, PyFly).
   S'inspirer des formules : CRRCsim, SIM_Plane, mavsim sont GPL et PicaSim est non
   commercial, donc lecture et idées uniquement.
