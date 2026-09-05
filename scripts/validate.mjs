import { readFile, access } from "node:fs/promises";
import { FOLDKERNEL } from "../record-kernel.js";

const catalog = JSON.parse(await readFile(new URL("../archive/sound-archive.json", import.meta.url), "utf8"));
if (catalog.schema !== "zeropoet-sound-archive/v1") throw new Error("Unexpected archive schema");
if (!Array.isArray(catalog.entries) || !catalog.entries.length) throw new Error("Archive has no entries");
if (!Array.isArray(catalog.collections) || !catalog.collections.length) throw new Error("Archive has no collections");
const collectionIds = new Set(catalog.collections.map(({ id }) => id));
if (collectionIds.size !== catalog.collections.length) throw new Error("Archive has duplicate collection ids");
const ids = new Set();
for (const entry of catalog.entries) {
  for (const field of ["id", "title", "branch", "kind", "availability", "source"]) if (!entry[field]) throw new Error(`${entry.id || "entry"} missing ${field}`);
  if (ids.has(entry.id)) throw new Error(`Duplicate id: ${entry.id}`);
  ids.add(entry.id);
  if (!collectionIds.has(entry.collection_id) || entry.collection?.id !== entry.collection_id) throw new Error(`${entry.id} has an invalid collection`);
  if (!entry.source.url.startsWith("https://")) throw new Error(`${entry.id} source URL is not HTTPS`);
  if (!(entry.sound?.rootHz || entry.sound?.frequenciesHz?.length || entry.sound?.events?.length)) throw new Error(`${entry.id} is not playable`);
  if (entry.sound?.events && entry.sound.events.some((event) => !event.rest && !(Number(event.frequency) > 0 || (Number(entry.sound.rootHz) > 0 && Number(event.ratio) > 0)))) throw new Error(`${entry.id} contains an unplayable event`);
  if (entry.availability === "local canonical file" && !/^[0-9a-f]{64}$/.test(entry.sha256 || "")) throw new Error(`${entry.id} is missing its SHA-256 witness`);
  if (["event-score", "timed-score"].includes(entry.sound?.mode) && !entry.sound.events?.length) throw new Error(`${entry.id} has an empty score`);
  if (entry.collection?.type === "question-expressions" && !entry.question?.text) throw new Error(`${entry.id} has no originating question`);
}
for (const path of ["../index.html", "../styles.css", "../record.js", "../assets/sovereign-standard-record-mark.svg"]) await access(new URL(path, import.meta.url));
const declaration = JSON.parse(await readFile(new URL("../foldkernel-integration.json", import.meta.url), "utf8"));
if (declaration.contractVersion !== FOLDKERNEL.contractVersion) throw new Error("FoldKernel contract drift");
if (declaration.foldKernel.protocolVersion !== FOLDKERNEL.protocolVersion || declaration.foldKernel.packageRequirement.version !== FOLDKERNEL.packageVersion) throw new Error("FoldKernel version drift");
if (declaration.consumer.publicManifestURL !== "https://record.zeropoet.xyz/foldkernel-integration.json") throw new Error("FoldKernel public manifest URL drift");
console.log(`Validated ${catalog.entries.length} sounds across ${catalog.collections.length} collections.`);
