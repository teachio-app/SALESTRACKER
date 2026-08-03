// Run: npx tsx lib/mail.test.ts
// The watermark advance rule. Small function, ten-day outage: the poller kept
// answering 200 while silently never seeing another sale, because a range that
// returned nothing left the watermark where it was and the next run asked for
// the same dead UIDs again.

import { advanceWatermark } from "./mail";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}

console.log("\nadvanceWatermark()");
// The bug: examined 55583..55597, every one of them deleted, nothing came back.
// `highestUidSeen` is the previous watermark, so the old code re-wrote 55582.
check("an empty range still counts as examined", advanceWatermark(55597, 55582), 55597);
check("a range with mail lands on the range top", advanceWatermark(55597, 55590), 55597);
check("the whole range full, top message seen", advanceWatermark(55597, 55597), 55597);
// Some servers return messages past the end of an `X:Y` range; those were
// processed too, so the watermark must not go backwards over them.
check("a UID beyond the range wins", advanceWatermark(55597, 55600), 55600);
check("single-UID range", advanceWatermark(101, 100), 101);

console.log("\nthe stall this prevents");
// Simulate the loop that ran every 5 minutes for ten days: hole from 55583 on.
let mark = 55582;
const MAX = 15;
for (let run = 0; run < 3; run++) {
  const to = mark + MAX;
  mark = advanceWatermark(to, mark); // nothing fetched → highestSeen stays at mark
}
check("three empty runs move it forward, not in circles", mark, 55582 + 45);

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
