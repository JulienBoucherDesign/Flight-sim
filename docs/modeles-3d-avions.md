# Modèles 3D d'avions RC utilisables en temps réel, avec leurs données de vol

Relevé fait le 1er octobre 2026. Toutes les sources ci-dessous ont été clonées et
inspectées : formats, nombre de faces, licence, et présence ou non de données de vol.
Cible : un simulateur navigateur Three.js, donc des meshs de quelques centaines à
quelques milliers de faces, chargés en OBJ, glTF ou Collada.

## Vue d'ensemble

| Source | Licence | Format | Faces | Données de vol fournies | Verdict |
| --- | --- | --- | --- | --- | --- |
| **CRRCsim** (`objects/*.ac` + `models/*.xml`) | GPLv2 | AC3D | 93 à 5 000 | Oui : masse, inerties, dérivées complètes calculées avec AVL | **Meilleur rapport mesh + physique**, 20 avions |
| **Rascal 110** (FlightGear, ArduPilot, RC Flight Lab) | GPLv2+ / GPLv3 | AC3D, OBJ + PNG déjà convertis | 2 800 avec gouvernes séparées | Oui : JSBSim complet et YASim | Le trainer de référence, validé par ArduPilot |
| **RCForge** (`aircraft/*.json`) | MIT | Géométrie procédurale, pas de mesh | Généré | Oui : masse, CG, profils, servos, moteur | Trainers 3 voies parfaits pour débuter, zéro asset externe |
| **PX4 Gazebo** (`models/plane`, `believer`, `techpod`) | BSD-3 (dépôt) | Collada | 10 000 à 18 000 corps + gouvernes | Partielles : pente de portance, décrochage, surface par élément | Visuel correct, physique à reconstruire |
| **ArduPilot Gazebo** (`models/zephyr`) | LGPLv3 | Collada | 250 | Partielles, même plugin | Aile delta ultra légère, bon second avion |
| **PicaSim** (`data/SystemData/Aeroplanes`) | XML : PolyForm NC ; meshs : permission de l'auteur requise | AC3D, 3DS | 600 à 5 600 | Oui : modèle par surfaces très complet | Données réutilisables pour un projet familial, meshs non |
| **itch.io, Poly Pizza, Sketchfab** | CC0 ou CC-BY selon pièce | glTF, FBX | 500 à 3 000 | Non | Visuel seulement, à marier avec nos propres données |

## 1. CRRCsim : mesh et coefficients dans la même boîte

