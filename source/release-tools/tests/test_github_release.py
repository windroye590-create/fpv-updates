"""Failure and retry checks for the public release pipeline; no live writes."""
import copy
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / "github_release.py"
spec = importlib.util.spec_from_file_location("github_release", path)
release = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = release
spec.loader.exec_module(release)


def catalog(version, code):
    return json.dumps({"windows.name": version, "windows.code": str(code)}).encode()


def bundle():
    return release.Bundle("1.2.10", 133, {
        "FPV-Komisiia-PC.exe": b"MZverified-new-executable",
        "updates.txt": catalog("1.2.10", 133),
        "icon.png": b"icon",
        "index.html": b"page",
    })


class FakeGitHub:
    def __init__(self):
        self.releases = {
            1: {"id": 1, "tag_name": "v1.2.8", "draft": False, "assets": [
                {"id": 11, "name": "updates.txt", "size": len(catalog("1.2.8", 131)),
                 "state": "uploaded"}]},
        }
        self.raw = {11: catalog("1.2.8", 131)}
        self.current = 1
        self.next_asset = 20
        self.events = []
        self.fail_upload = None
        self.corrupt_upload = None
        self.change_latest_before_publish = False
        self.latest_reads = 0

    def latest(self):
        self.latest_reads += 1
        if self.change_latest_before_publish and self.latest_reads == 2:
            self.releases[3] = {
                "id": 3, "tag_name": "v1.2.11", "draft": False,
                "assets": [{"id": 31, "name": "updates.txt", "size": 1, "state": "uploaded"}],
            }
            self.raw[31] = catalog("1.2.11", 134)
            self.current = 3
        return copy.deepcopy(self.releases[self.current])

    def find(self, tag):
        return next((copy.deepcopy(r) for r in self.releases.values()
                     if r["tag_name"] == tag), None)

    def create(self, bundle, notes, commit):
        self.events.append(("create", bundle.tag))
        self.releases[2] = {"id": 2, "tag_name": bundle.tag, "draft": True, "assets": []}
        return copy.deepcopy(self.releases[2])

    def release(self, release_id):
        return copy.deepcopy(self.releases[release_id])

    def download(self, asset):
        self.events.append(("download", asset["name"]))
        return self.raw[asset["id"]]

    def delete_asset(self, asset):
        self.events.append(("delete", asset["name"]))
        self.releases[2]["assets"] = [a for a in self.releases[2]["assets"]
                                     if a["id"] != asset["id"]]

    def upload(self, release_id, name, raw):
        self.events.append(("upload", name))
        if name == self.fail_upload:
            raise OSError("Simulated interrupted upload")
        self.next_asset += 1
        asset = {"id": self.next_asset, "name": name, "size": len(raw), "state": "uploaded"}
        self.raw[asset["id"]] = raw + b"corrupted" if name == self.corrupt_upload else raw
        self.releases[release_id]["assets"].append(asset)
        return copy.deepcopy(asset)

    def publish(self, release_id):
        self.events.append(("publish", release_id))
        self.releases[release_id]["draft"] = False
        self.current = release_id


