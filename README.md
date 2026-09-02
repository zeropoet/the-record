# The Record

The Record is the navigable sound archive of the Zeropoet studio, published at
[`record.zeropoet.xyz`](https://record.zeropoet.xyz/). It gathers references to
preserved masters, deterministic instruments, procedural voices, and
compositional grammars without moving their canonical files or absorbing the
authority of the systems that made them.

## Boundary

- Source media remains in its originating repository or private source library.
- The public archive retains an attributable source path, canonical link, and,
  for preserved media, a SHA-256 witness.
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

## Local verification

```sh
node scripts/validate.mjs
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
