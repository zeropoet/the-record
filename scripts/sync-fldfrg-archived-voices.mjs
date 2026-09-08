import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const rootLogos = resolve(process.argv[2] || "../root-logos");
const foldForge = resolve(process.argv[3] || "../FoldForge");
const archiveCommit = "a46c9107c8013b90a5b775dbaef0eef9b1cbcd12";
const address = "0x16bc29ea6e1b9390f70349bfb93ea87ffc9105fc";
const withdrawals = JSON.parse(await readFile(resolve(rootLogos, "works/withdrawals.json"), "utf8"));
const contract = JSON.parse(await readFile(resolve(foldForge, "public/ethereum-archive/contracts", address, "contract.json"), "utf8"));
const workRenderer = {
  engine: "sequential-event-score/v1",
  masterGain: 0.36,
  outputGain: 2,
  compressor: { threshold: -14, knee: 8, ratio: 10, attack: 0.004, release: 0.22 },
  amplitude: { minimum: 0.018, maximum: 1 },
  envelope: { attackSeconds: 0.08, releaseRatio: 0.9, minimumReleaseSeconds: 0.2 },
  loop: true,
  stereo: "center"
};
const collection = { id: "root-logos-works", title: "Root Logos / Works", type: "work-voices", order: 30 };
const normalize = (value) => String(value || "")
  .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/^\d{1,2}-/, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const contractKeys = new Set();
for (const tokenId of contract.token_ids) {
  const metadata = JSON.parse(await readFile(resolve(foldForge, "public/ethereum-archive/contracts", address, "tokens", String(tokenId), "metadata.json"), "utf8"));
  contractKeys.add(normalize(metadata.name));
}

const score = (sound) => ({
  mode: "event-score",
  schema: sound.schema,
  signature: sound.signature,
  tempo: sound.tempo,
  rootHz: sound.root_hz,
  renderer: workRenderer,
  events: sound.events.map(({ frequency, waveform, voice, amplitude, beats, rest, provenance }) => ({
    frequency, ...(waveform ? { waveform } : {}), ...(voice ? { voice } : {}),
    amplitude, beats, rest: Boolean(rest), ...(provenance ? { provenance } : {})
  }))
});

const entries = [];
for (const [index, withdrawal] of withdrawals.withdrawals.entries()) {
  const workKey = normalize(withdrawal.work_id.replace(/-[a-f0-9]{8}$/, ""));
  if (!contractKeys.has(workKey)) continue;
  const path = `works/${withdrawal.work_id}/editions/${withdrawal.prior_current_edition}/edition.json`;
  const edition = JSON.parse(execFileSync("git", ["show", `${archiveCommit}:${path}`], { cwd: rootLogos, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
  if (!edition.sound?.events?.length) throw new Error(`${withdrawal.title} has no archived sound score`);
  entries.push({
    id: `root-logos-archived-work-${withdrawal.work_id}`,
    title: withdrawal.title,
    branch: "Root Logos / FLDFRG Archive",
    kind: withdrawal.kind,
    collection,
    collection_order: 500 + index,
    availability: "contract-archived procedural score",
    archive_state: {
      active_library: false,
      withdrawal_record: "works/withdrawals.json",
      prior_edition: withdrawal.prior_current_edition,
      reason: withdrawal.reason
    },
    source: {
      repository: "zeropoet/root-logos",
      path,
      url: "https://foldforge.zeropoet.xyz/"
    },
    sound: score(edition.sound)
  });
}

if (entries.length !== 12) throw new Error(`Expected 12 FLDFRG archived voices, found ${entries.length}`);
await writeFile(resolve(root, "archive/fldfrg-archived-sounds.json"), JSON.stringify({
  schema: "the-record-fldfrg-archived-sounds/v1",
  source_commit: archiveCommit,
  policy: "A work may leave the active Root Logos Library without losing the deterministic voice held by its minted FLDFRG identity.",
  entries
}, null, 2) + "\n");
console.log(`Recovered ${entries.length} archived FLDFRG voices from Root Logos history.`);
