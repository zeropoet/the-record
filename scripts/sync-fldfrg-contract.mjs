import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const recordRoot = resolve(here, "..");
const foldForgeRoot = resolve(process.argv[2] || join(recordRoot, "..", "FoldForge"));
const contractAddress = "0x16bc29ea6e1b9390f70349bfb93ea87ffc9105fc";
const contractRoot = join(foldForgeRoot, "public", "ethereum-archive", "contracts", contractAddress);
const catalogPath = join(recordRoot, "archive", "sound-archive.json");
const outputRoot = join(recordRoot, "archive", "fldfrg");
const outputPath = join(recordRoot, "archive", "fldfrg-works.json");

if (!existsSync(contractRoot)) throw new Error("FLDFRG contract archive not found at " + contractRoot);

const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const contract = JSON.parse(readFileSync(join(contractRoot, "contract.json"), "utf8"));
const library = catalog.entries.filter((entry) => entry.collection_id === "root-logos-works" && entry.id !== "root-logos-library-composition");

const slug = (value) => String(value || "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/^(?:\d{1,2})-/, "")
  .replace(/\b(catholic canon|an old babylonian version|according to the pali canon)\b/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

const titleFromToken = (name) => String(name || "")
  .replace(/^(?:\d{1,2})-/, "")
  .split("-")
  .map((word) => word ? word[0].toUpperCase() + word.slice(1) : word)
  .join(" ");

const aliases = new Map([
  ["root-logos-founding-constitution", "root-logos-founding-constitution"],
  ["original-douay-rheims", "original-douay-rheims"],
  ["king-james-bible-1769", "king-james-bible-1769"],
  ["frankenstein-or-the-modern-prometheus", "frankenstein-or-the-modern-prometheus"],
]);

const libraryKeys = new Map();
for (const entry of library) {
  libraryKeys.set(slug(entry.title), entry);
  const sourceSlug = entry.source?.path?.match(/works\/([^/]+)/)?.[1]?.replace(/-[a-f0-9]{8}$/, "");
  if (sourceSlug) libraryKeys.set(slug(sourceSlug), entry);
}

mkdirSync(outputRoot, { recursive: true });
const works = readdirSync(join(contractRoot, "tokens"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((a, b) => Number(a) - Number(b))
  .map((tokenId) => {
    const tokenRoot = join(contractRoot, "tokens", tokenId);
    const metadata = JSON.parse(readFileSync(join(tokenRoot, "metadata.json"), "utf8"));
    const sourceImage = join(tokenRoot, metadata.media?.file || "image.png");
    const extension = basename(sourceImage).includes(".") ? "." + basename(sourceImage).split(".").pop() : ".bin";
    const imageName = String(tokenId).padStart(3, "0") + extension;
    const imagePath = join(outputRoot, imageName);
    copyFileSync(sourceImage, imagePath);
    const imageSha256 = createHash("sha256").update(readFileSync(imagePath)).digest("hex");
    const tokenKey = aliases.get(slug(metadata.name)) || slug(metadata.name);
    const sound = libraryKeys.get(tokenKey) || null;
    return {
      token_id: tokenId,
      token_name: metadata.name,
      title: sound?.title || titleFromToken(metadata.name),
      image: "archive/fldfrg/" + imageName,
      image_sha256: imageSha256,
      metadata_path: relative(foldForgeRoot, join(tokenRoot, "metadata.json")),
      sound_id: sound?.id || null,
      sound_title: sound?.title || null,
      paired: Boolean(sound),
    };
  });

const payload = {
  schema: "the-record-fldfrg-contract/v1",
  contract: {
    address: contract.address,
    name: contract.name,
    symbol: contract.symbol,
    chain: "ethereum-mainnet",
    source: "FoldForge canonical local Ethereum archive",
    source_path: relative(recordRoot, contractRoot),
    url: "https://etherscan.io/address/" + contract.address,
  },
  counts: {
    works: works.length,
    paired: works.filter((work) => work.paired).length,
    awaiting_sound: works.filter((work) => !work.paired).length,
  },
  works,
};

writeFileSync(outputPath, JSON.stringify(payload, null, 2) + "\n");
console.log("Indexed " + payload.counts.works + " FLDFRG works: " + payload.counts.paired + " paired, " + payload.counts.awaiting_sound + " awaiting a library voice.");
