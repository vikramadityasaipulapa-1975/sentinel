import { createApp } from "./app.js";

const host = "127.0.0.1";
const port = 3001;
const server = createApp().listen(port, host, () => {
  console.log(`Checkout service listening at http://${host}:${port}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(`Checkout service failed to start: ${error.code ?? error.message}`);
  process.exitCode = 1;
});
