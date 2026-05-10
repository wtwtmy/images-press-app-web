import { createApp } from "./app.js";

const port = Number(process.env.API_PORT ?? process.env.PORT ?? 4000);
const host = process.env.API_HOST ?? "127.0.0.1";
const app = createApp();

const server = app.listen(port, host, () => {
  console.log(`press-app api listening on http://${host}:${port}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`press-app api could not start: ${host}:${port} is already in use.`);
    process.exitCode = 1;
    return;
  }

  console.error("press-app api could not start:", error);
  process.exitCode = 1;
});
