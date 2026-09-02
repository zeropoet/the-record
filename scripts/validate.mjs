import { readFile, access } from "node:fs/promises";

const catalog = JSON.parse(await readFile(new URL("../archive/sound-archive.json", import.meta.url), "utf8"));
if (catalog.schema !== "zeropoet-sound-archive/v1") throw new Error("Unexpected archive schema");
if (!Array.isArray(catalog.entries) || !catalog.entries.length) throw new Error("Archive has no entries");
const ids = new Set();
for (const entry of catalog.entries) {
  for (const field of ["id", "title", "branch", "kind", "availability", "source"]) if (!entry[field]) throw new Error(`${entry.id || "entry"} missing ${field}`);
  if (ids.has(entry.id)) throw new Error(`Duplicate id: ${entry.id}`);
  ids.add(entry.id);
  if (!entry.source.url.startsWith("https://")) throw new Error(`${entry.id} source URL is not HTTPS`);
  if (entry.availability === "local canonical file" && !/^[0-9a-f]{64}$/.test(entry.sha256 || "")) throw new Error(`${entry.id} is missing its SHA-256 witness`);
}
for (const path of ["../index.html", "../styles.css", "../record.js", "../assets/sovereign-standard-record-mark.svg"]) await access(new URL(path, import.meta.url));
console.log(`Validated ${catalog.entries.length} sound structures across ${new Set(catalog.entries.map(({ branch }) => branch)).size} branches.`);
