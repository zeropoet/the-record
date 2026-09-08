import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const contract = JSON.parse(readFileSync(resolve(root, "archive/fldfrg-works.json"), "utf8"));
const sounds = JSON.parse(readFileSync(resolve(root, "archive/sound-archive.json"), "utf8"));
const soundIds = new Set(sounds.entries.map((entry) => entry.id));

assert.equal(contract.schema, "the-record-fldfrg-contract/v1");
assert.equal(contract.contract.symbol, "FLDFRG");
assert.equal(contract.contract.address, "0x16bc29ea6e1b9390f70349bfb93ea87ffc9105fc");
assert.equal(contract.works.length, 55);
assert.equal(new Set(contract.works.map((work) => work.token_id)).size, contract.works.length);
assert.equal(contract.counts.paired + contract.counts.awaiting_sound, contract.counts.works);

for (const work of contract.works) {
  assert.ok(existsSync(resolve(root, work.image)), "missing image for FLDFRG #" + work.token_id);
  if (work.paired) assert.ok(soundIds.has(work.sound_id), "missing sound " + work.sound_id);
  else assert.equal(work.sound_id, null);
}

console.log("FLDFRG contract verified: " + contract.counts.works + " images / " + contract.counts.paired + " exact sound pairings.");
