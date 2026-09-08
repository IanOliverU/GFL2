import "./style.css";
import { Game } from "./game";
import { suppressContextMenuWithin } from "./input";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const root = document.getElementById("ui-root") as HTMLElement;
const boot = document.getElementById("boot-error") as HTMLElement;

function bootError(msg: string): void {
  boot.textContent = msg;
  boot.classList.remove("hidden");
}

window.addEventListener("error", (e) => {
  if (boot.classList.contains("hidden")) {
    bootError(`Error: ${e.message ?? e.error}`);
  }
});
window.addEventListener("unhandledrejection", (e) => {
  bootError(`Load failure: ${String((e.reason as Error)?.message ?? e.reason)}`);
});
// RMB remains game input if an upgrade overlay appears under the pointer.
suppressContextMenuWithin(canvas, root);

const game = new Game(canvas, root);
const query = new URLSearchParams(location.search);
if (query.get("dev") === "1") {
  (window as unknown as { __gflGame: Game }).__gflGame = game;
}
game.init(bootError).then(() => {
  // Clearly-separated dev shortcut: ?dev=1&autostart=1&char=mosin
  const q = query;
  if (q.get("dev") === "1" && q.get("autostart") === "1") {
    const char = (q.get("char") ?? "tololo") as "tololo" | "qiongjiu" | "mosin" | "sabrina" | "peritya" | "vepley";
    const valid = ["tololo", "qiongjiu", "mosin", "sabrina", "peritya", "vepley"];
    game.startRun((valid.includes(char) ? char : "tololo") as typeof char);
    if (q.get("god") === "1") game.sim.godmode = true;
  }
}).catch((err) => {
  console.error(err);
  bootError(`Failed to start: ${String((err as Error)?.message ?? err)}`);
});
