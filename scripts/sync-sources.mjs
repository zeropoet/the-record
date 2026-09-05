import { readFile, writeFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(await readFile(resolve(root, "propagation/sources.json"), "utf8"));
if (policy.schema !== "the-record-sources/v1" || !Array.isArray(policy.sources)) throw new Error("Invalid source policy");

const local = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index] === "--local") {
    const [id, path] = String(process.argv[++index] || "").split("=", 2);
    if (!id || !path) throw new Error("Use --local source-id=/absolute/manifest.json");
    local.set(id, path);
  }
}

const manifests = [];
for (const source of policy.sources) {
  let manifest;
  if (local.has(source.id)) manifest = JSON.parse(await readFile(local.get(source.id), "utf8"));
  else {
    const response = await fetch(source.manifest_url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`${source.id} returned ${response.status}`);
    manifest = await response.json();
  }
  if (manifest.schema !== "zeropoet-sound-source/v1" || manifest.source_id !== source.id || !Array.isArray(manifest.entries)) throw new Error(`${source.id} manifest is invalid`);
  manifests.push(manifest);
}

const fallbackCollection = { id: "studio-instruments", title: "Studio Instruments", type: "source-instruments", order: 10 };
const entries = manifests.flatMap((manifest) => manifest.entries.map((entry, index) => ({
  ...entry,
  collection: entry.collection || fallbackCollection,
  collection_id: (entry.collection || fallbackCollection).id,
  collection_order: Number(entry.collection_order ?? index + 1)
})));
const isPlayable = (entry) => Boolean(entry.sound && (
  entry.sound.rootHz || entry.sound.frequenciesHz?.length || entry.sound.events?.length
));
const ids = new Set();
for (const entry of entries) {
  if (!entry.id || ids.has(entry.id)) throw new Error(`Missing or duplicate entry id: ${entry.id}`);
  ids.add(entry.id);
  if (!entry.source?.url?.startsWith("https://")) throw new Error(`${entry.id} has an invalid source URL`);
  if (entry.availability === "local canonical file" && !/^[0-9a-f]{64}$/.test(entry.sha256 || "")) throw new Error(`${entry.id} has no valid SHA-256 witness`);
  if (!isPlayable(entry)) throw new Error(`${entry.id} is not playable and cannot enter The Record`);
}

const collections = [...new Map(entries.map(({ collection }) => [collection.id, collection])).values()]
  .sort((a, b) => Number(a.order ?? 9999) - Number(b.order ?? 9999) || a.title.localeCompare(b.title));
entries.sort((a, b) => Number(a.collection?.order ?? 9999) - Number(b.collection?.order ?? 9999)
  || Number(a.collection_order ?? 9999) - Number(b.collection_order ?? 9999)
  || a.title.localeCompare(b.title));

const archive = {
  schema: "zeropoet-sound-archive/v1",
  archive: "The Record",
  canonical_url: "https://record.zeropoet.xyz/",
  principle: "Sources remain sovereign. The Record indexes their relations without copying authority or media.",
  updated_at: new Date().toISOString(),
  sources: manifests.map(({ source_id, authority, canonical_url }) => ({ source_id, authority, canonical_url })),
  collections,
  entries
};
const target = resolve(root, "archive/sound-archive.json");
const temporary = `${target}.next`;
await writeFile(temporary, `${JSON.stringify(archive, null, 2)}\n`, { mode: 0o644 });
await rename(temporary, target);
console.log(`Archived ${entries.length} sound structures from ${manifests.length} source manifests.`);
