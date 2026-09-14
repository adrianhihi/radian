import { startScanner } from "./scanner.js";
import { startServer } from "./server.js";
import { startKeeper } from "./keeper.js";

async function main() {
  console.log("[radian-indexer] starting");
  startServer();
  startKeeper();
  await startScanner();
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
