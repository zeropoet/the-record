import assert from "node:assert/strict";
import { buildKernelField, CANONICAL_SQUARE, FOLDKERNEL, SYMMETRIES, transformCell } from "../record-kernel.js";

assert.equal(FOLDKERNEL.protocolVersion, "FoldKernel-1.0.0");
assert.equal(new Set(CANONICAL_SQUARE).size, 16);
assert.deepEqual([...CANONICAL_SQUARE].sort((a, b) => a - b), Array.from({ length: 16 }, (_, index) => index + 1));
assert.deepEqual(SYMMETRIES.map((symmetry) => transformCell(0, 0, symmetry)), [
  [0, 0], [0, 3], [3, 3], [3, 0], [3, 0], [0, 3], [0, 0], [3, 3],
]);

const entries = Array.from({ length: 20 }, (_, index) => ({
  id: `voice-${index}`, branch: index < 10 ? "Alpha" : "Beta", sha256: `${index}`.padStart(64, "0"), source: {},
}));
const first = buildKernelField(entries, 1000, 800);
const second = buildKernelField(entries, 1000, 800);
assert.deepEqual(first, second);
assert.equal(first.nodes.length, entries.length);
assert.ok(first.edges.length > entries.length);
assert.ok(first.nodes.every(({ x, y }) => x > 200 && x < 800 && y > 100 && y < 700));
const widened = buildKernelField([...entries, { id: "future-voice", branch: "Aardvark", sha256: "f".repeat(64), source: {} }], 1000, 800);
assert.deepEqual(
  widened.nodes.slice(0, entries.length).map(({ x, y, kernel }) => ({ x, y, kernel })),
  first.nodes.map(({ x, y, kernel }) => ({ x, y, kernel })),
);
console.log(`FoldKernel field verified: ${first.nodes.length} nodes / ${first.edges.length} relations.`);
