from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "scripts" / "sync_sources.py"
SPEC = importlib.util.spec_from_file_location("record_sync", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class SyncSourcesTests(unittest.TestCase):
    def test_builds_archive_without_moving_source_authority(self) -> None:
        manifests = [{
            "schema": "zeropoet-sound-source/v1",
            "source_id": "test",
            "authority": "Test Source",
            "canonical_url": "https://example.com/",
            "entries": [{
                "id": "test-voice",
                "title": "Test Voice",
                "branch": "Test",
                "kind": "procedural voice",
                "availability": "public structure",
                "source": {"url": "https://example.com/voice"},
                "sound": {"rootHz": 55},
            }],
        }]
        archive = MODULE.build_archive(manifests)
        self.assertEqual(archive["entries"][0]["source"]["url"], "https://example.com/voice")
        self.assertNotIn("media", archive["entries"][0])

    def test_rejects_local_media_without_digest(self) -> None:
        manifests = [{
            "source_id": "test", "authority": "Test", "canonical_url": "https://example.com/",
            "entries": [{
                "id": "local", "availability": "local canonical file",
                "source": {"url": "https://example.com/"},
            }],
        }]
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            MODULE.build_archive(manifests)

    def test_rejects_entries_the_record_cannot_play(self) -> None:
        manifests = [{
            "source_id": "test", "authority": "Test", "canonical_url": "https://example.com/",
            "entries": [{
                "id": "silent-reference", "availability": "public reference",
                "source": {"url": "https://example.com/"},
            }],
        }]
        with self.assertRaisesRegex(ValueError, "not playable"):
            MODULE.build_archive(manifests)


if __name__ == "__main__":
    unittest.main()