@patch.object(release, "verify_catalog", side_effect=lambda raw, key: json.loads(raw))
class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.output = redirect_stdout(io.StringIO())
        self.output.__enter__()
        self.addCleanup(self.output.__exit__, None, None, None)

    def run_publish(self, client, candidate=None):
        return release.publish_bundle(client, candidate or bundle(), "public.pem", "Notes", "sha")

    def test_latest_changes_only_after_every_file_was_downloaded_and_verified(self, verify):
        client = FakeGitHub()
        self.run_publish(client)
        before_publish = client.events[:client.events.index(("publish", 2))]
        for name in release.FILES:
            self.assertIn(("upload", name), before_publish)
            self.assertIn(("download", name), before_publish)
        self.assertEqual(client.current, 2)

    def test_interrupted_upload_preserves_the_old_public_release(self, verify):
        client = FakeGitHub()
        client.fail_upload = "icon.png"
        with self.assertRaises(OSError):
            self.run_publish(client)
        self.assertEqual(client.current, 1)
        self.assertTrue(client.releases[2]["draft"])
        self.assertNotIn(("publish", 2), client.events)

    def test_corrupt_download_never_publishes(self, verify):
        client = FakeGitHub()
        client.corrupt_upload = "FPV-Komisiia-PC.exe"
        with self.assertRaisesRegex(ValueError, "Uploaded bytes differ"):
            self.run_publish(client)
        self.assertEqual(client.current, 1)

    def test_retry_resumes_a_partial_draft_and_reuses_verified_assets(self, verify):
        client = FakeGitHub()
        client.fail_upload = "icon.png"
        with self.assertRaises(OSError):
            self.run_publish(client)
        client.fail_upload = None
        self.run_publish(client)
        self.assertEqual(client.events.count(("create", "v1.2.10")), 1)
        self.assertEqual(client.events.count(("upload", "FPV-Komisiia-PC.exe")), 1)
        self.assertEqual(client.current, 2)

    def test_changed_draft_asset_is_replaced_before_publication(self, verify):
        client = FakeGitHub()
        client.corrupt_upload = "FPV-Komisiia-PC.exe"
        with self.assertRaises(ValueError):
            self.run_publish(client)
        client.corrupt_upload = None
        self.run_publish(client)
        self.assertIn(("delete", "FPV-Komisiia-PC.exe"), client.events)
        self.assertEqual(client.current, 2)

    def test_repeating_the_same_published_bundle_is_idempotent(self, verify):
        client = FakeGitHub()
        self.run_publish(client)
        first_events = list(client.events)
        self.run_publish(client)
        self.assertEqual(client.events.count(("create", "v1.2.10")), 1)
        self.assertEqual(client.events.count(("publish", 2)), 1)
        self.assertEqual([e for e in client.events[len(first_events):]
                          if e[0] in {"create", "upload", "delete", "publish"}], [])

    def test_a_published_release_cannot_be_overwritten(self, verify):
        client = FakeGitHub()
        self.run_publish(client)
        candidate = bundle()
        candidate.assets["index.html"] = b"changed"
        with self.assertRaisesRegex(ValueError, "Published release differs"):
            self.run_publish(client, candidate)
        self.assertFalse(client.releases[2]["draft"])

    def test_older_build_is_rejected_before_any_write(self, verify):
        client = FakeGitHub()
        candidate = release.Bundle("1.2.7", 129, bundle().assets)
        with self.assertRaisesRegex(ValueError, "older build"):
            self.run_publish(client, candidate)
        self.assertFalse(any(e[0] in {"create", "upload", "delete", "publish"}
                             for e in client.events))

    def test_a_newer_release_arriving_during_upload_is_not_downgraded(self, verify):
        client = FakeGitHub()
        client.change_latest_before_publish = True
        with self.assertRaisesRegex(ValueError, "older build"):
            self.run_publish(client)
        self.assertEqual(client.current, 3)
        self.assertTrue(client.releases[2]["draft"])


class TransportTests(unittest.TestCase):
    def test_authentication_is_removed_from_cross_host_redirects(self):
        request = release.Request("https://api.github.com/example",
                                  headers={"Authorization": "Bearer synthetic"})
        redirected = release.SafeRedirect().redirect_request(
            request, None, 302, "", {}, "https://release-assets.githubusercontent.com/file")
        self.assertIsNone(redirected.get_header("Authorization"))

    def test_plain_http_redirects_are_rejected(self):
        request = release.Request("https://api.github.com/example")
        with self.assertRaisesRegex(ValueError, "insecure"):
            release.SafeRedirect().redirect_request(request, None, 302, "", {},
                                                   "http://example.com/file")


if __name__ == "__main__":
    unittest.main()
