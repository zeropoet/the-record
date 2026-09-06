import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compatibility, compatibilityWithSelection, MAX_LAYERS, rankedCandidates } from "../compatibility.js";

const catalog = JSON.parse(await readFile(new URL("../archive/sound-archive.json", import.meta.url), "utf8"));
const works = catalog.entries.filter(({ collection_id }) => collection_id === "root-logos-works");
assert.equal(MAX_LAYERS, 3);
assert.ok(works.length > 10);
const forward = compatibility(works[1], works[2]);
const reverse = compatibility(works[2], works[1]);
assert.equal(forward.score, reverse.score);
assert.ok(forward.score >= 0 && forward.score <= 100);
assert.ok(["strong", "open", "tension"].includes(forward.grade));
assert.equal(compatibilityWithSelection(works[0], []).grade, "anchor");
const ranked = rankedCandidates(works, [works[0]], 5);
assert.equal(ranked.length, 5);
assert.ok(ranked.every(({ entry }) => entry.id !== works[0].id));
assert.ok(ranked.every((item, index) => !index || ranked[index - 1].fit.score >= item.fit.score));
console.log(`Compatibility lens verified across ${works.length} Root Logos work voices.`);
