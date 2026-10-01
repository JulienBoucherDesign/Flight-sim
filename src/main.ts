import { Game } from "./app/game";
import { setupUi } from "./app/ui";

const canvas = document.getElementById("view") as HTMLCanvasElement | null;
if (!canvas) throw new Error("Canvas introuvable");

const game = new Game(canvas);
setupUi(game);
game.run();

// Pratique pour le débogage dans la console du navigateur.
(window as unknown as { rcsim: Game }).rcsim = game;
