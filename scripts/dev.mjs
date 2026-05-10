import { spawn } from "node:child_process";
import net from "node:net";

const host = process.env.API_HOST ?? "127.0.0.1";
const apiPort = await findAvailablePort(Number(process.env.API_PORT ?? process.env.PORT ?? 4000), host);
const webPort = await findAvailablePort(Number(process.env.VITE_WEB_PORT ?? 5173), "127.0.0.1");
const apiTarget = `http://${host}:${apiPort}`;
const npm = npmRunner();

console.log(`press-app dev: API ${apiTarget}`);
console.log(`press-app dev: Web http://127.0.0.1:${webPort}`);

const children = [
  start("api", npm.command, [...npm.argsPrefix, "run", "dev", "-w", "@pressapp/api"], {
    API_HOST: host,
    API_PORT: String(apiPort),
    PORT: String(apiPort)
  }),
  start("web", npm.command, [...npm.argsPrefix, "run", "dev", "-w", "@pressapp/web"], {
    VITE_API_TARGET: apiTarget,
    VITE_WEB_PORT: String(webPort)
  })
];

let shuttingDown = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shutdown(signal);
  });
}

function start(name, command, args, env) {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ["inherit", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(prefixLines(name, chunk));
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(prefixLines(name, chunk));
  });

  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`press-app dev: ${name} exited with ${signal ?? `code ${code}`}.`);
      shutdown(signal ?? "SIGTERM", code ?? 1);
    }
  });

  return child;
}

function shutdown(signal = "SIGTERM", exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }

  if (signal === "SIGINT" || signal === "SIGTERM") {
    process.exitCode = exitCode;
  }
}

function npmRunner() {
  if (process.env.npm_execpath) {
    return {
      command: process.execPath,
      argsPrefix: [process.env.npm_execpath]
    };
  }

  return {
    command: "npm",
    argsPrefix: []
  };
}

function prefixLines(name, chunk) {
  return String(chunk)
    .split(/\r?\n/)
    .map((line, index, lines) => (index === lines.length - 1 && line === "" ? "" : `[${name}] ${line}`))
    .join("\n");
}

async function findAvailablePort(startPort, hostName) {
  let port = Number.isFinite(startPort) && startPort > 0 ? startPort : 4000;

  while (!(await canListen(port, hostName))) {
    port += 1;
  }

  return port;
}

function canListen(port, hostName) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => {
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.listen(port, hostName);
  });
}
