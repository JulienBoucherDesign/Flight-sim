# Références : simulateurs de vol RC open source

État des lieux fait le 1er octobre 2026 pour construire un simulateur RC simple,
destiné à un enfant qui apprend à se servir de sa radiocommande.

## Résumé

| Projet | Techno | Licence | Radio / manette | Avions | Activité | Intérêt pour nous |
| --- | --- | --- | --- | --- | --- | --- |
| [RCForge](https://github.com/adithya-s-k/RCForge) | TypeScript, Three.js, Vite, navigateur | MIT | Clavier, Gamepad API, adaptateur USB, pont Arduino PPM/PWM | 5 avions trainer + 3 quads, en JSON | Très active (sept. 2026) | **Référence principale** : couche radio complète (mapping, calibration, dead zone, expo), physique partagée navigateur / CLI |
| [RC Flight Lab](https://github.com/mwalach76/Altitude-Unknown-RC-Flight-Simulator) | Godot 4.3, GDScript | Pas de fichier LICENSE pour le code (assets Rascal en GPLv3) | Joysticks SDL génériques, mapping 4 voies, inversion, centrage, armement gaz | SIG Rascal 110 trainer | Active (août 2026) | Référence pour le mapping radio en Godot : `src/input/controller_manager.gd`, 146 lignes |
| [rcsim](https://github.com/yotamgi/rcsim) | C++17, raylib, WebAssembly | **Aucun fichier LICENSE** | Gamepad via GLFW, configuration en jeu | Hélicos réalistes + avions modulaires | Active (mai 2026) | Jouable en ligne, mais code non réutilisable légalement sans accord de l'auteur |
| [godot-simplified-flightsim](https://github.com/fbcosentino/godot-simplified-flightsim) | Godot 4 addon, GDScript | MIT | Découplée (modules de contrôle) | Physique « arcade » modulaire | Août 2025 | Base physique simple si on choisit Godot |
| [PicaSim](https://github.com/Rowlhouse/PicaSim) | C++17, SDL2, Bullet, imgui | PolyForm Noncommercial | SDL2 joystick, mapping configurable | Nombreux planeurs et avions | Active | Simulateur complet et gratuit à installer ; code lisible mais licence non commerciale |
| [CRRCsim](https://sourceforge.net/projects/crrcsim/) | C++, OpenGL | GPLv2 | SDL joystick, interface série | Trainers, planeurs | Dernière version 0.9.13 en 2017 | Historique ; modèle aéro de Mark Drela, mais code ancien |
| [R/C Desk Pilot](https://github.com/davyloots/rcdeskpilot) | C#, Managed DirectX 9 | GPLv3 | DirectInput | Trainers | Abandonné, Windows seulement | Historique uniquement |
| [KwadSim](https://github.com/timower/KwadSim) | Godot 3.2 | GPLv3 | Via Betaflight | Quads uniquement | Peu actif | Hors sujet pour un avion |

## Détails utiles

### RCForge

- 17 000 lignes de TypeScript, dépendances réduites : `three`, `zod`, `vite`, `vitest`.
- Architecture en trois couches : `src/core` (physique pure, testable en CLI),
  `src/input` (clavier, Gamepad API, série Arduino), `src/view` (Three.js).
- Lecture de la radio dans `src/input/controls.ts` via `navigator.getGamepads()`,
  avec calibration des fins de course, dead zone et expo par voie.
- Avions décrits en JSON (`aircraft/*.json`) avec provenance de chaque donnée.
  Le « Simple Trainer » Vortex RC (3 voies : gaz, profondeur, dérive) est un bon
  point de départ pour un débutant.
- Documentation radio très complète dans `docs/radio-setup.md`, `docs/controllers.md`,
  `docs/flysky-fs-i6.md`, `docs/trainer-nano.md`.
- La version hébergée demande une connexion Google pour tout sauf le trainer clavier.
  En auto-hébergement, tout est disponible sans compte.
- Limite : physique « ingénierie » et interface atelier, pas pensé pour un enfant.
  Pas de mode auto-stabilisé.

### RC Flight Lab (Godot)

- Point fort : `controller_manager.gd` gère la découverte du joystick, le choix d'axe
  par voie, l'inversion, le centrage, la dead zone, et surtout l'armement des gaz
  au démarrage (le moteur reste à zéro tant que le manche n'est pas vu en bas).
- Physique explicite dans `fixed_wing.gd` (417 lignes) : portance, traînée, décrochage
  progressif, autorité des gouvernes proportionnelle à la pression dynamique.
- Exports Windows, macOS, Raspberry Pi 64 bits.

### Lecture de la radiocommande

- Radios sous EdgeTX ou OpenTX (RadioMaster, Jumper, FrSky, etc.) : brancher en USB,
  choisir « USB Joystick (HID) ». La radio apparaît comme un joystick, ID USB 1209:4F54,
  axes aux valeurs -1 à 1. Documentation : [manuel EdgeTX, USB Joystick](https://manual.edgetx.org/color-radios/model-settings/model-setup/usb-joystick)
  et [mapping pour développeurs](https://manual.edgetx.org/edgetx-how-to/joystick-mapping-information-for-game-developers).
- FlySky FS-i6 et radios sans USB : dongle simulateur sur la prise écolage, ou pont
  Arduino PPM vers série comme dans RCForge (`hardware/rcforge_bridge/rcforge_bridge.ino`).
- Spektrum, FrSky : dongles sans fil type [XSR-SIM](https://www.frsky-rc.com/product/xsr-sim/),
  vus comme joystick HID.
- Dans le navigateur : `navigator.getGamepads()` ne renvoie rien tant que l'utilisateur
  n'a pas bougé un manche ou cliqué. Tester sur [gamepad-tester.com](https://gamepad-tester.com/).
- Alternative matérielle générique : [Universal-RC-Joystick](https://github.com/Cleric-K/Universal-RC-Joystick),
  un STM32 qui convertit un récepteur en joystick USB.

### Simulateurs gratuits prêts à l'emploi, pour comparer

- [SeligSIM](https://www.seligsim.com/) : gratuit, leçons intégrées, trainers.
- [AeroSIM-RC](https://www.aerosimrc.com/en/airplane.htm) : mode « Angle » auto-stabilisé,
  utile comme référence d'un mode débutant.
- [PicaSim](https://github.com/Rowlhouse/PicaSim) : gratuit sur Windows, Linux, Android, iOS.
- [rcsim en ligne](https://yotamgi.github.io/rcsim/) et [RCForge en ligne](https://rcforge.adithyask.com).

## Recommandation

1. **Cible navigateur** avec Three.js et l'API Gamepad : zéro installation, marche sur
   n'importe quel ordinateur, la radio se branche en USB.
2. **Réutiliser la couche radio de RCForge** (MIT) : mapping, calibration, dead zone,
   expo, armement des gaz. C'est la partie la plus pénible à écrire et la mieux faite.
3. **Écrire une physique volontairement simple** : portance et traînée lumpées, avion
   trainer stable, avec un mode « assisté » qui ramène l'avion à plat quand les manches
   sont au centre. Références : `fixed_wing.gd` de RC Flight Lab et
   `src/core/aerodynamics.ts` de RCForge.
4. **Ergonomie enfant** : grand terrain sans obstacles, caméra pilote au sol, reset
   automatique après un crash, cerceaux à traverser, compteur de vols réussis.
