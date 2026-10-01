import { AIRCRAFT_LIST } from "../core/aircraft";
import type { AssistLevel } from "../core/assist";
import { CalibrationWizard } from "../input/calibration";
import { saveCalibration } from "../input/gamepad";
import type { Game, StartMode, WindLevel } from "./game";

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Élément manquant : #${id}`);
  return e as T;
}

/** Branche les menus, le HUD et l'assistant de calibration sur le jeu. */
export function setupUi(game: Game): void {
  const menu = el<HTMLDivElement>("menu");
  const wizardPanel = el<HTMLDivElement>("wizard");
  const inputStatus = el<HTMLDivElement>("input-status");
  const selAircraft = el<HTMLSelectElement>("sel-aircraft");
  const aircraftDesc = el<HTMLDivElement>("aircraft-desc");
  const btnFly = el<HTMLButtonElement>("btn-fly");
  const btnCalibrate = el<HTMLButtonElement>("btn-calibrate");

  for (const a of AIRCRAFT_LIST) {
    const o = document.createElement("option");
    o.value = a.id;
    o.textContent = a.name;
    selAircraft.appendChild(o);
  }
  selAircraft.value = game.settings.aircraftId;
  const refreshDesc = () => { aircraftDesc.textContent = AIRCRAFT_LIST.find((a) => a.id === selAircraft.value)?.description ?? ""; };
  refreshDesc();
  selAircraft.addEventListener("change", () => { game.setAircraft(selAircraft.value); refreshDesc(); });

  const choiceGroup = (containerId: string, attr: string, current: string, onPick: (v: string) => void) => {
    const container = el<HTMLDivElement>(containerId);
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>(".choice"));
    const apply = (v: string) => buttons.forEach((b) => b.classList.toggle("active", b.dataset[attr] === v));
    apply(current);
    for (const b of buttons) b.addEventListener("click", () => { const v = b.dataset[attr]!; apply(v); onPick(v); });
  };
  choiceGroup("assist-choices", "assist", String(game.settings.assist), (v) => game.setAssist(Number(v) as AssistLevel));
  choiceGroup("start-choices", "start", game.settings.start, (v) => game.setStart(v as StartMode));
  choiceGroup("wind-choices", "wind", game.settings.wind, (v) => game.setWind(v as WindLevel));

  btnFly.addEventListener("click", () => game.startFlight());
  el<HTMLButtonElement>("btn-menu").addEventListener("click", () => game.openMenu());
  el<HTMLButtonElement>("btn-reset").addEventListener("click", () => game.resetAircraft());
  const btnCamera = el<HTMLButtonElement>("btn-camera");
  btnCamera.addEventListener("click", () => { const m = game.toggleCamera(); btnCamera.textContent = m === "pilot" ? "Caméra" : "Caméra : poursuite"; });
  const btnSound = el<HTMLButtonElement>("btn-sound");
  const refreshSound = () => { btnSound.textContent = game.sound.muted ? "Son : coupé" : "Son"; };
  refreshSound();
  btnSound.addEventListener("click", () => { game.toggleSound(); refreshSound(); });

  game.onStateChange = (s) => {
    menu.classList.toggle("hidden", s !== "menu");
    if (s === "menu") wizardPanel.classList.add("hidden");
  };

  // État de la radio, rafraîchi en continu tant que le menu est ouvert.
  const refreshStatus = () => {
    if (game.state !== "menu") return;
    const st = game.input.status();
    if (!st.gamepadName) {
      inputStatus.textContent = "Aucune radio détectée : le clavier est actif. Branche la radio en USB et bouge un manche.";
      inputStatus.classList.remove("ok");
      btnCalibrate.disabled = true;
    } else if (st.calibrated) {
      inputStatus.textContent = `Radio prête : ${shortName(st.gamepadName)}`;
      inputStatus.classList.add("ok");
      btnCalibrate.disabled = false;
      btnCalibrate.textContent = "Régler la radio à nouveau";
    } else {
      inputStatus.textContent = `Radio détectée : ${shortName(st.gamepadName)}. Il faut la régler une fois.`;
      inputStatus.classList.remove("ok");
      btnCalibrate.disabled = false;
      btnCalibrate.textContent = "Régler la radio";
    }
  };
  setInterval(refreshStatus, 400);
  refreshStatus();

  // Assistant de calibration.
  let wizard: CalibrationWizard | null = null;
  const wizTitle = el<HTMLElement>("wiz-title");
  const wizText = el<HTMLElement>("wiz-text");
  const wizAxes = el<HTMLDivElement>("wiz-axes");
  const wizDetected = el<HTMLDivElement>("wiz-detected");
  const wizNext = el<HTMLButtonElement>("wiz-next");
  const wizSkip = el<HTMLButtonElement>("wiz-skip");
  const wizBack = el<HTMLButtonElement>("wiz-back");
  const wizCancel = el<HTMLButtonElement>("wiz-cancel");

  const closeWizard = () => {
    wizard = null;
    wizardPanel.classList.add("hidden");
    menu.classList.remove("hidden");
    refreshStatus();
  };

  btnCalibrate.addEventListener("click", () => {
    const pad = game.input.gamepad.current();
    if (!pad) return;
    game.sound.ensure();
    wizard = new CalibrationWizard(pad);
    menu.classList.add("hidden");
    wizardPanel.classList.remove("hidden");
    renderWizard();
  });

  const renderWizard = () => {
    if (!wizard) return;
    const v = wizard.view();
    wizTitle.textContent = v.title;
    wizText.textContent = v.text;
    wizDetected.textContent = v.detected;
    wizNext.disabled = !v.canNext;
    wizSkip.classList.toggle("hidden", !v.canSkip);
    wizNext.textContent = v.step.type === "smoke" ? "Terminer" : "Suivant";
    if (wizAxes.childElementCount !== v.axes.length) {
      wizAxes.innerHTML = "";
      for (const a of v.axes) {
        const d = document.createElement("div");
        d.className = "axis";
        d.innerHTML = `<div>Axe ${a.index + 1}<span class="val"></span></div><div class="bar"><i></i></div>`;
        wizAxes.appendChild(d);
      }
    }
    v.axes.forEach((a, i) => {
      const d = wizAxes.children[i] as HTMLDivElement;
      d.classList.toggle("hot", a.hot);
      d.style.opacity = a.used && !a.hot ? "0.45" : "1";
      (d.querySelector(".val") as HTMLElement).textContent = ` ${a.value.toFixed(2)}`;
      (d.querySelector("i") as HTMLElement).style.left = `${((a.value + 1) / 2) * 100}%`;
    });
  };

  const advance = (skip: boolean) => {
    const pad = game.input.gamepad.current();
    if (!wizard || !pad) { closeWizard(); return; }
    const result = wizard.next(pad, skip);
    if (result) {
      saveCalibration(result);
      game.input.gamepad.calibration = result;
      closeWizard();
      return;
    }
    renderWizard();
  };
  wizNext.addEventListener("click", () => advance(false));
  wizSkip.addEventListener("click", () => advance(true));
  wizBack.addEventListener("click", () => { const pad = game.input.gamepad.current(); if (wizard && pad) { wizard.back(pad); renderWizard(); } });
  wizCancel.addEventListener("click", closeWizard);

  const tickWizard = () => {
    requestAnimationFrame(tickWizard);
    if (!wizard) return;
    const pad = game.input.gamepad.current();
    if (!pad) { wizDetected.textContent = "Radio débranchée."; return; }
    wizard.update(pad);
    renderWizard();
  };
  requestAnimationFrame(tickWizard);
}

function shortName(id: string): string {
  // Les identifiants de manette sont longs : on garde le début.
  return id.replace(/\s*\(.*$/, "").slice(0, 40) || id;
}
