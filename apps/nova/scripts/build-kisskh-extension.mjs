import { verifySnapshot } from "./foundry-snapshot.mjs";
const lock = await verifySnapshot();
console.log(
  `Using the verified Foundry KissKH payload from ${lock.revision}. Build source changes in Foundry, then run extensions:update with the reviewed commit.`,
);
