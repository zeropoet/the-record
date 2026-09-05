#!/usr/bin/env python3
"""Reconcile public source manifests into The Record without GitHub."""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
POLICY = ROOT / "propagation" / "sources.json"
TARGET = ROOT / "archive" / "sound-archive.json"
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def is_playable(entry: dict) -> bool:
    sound = entry.get("sound") or {}
    return bool(sound.get("rootHz") or sound.get("frequenciesHz") or sound.get("events"))


def read_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_remote(url: str) -> dict:
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "The-Record/1.0"})
    with urlopen(request, timeout=12) as response:
        if response.status != 200:
            raise ValueError(f"{url} returned {response.status}")
        return json.load(response)


def validate_manifest(source: dict, manifest: dict) -> None:
    if manifest.get("schema") != "zeropoet-sound-source/v1":
        raise ValueError(f"{source['id']} has an unexpected schema")
    if manifest.get("source_id") != source["id"] or not isinstance(manifest.get("entries"), list):
        raise ValueError(f"{source['id']} manifest is invalid")


def build_archive(manifests: list[dict]) -> dict:
    fallback_collection = {
        "id": "studio-instruments",
        "title": "Studio Instruments",
        "type": "source-instruments",
        "order": 10,
    }
    entries = []
    for manifest in manifests:
        for index, source_entry in enumerate(manifest["entries"]):
            entry = dict(source_entry)
            collection = entry.get("collection") or fallback_collection
            entry["collection"] = collection
            entry["collection_id"] = collection["id"]
            entry["collection_order"] = entry.get("collection_order", index + 1)
            entries.append(entry)
    seen: set[str] = set()
    for entry in entries:
        identifier = entry.get("id")
        if not identifier or identifier in seen:
            raise ValueError(f"missing or duplicate entry id: {identifier}")
        seen.add(identifier)
        if not entry.get("source", {}).get("url", "").startswith("https://"):
            raise ValueError(f"{identifier} has an invalid source URL")
        if entry.get("availability") == "local canonical file" and not SHA256.fullmatch(entry.get("sha256", "")):
            raise ValueError(f"{identifier} has no valid SHA-256 witness")
        if not is_playable(entry):
            raise ValueError(f"{identifier} is not playable and cannot enter The Record")
    collections_by_id = {entry["collection"]["id"]: entry["collection"] for entry in entries}
    collections = sorted(
        collections_by_id.values(),
        key=lambda item: (item.get("order", 9999), item["title"]),
    )
    entries.sort(key=lambda item: (
        item["collection"].get("order", 9999),
        item.get("collection_order", 9999),
        item["title"],
    ))
    return {
        "schema": "zeropoet-sound-archive/v1",
        "archive": "The Record",
        "canonical_url": "https://record.zeropoet.xyz/",
        "principle": "Sources remain sovereign. The Record indexes their relations without copying authority or media.",
        "updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sources": [
            {key: manifest[key] for key in ("source_id", "authority", "canonical_url")}
            for manifest in manifests
        ],
        "collections": collections,
        "entries": entries,
    }


def write_atomic(target: Path, archive: dict) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(archive, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary_name, 0o644)
        os.replace(temporary_name, target)
    except Exception:
        Path(temporary_name).unlink(missing_ok=True)
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--local", action="append", default=[], metavar="ID=PATH")
    arguments = parser.parse_args()
    local = dict(item.split("=", 1) for item in arguments.local)
    policy = read_json(POLICY)
    if policy.get("schema") != "the-record-sources/v1":
        raise ValueError("invalid source policy")
    manifests = []
    for source in policy["sources"]:
        manifest = read_json(Path(local[source["id"]])) if source["id"] in local else load_remote(source["manifest_url"])
        validate_manifest(source, manifest)
        manifests.append(manifest)
    archive = build_archive(manifests)
    write_atomic(TARGET, archive)
    print(f"Archived {len(archive['entries'])} sound structures from {len(manifests)} source manifests.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
