#!/usr/bin/env python3
"""Reconcile public source manifests into The Record without GitHub."""

from __future__ import annotations

import argparse
import hashlib
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
FLDFRG_TARGET = ROOT / "archive" / "fldfrg-works.json"
FLDFRG_MEDIA = ROOT / "archive" / "fldfrg"
FLDFRG_ADDRESS = "0x16bc29ea6e1b9390f70349bfb93ea87ffc9105fc"
FOLDFORGE_ORIGIN = "https://foldforge.zeropoet.xyz"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
RENDERER_ENGINES = {"continuous-voice/v1", "sequential-event-score/v1", "timed-event-score/v1"}


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


def load_remote_bytes(url: str) -> tuple[bytes, str]:
    request = Request(url, headers={"Accept": "image/*", "User-Agent": "The-Record/1.0"})
    with urlopen(request, timeout=30) as response:
        if response.status != 200:
            raise ValueError(f"{url} returned {response.status}")
        return response.read(), response.headers.get_content_type()


def work_key(value: str) -> str:
    value = re.sub(r"^(?:\d{1,2})-", "", str(value or "").lower())
    value = re.sub(r"\b(catholic canon|an old babylonian version|according to the pali canon)\b", "", value)
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", value))


def display_token_name(value: str) -> str:
    value = re.sub(r"^(?:\d{1,2})-", "", str(value or ""))
    return " ".join(part[:1].upper() + part[1:] for part in value.split("-"))


def build_fldfrg_record(archive: dict, contract: dict, tokens: list[tuple[str, dict, bytes]]) -> dict:
    library: dict[str, dict] = {}
    for entry in archive["entries"]:
        if entry.get("collection_id") != "root-logos-works" or entry.get("id") == "root-logos-library-composition":
            continue
        library[work_key(entry.get("title", ""))] = entry
        match = re.search(r"works/([^/]+)", entry.get("source", {}).get("path", ""))
        if match:
            library[work_key(re.sub(r"-[a-f0-9]{8}$", "", match.group(1)))] = entry
    works = []
    for token_id, metadata, image in tokens:
        sound = library.get(work_key(metadata.get("name", "")))
        image_name = f"{int(token_id):03d}.png"
        works.append({
            "token_id": token_id,
            "token_name": metadata.get("name", ""),
            "title": sound.get("title") if sound else display_token_name(metadata.get("name", "")),
            "image": f"archive/fldfrg/{image_name}",
            "image_sha256": hashlib.sha256(image).hexdigest(),
            "metadata_path": f"public/ethereum-archive/contracts/{FLDFRG_ADDRESS}/tokens/{token_id}/metadata.json",
            "sound_id": sound.get("id") if sound else None,
            "sound_title": sound.get("title") if sound else None,
            "paired": bool(sound),
        })
    paired = sum(1 for work in works if work["paired"])
    return {
        "schema": "the-record-fldfrg-contract/v1",
        "contract": {
            "address": contract["address"],
            "name": contract["name"],
            "symbol": contract["symbol"],
            "chain": "ethereum-mainnet",
            "source": "FoldForge canonical local Ethereum archive",
            "source_path": f"public/ethereum-archive/contracts/{FLDFRG_ADDRESS}",
            "url": f"https://etherscan.io/address/{contract['address']}",
        },
        "counts": {"works": len(works), "paired": paired, "awaiting_sound": len(works) - paired},
        "works": works,
    }


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
        renderer = (entry.get("sound") or {}).get("renderer") or {}
        if renderer.get("engine") not in RENDERER_ENGINES:
            raise ValueError(f"{identifier} has no supported source-owned renderer")
        if renderer.get("stereo") != "center":
            raise ValueError(f"{identifier} does not guarantee balanced left-right playback")
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


def sync_fldfrg(archive: dict, local_contract_root=None) -> dict:
    if local_contract_root:
        contract = read_json(local_contract_root / "contract.json")
    else:
        base = f"{FOLDFORGE_ORIGIN}/ethereum-archive/contracts/{FLDFRG_ADDRESS}"
        contract = load_remote(f"{base}/contract.json")
    if contract.get("address", "").lower() != FLDFRG_ADDRESS or contract.get("symbol") != "FLDFRG":
        raise ValueError("unexpected FLDFRG contract identity")
    tokens = []
    FLDFRG_MEDIA.mkdir(parents=True, exist_ok=True)
    for token_id in contract.get("token_ids", []):
        if local_contract_root:
            token_root = local_contract_root / "tokens" / str(token_id)
            metadata = read_json(token_root / "metadata.json")
            image = (token_root / (metadata.get("media") or {}).get("file", "image.png")).read_bytes()
        else:
            token_url = f"{base}/tokens/{token_id}"
            metadata = load_remote(f"{token_url}/metadata.json")
            media_path = (metadata.get("media") or {}).get("path")
            if not media_path or not media_path.startswith("/ethereum-archive/"):
                raise ValueError(f"FLDFRG token {token_id} has no canonical image path")
            image, _ = load_remote_bytes(FOLDFORGE_ORIGIN + media_path)
        image_target = FLDFRG_MEDIA / f"{int(token_id):03d}.png"
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{image_target.name}.", dir=FLDFRG_MEDIA)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(image)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary_name, 0o644)
            os.replace(temporary_name, image_target)
        except Exception:
            Path(temporary_name).unlink(missing_ok=True)
            raise
        tokens.append((str(token_id), metadata, image))
    record = build_fldfrg_record(archive, contract, tokens)
    write_atomic(FLDFRG_TARGET, record)
    return record


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--local", action="append", default=[], metavar="ID=PATH")
    parser.add_argument("--fldfrg-contract-root", type=Path)
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
    contract_root = arguments.fldfrg_contract_root
    if contract_root is None and "foldforge" in local:
        contract_root = Path(local["foldforge"]).resolve().parent / "ethereum-archive" / "contracts" / FLDFRG_ADDRESS
    fldfrg = sync_fldfrg(archive, contract_root)
    print(
        f"Archived {len(archive['entries'])} sound structures from {len(manifests)} source manifests; "
        f"paired {fldfrg['counts']['paired']} of {fldfrg['counts']['works']} FLDFRG works."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