Dépôt : [paparazzi/crrcsim-pprz](https://github.com/paparazzi/crrcsim-pprz) (GPLv2).
Chaque avion a un mesh AC3D dans `objects/` et un XML dans `models/` avec
`<mass_inertia>` et un bloc `<aero>` complet (voir `references-mecanique-de-vol.md`).

Attention aux unités : `units="0"` signifie pieds et slugs, `units="1"` signifie SI.
Les meshs sont tous en pieds, axe X le long de l'envergure. Multiplier par 0,3048.

| Modèle | Type | Envergure | Masse | Faces | Unités XML |
| --- | --- | --- | --- | --- | --- |
| `FlexiflyXLM` | Park flyer mousse, moteur Speed 400 | 1,00 m | 0,43 kg | 267 | SI |
| `sport` | Avion sport à moteur | 1,22 m | 1,36 kg | 799 | impérial |
| `allegro` | Planeur de Mark Drela | 2,00 m | 0,66 kg | 176 | impérial |
| `sovereign` | Planeur | 2,00 m | 0,66 kg | 134 | impérial |
| `zipper` | Planeur | 2,00 m | 0,66 kg | 93 | impérial |
| `superzagi` (mesh `zagi.ac`) | Aile volante | 1,22 m | 0,54 kg | 151 | impérial |
| `zagi-xs` | Aile volante | 1,22 m | 0,69 kg | 96 | impérial |
| `apogee` | Planeur lancé main | 0,91 m | 0,10 kg | 366 | impérial |
| `outrage` | Planeur | 3,00 m | 1,67 kg | 152 | impérial |
| `k2` | Planeur F3F | 3,17 m | 2,38 kg | 328 | impérial |
| `supra_a` | Planeur F3J, données AVL de Drela | 3,40 m | 1,25 kg | 677 | mixte |
| `quickie01` | Avion à moteur | 2,00 m | 1,32 kg | 454 | impérial |
| `biplane2` | Biplan | 1,22 m | 1,87 kg | 369 | impérial |
| `melyan_01` | Avion | 1,22 m | 1,80 kg | 435 | impérial |
| `gap65` | Voltige | 1,80 m | 4,50 kg | 1 152 | SI |
| `funjet_pprz` | Aile delta rapide | 0,80 m | 0,60 kg | 5 054 | SI |
| `PilatusB4` | Planeur maquette | 4,61 m | 10 kg | 3 906 | SI |
| `fireworks3_d` | DLG | 1,52 m | 0,26 kg | 4 093 | impérial |
| `mav` | Micro avion | 0,28 m | 0,05 kg | 366 | impérial |

Pour un enfant : `FlexiflyXLM` et `sport` pour le moteur, `allegro` ou `sovereign`
pour un planeur docile, `zagi` pour l'aile volante. Les meshs sont très sobres,
donc à habiller avec une couleur unie et une ombre portée.

Conversion : Three.js ne lit pas l'AC3D. Le script `tools/ac2obj.py` du dépôt
convertit en OBJ ; testé sur `allegro`, `zagi`, `flexifly_xlm`, `sport` et `gap65`,
les objets nommés (`wing`, `rudder`, etc.) sont conservés, ce qui permet d'animer
les gouvernes.

## 2. Rascal 110 : le trainer validé

- Origine : [FGAddon Rascal](https://sourceforge.net/p/flightgear/fgaddon/HEAD/tree/trunk/Aircraft/Rascal/) (GPLv2+), fork [ThunderFly-aerospace/FlightGear-Rascal](https://github.com/ThunderFly-aerospace/FlightGear-Rascal) (GPLv3).
- Déjà converti en OBJ + PNG dans [RC Flight Lab](https://github.com/mwalach76/Altitude-Unknown-RC-Flight-Simulator/tree/main/assets/models/rascal) (GPLv3) : `rascal_body.obj` 2 396 faces, `elevator.obj` 224, `rudder.obj` 109, `l_aileron.obj` et `r_aileron.obj` 14 chacun, `prop_disk.obj` 32, texture `rascal.png`.
- Données de vol : JSBSim `Rascal.xml` (532 lignes) dans le même dépôt sous `assets/jsbsim/aircraft/Rascal/`, plus la variante YASim électrique chez ThunderFly.
- Dimensions JSBSim : envergure 2,79 m, surface 0,98 m², corde 0,35 m, masse à vide 5,9 kg. Grand modèle, mais l'échelle n'a pas d'importance en simulation.

## 3. RCForge : géométrie procédurale depuis le JSON

[RCForge](https://github.com/adithya-s-k/RCForge) (MIT) ne charge aucun mesh. `src/view/foam-wing.ts`
et `src/view/planform.ts` extrudent les ailes en dépron à partir des dimensions du
JSON (`ExtrudeGeometry`). Le même fichier porte masse, CG, profils, débattements
et moteur. Quatre avions mousse : `vt-simple-trainer.json` (Vortex RC, 1,4 m, 500 g,
3 voies : gaz, profondeur, dérive, le plus adapté à un enfant), `ft-tiny-trainer.json`,
`ft-bronco.json`, `ft-22-raptor.json`.

Avantage : aucun asset externe, aucune licence à gérer, et l'avion change quand on
modifie une dimension. Inconvénient : rendu « plaque de mousse », moins séduisant
qu'un mesh texturé.

## 4. Modèles Gazebo de PX4 et ArduPilot

- [PX4-SITL_gazebo-classic/models](https://github.com/PX4/PX4-SITL_gazebo-classic/tree/main/models) (BSD-3) :
  - `plane` : corps `body.dae` 10 419 triangles, gouvernes séparées (ailerons 32, volets 24, profondeur 52, dérive 278), hélice 200 à 300. Masse 1,5 kg. Plugin LiftDrag par élément : pente 4,75 /rad, décrochage à 19°, surface 0,6 m² par élément.
  - `believer` : corps 18 329 triangles, le Believer 1960 mm de MakeFlyEasy. Lourd mais joli.
  - `techpod` : corps de 6 Mo, trop lourd pour le navigateur sans décimation.
  - `glider` réutilise les meshs de `plane`.
- [ardupilot_gazebo/models/zephyr](https://github.com/ArduPilot/ardupilot_gazebo/tree/main/models/zephyr) (LGPLv3) : aile delta Zephyr, `wing.dae` 250 polygones, 1,5 kg. Auteur Cole Biesemeyer.

Three.js charge le Collada avec `ColladaLoader`. Les paramètres LiftDrag sont
minimalistes ; prévoir nos propres coefficients.

## 5. PicaSim : données oui, meshs non

Le README de [PicaSim](https://github.com/Rowlhouse/PicaSim) est explicite : les XML
sont sous PolyForm Noncommercial, donc utilisables dans un projet familial non
commercial, mais « les images et fichiers de modèles viennent de sources variées et
ont été autorisés pour PicaSim ; il faut demander la permission à l'auteur pour les
réutiliser ailleurs ».

Données réutilisables intéressantes : `Trainer` (planeur dérive-profondeur 1,5 m,
pensé pour apprendre), `Trapeze`, `Phase6`, `Wasp`, `Weasel`, `Jackdaw`, `MiniDLG`,
`ElectricGlider`, `Twinjet`, plus 50 profils XML. On peut associer ces XML à un
mesh CRRCsim ou procédural.

## 6. Banques low-poly pour le visuel seulement

- [Low Poly Airplane de MagicGames](https://magic-games.itch.io/low-poly-airplane), CC BY 4.0.
- [Free Low-poly airplane de daniel-dormin](https://daniel-dormin.itch.io/free-low-poly-airplane), .blend, .fbx, .glb.
- [Poly Pizza](https://poly.pizza) : agrégateur CC0 et CC-BY, dont les anciens modèles Google Poly. Non vérifié depuis cet environnement.
- Sketchfab avec les filtres « téléchargeable » et licence CC.
- Liste [awesome-cc0](https://github.com/madjin/awesome-cc0).

Ces modèles n'ont pas de données de vol : les associer aux coefficients CRRCsim
ou à un JSON RCForge.

## 7. La radio : Turnigy i6 ou i6S

Les Turnigy TGY-i6 et TGY-i6S sont des FlySky FS-i6 et FS-i6S rebadgées. Six voies,
quatre axes de manches, deux potentiomètres VrA et VrB, interrupteurs SwA, SwB, SwD
à deux positions et SwC à trois positions.

- **TGY-i6S** : port micro-USB à l'arrière. Le mode simulateur HID s'active tout seul
  au branchement, la radio apparaît comme une manette. Les trims s'appliquent aux
  axes USB. Source : [manuel FS-i6S, « USB simulator mode »](https://www.manualslib.com/manual/1036495/Fly-Sky-Fs-I6s.html?page=10).
- **TGY-i6** : pas d'USB. La prise écolage ronde à l'arrière sort du PPM. Trois options :
  1. Dongle [FlySky FS-SM100](https://www.flyingtech.co.uk/product/flysky-sm100-flight-simulator-usb-adapter-cable/) ou le [câble simulateur Turnigy TGY-i6](https://hobbyking.com/en_us/turnigy-tgy-i6-flight-simulation-cable.html) : joystick USB HID, 10 à 15 €, annoncé Windows par le vendeur, fonctionne en général sous Linux et macOS en HID générique.
  2. Pont Arduino Nano PPM vers série, documenté pas à pas par RCForge (`docs/trainer-nano.md`, `docs/flysky-fs-i6.md`), lu dans Chrome via Web Serial.
  3. Récepteur FS-iA6B + Arduino Pro Micro en iBUS vers joystick HID, ou [Universal-RC-Joystick](https://github.com/Cleric-K/Universal-RC-Joystick) sur STM32.

Dans le navigateur, `navigator.getGamepads()` ne renvoie la radio qu'après un
mouvement de manche. Vérifier sur [gamepad-tester.com](https://gamepad-tester.com/).
Créer sur la radio un modèle « Simulateur » sans mixage ni dual rate, et mapper
SwA sur « reset » et VrA sur le niveau d'assistance.

## Recommandation

1. **Premier avion** : le Simple Trainer de RCForge en procédural (MIT, 3 voies,
   docile), ou le `FlexiflyXLM` de CRRCsim si on préfère un vrai mesh.
2. **Deuxième avion** : `sport` ou `allegro` de CRRCsim, pour les quatre voies et le
   planeur.
3. **Référence physique** : le Rascal 110 JSBSim pour comparer nos chiffres.
4. **Licence du projet** : avec des assets CRRCsim ou Rascal, publier le simulateur
   sous GPL ou garder le projet privé. Avec RCForge seul, MIT reste possible.
