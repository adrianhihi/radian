import { startScanner } from "./scanner.js";
import { startServer } from "./server.js";

async function main() {
  console.log("[radian-indexer] starting");
  startServer();
  await startScanner();
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
