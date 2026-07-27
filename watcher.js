const { spawn } = require("child_process");

function startCommand(command, args, name) {
  let child;

  const spawnChild = () => {
    child = spawn(command, args, { shell: true, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

    child.stdout.on("data", (data) => {
      process.stdout.write(`[${name}] ${data}`);
    });

    child.stderr.on("data", (data) => {
      process.stderr.write(`[${name} ERROR] ${data}`);
    });

    child.on("exit", (code) => {
      console.log(`[${name}] Proceso terminado con código ${code}`);
      if (code !== 0) {
        console.log(`[${name}] Reiniciando en 5 segundos...`);
        setTimeout(spawnChild, 5000);
      }
    });
  };

  spawnChild();

  return {
    get process() {
      return child;
    },
    kill() {
      if (child && !child.killed) child.kill();
    },
  };
}

console.log("[WATCHER] Iniciando procesos de bot y deploy...");
const botProcess = startCommand("npm", ["run", "start"], "BOT");
const deployProcess = startCommand("npm", ["run", "deploy"], "DEPLOY");

process.on("SIGINT", () => {
  console.log("[WATCHER] Cerrando procesos...");
  botProcess.kill();
  deployProcess.kill();
  process.exit();
});
