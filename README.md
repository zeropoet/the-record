# The Record

The Record is the navigable sound archive of the Zeropoet studio, published at
[`record.zeropoet.xyz`](https://record.zeropoet.xyz/). It gathers references to
preserved masters, deterministic instruments, procedural voices, and
compositional grammars without moving their canonical files or absorbing the
authority of the systems that made them.

The public [`foldkernel-integration.json`](foldkernel-integration.json) joins
The Record to the same exact FoldKernel `1.0.5` / protocol `1.0.0` contract
already held by FoldForge, FoldPortrait, Root Logos, and Sovereign Standard.
The Record projects source identities through FoldKernel's canonical square,
eight symmetries, and adjacency grammar to produce stable positions and a wider
relational mesh. That projection may deepen the local synthesized listening
field, but it never changes a master recording, source witness, or archive
authority. Application-level hashes are not presented as FoldKernel convergence
hashes.

## Boundary

- Source media remains in its originating repository or private source library.
- The public archive retains an attributable source path, canonical link, and,
  for preserved media, a SHA-256 witness.
- Sound entries remain grouped by typed collection. Studio instruments,
  question-bearing expressions, and work voices do not collapse
  into one undifferentiated list.
- Each reconciliation replaces the local index from the complete latest source
  manifests. A stable entry id identifies the sound; its current score,
  signature, question, edition path, and collection placement come from the
  originating archive on every sync.
- A missing public media URL is represented as unavailable; it is never replaced
  with a copy or an invented stream.
- Listening begins only after explicit visitor action.
- The initial Assembly is provisional. It relates deterministic public sound
  structures in one browser-local field and changes no source artifact.

## Propagation

Connected systems publish a bounded `zeropoet-sound-source/v1` manifest beside
their existing public site. The Record's Lightsail reconciliation reads only
the allowlisted HTTPS locations in `propagation/sources.json`, validates the
complete set, and replaces its public index atomically. GitHub does not
participate in the live path. A `the-record-propagation/v1` receipt may prompt
an earlier reconciliation; the daily run repairs anything missed.

Sound media is not sent through propagation. Credentials, private files,
customer data, unpublished work, and free-form instructions are prohibited.

Root Logos publishes its current system voices, every playable admitted work,
and its question-bearing tonal expressions. The Record renders these as
separate collections and performs event and timed scores from their published
data rather than substituting a generic voice.

## Local verification

```sh
node scripts/validate.mjs
node scripts/record-kernel.test.mjs
python3 scripts/sync_sources.py \
  --local foldforge=/path/to/FoldForge/public/record-sound-archive.json \
  --local root-logos=/path/to/root-logos/content/record-sound-archive.json \
  --local telos=/path/to/Telos/public/record-sound-archive.json
node scripts/sync-sources.mjs \
  --local foldforge=/path/to/FoldForge/public/record-sound-archive.json \
  --local root-logos=/path/to/root-logos/content/record-sound-archive.json \
  --local telos=/path/to/Telos/public/record-sound-archive.json
python3 -m http.server 8080
```

Then open `http://127.0.0.1:8080/`.

## Canonical runtime

The static site is served by Caddy from the Telos Lightsail instance. A hardened
oneshot reconciler reads the three public source manifests directly over HTTPS;
its persistent systemd timer runs daily and a bounded propagation event may
start the same service sooner. The complete source set must validate before the
archive file is atomically replaced. GitHub stores reviewed source and history
only.
