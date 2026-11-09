"""Publish a verified signed bundle; switch latest only after every asset is checked."""
import argparse
import base64
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

FILES = ("FPV-Komisiia-PC.exe", "updates.txt", "icon.png", "index.html")
MAX_SIZE = 64 * 1024 * 1024
REPOSITORY = "windroye590-create/fpv-updates"
FIELDS = ["schema"] + [
    section + "." + field
    for section in ("android", "windows")
    for field in ("code", "name", "file", "size", "sha256")
]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def verify_catalog(wire, public_key):
    require(len(wire) <= 16384, "Catalog exceeds the installed parser limit")
    parts = wire.split(b"\n", 2)
    require(len(parts) == 3 and parts[0] == b"LKUPDATE1", "Unknown catalog format")
    require(len(parts[1]) == 512, "Wrong RSA signature length")
    signature = base64.b64decode(parts[1], validate=True)
    require(len(signature) == 384, "Use the installed RSA-3072 key")
    with tempfile.TemporaryDirectory(prefix="lk-catalog-") as directory:
        directory = Path(directory)
        (directory / "signature").write_bytes(signature)
        (directory / "payload").write_bytes(parts[2])
        result = subprocess.run(
            ["openssl", "dgst", "-sha256", "-verify", str(public_key),
             "-signature", str(directory / "signature"), str(directory / "payload")],
            capture_output=True,
        )
        require(result.returncode == 0, "Catalog signature does not match the installed key")
    require(parts[2].endswith(b"\n"), "Catalog must end with a newline")
    lines = parts[2].decode("ascii").splitlines()
    pairs = [line.split("=", 1) for line in lines]
    require(all(len(pair) == 2 for pair in pairs), "Malformed catalog field")
    require([pair[0] for pair in pairs] == FIELDS, "Unexpected catalog fields or order")
    fields = dict(pairs)
    require(fields["schema"] == "1", "Unsupported catalog schema")
    for platform, extension in (("android", "apk"), ("windows", "exe")):
        prefix = platform + "."
        require(re.fullmatch(r"[0-9]{1,8}", fields[prefix + "code"]), "Invalid version code")
        require(0 < int(fields[prefix + "code"]) <= 10000000, "Version code out of range")
        require(re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", fields[prefix + "name"])
                and len(fields[prefix + "name"]) <= 31, "Invalid version name")
        filename = fields[prefix + "file"]
        require(re.fullmatch(r"FPV-Komisiia-[A-Za-z0-9.-]+\." + extension, filename)
                and ".." not in filename and len(filename) <= 127, "Invalid artifact name")
        require(re.fullmatch(r"[0-9]{1,8}", fields[prefix + "size"])
                and 0 < int(fields[prefix + "size"]) <= MAX_SIZE, "Invalid artifact size")
        require(re.fullmatch(r"[0-9a-f]{64}", fields[prefix + "sha256"]), "Invalid artifact digest")
    require(fields["windows.file"] == FILES[0], "Keep the installed executable filename")
    return fields


@dataclass(frozen=True)
class Bundle:
    version: str
    code: int
    assets: dict

    @property
    def tag(self):
        return "v" + self.version


def read_bundle(directory, public_key):
    directory = Path(directory)
    require({p.name for p in directory.iterdir()} == set(FILES),
            "The public bundle must contain exactly the four release files")
    require(all((directory / name).is_file() and not (directory / name).is_symlink()
                for name in FILES), "Release assets must be regular files")
    require(all((directory / name).stat().st_size <= MAX_SIZE for name in FILES),
            "Release asset exceeds the size limit")
    assets = {name: (directory / name).read_bytes() for name in FILES}
    fields = verify_catalog(assets["updates.txt"], public_key)
    require(len(assets[FILES[0]]) == int(fields["windows.size"]), "Executable size mismatch")
    require(digest(assets[FILES[0]]) == fields["windows.sha256"], "Executable digest mismatch")
    require(assets[FILES[0]].startswith(b"MZ"), "Not a Windows executable")
    require(assets["icon.png"].startswith(b"\x89PNG\r\n\x1a\n"), "Not a PNG icon")
    page = assets["index.html"].decode("utf-8")
    require(FILES[0] in page and fields["windows.name"] in page, "Release page version mismatch")
    return Bundle(fields["windows.name"], int(fields["windows.code"]), assets)


class SafeRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        require(urlsplit(new_url).scheme == "https", "Refusing an insecure redirect")
        redirected = super().redirect_request(request, response, code, message, headers, new_url)
        if redirected and urlsplit(new_url).netloc != urlsplit(request.full_url).netloc:
            redirected.remove_header("Authorization")
        return redirected


class GitHub:
    def __init__(self, repository, token):
        require(repository == REPOSITORY, "Unexpected release repository")
        require(bool(token), "GITHUB_TOKEN is required for publication")
        self.repository = repository
        self.token = token
        self.opener = build_opener(SafeRedirect())

    def request(self, method, path, data=None, *, upload=False, binary=False, missing=False):
        host = "uploads.github.com" if upload else "api.github.com"
        url = "https://" + host + "/repos/" + self.repository + path
        headers = {
            "Authorization": "Bearer " + self.token,
            "Accept": "application/octet-stream" if binary else "application/vnd.github+json",
            "X-GitHub-Api-Version": "2026-03-10",
            "User-Agent": "FPV-signed-release",
        }
        if isinstance(data, dict):
            data = json.dumps(data).encode()
            headers["Content-Type"] = "application/json"
        elif data is not None:
            headers["Content-Type"] = "application/octet-stream"
        try:
            with self.opener.open(Request(url, data=data, headers=headers, method=method),
                                  timeout=120) as response:
                raw = response.read(MAX_SIZE + 1)
        except HTTPError as error:
            if missing and error.code == 404:
                return None
            raise RuntimeError(f"GitHub {method} {path}: HTTP {error.code}") from None
        require(len(raw) <= MAX_SIZE, "GitHub response exceeds the size limit")
        return raw if binary else json.loads(raw) if raw else None

    def latest(self):
        return self.request("GET", "/releases/latest", missing=True)

    def find(self, tag):
        release = self.request("GET", "/releases/tags/" + quote(tag, safe=""), missing=True)
        if release:
            return release
        # Authorized listing also includes a previous partially uploaded draft.
        return next((r for r in self.request("GET", "/releases?per_page=100")
                     if r["tag_name"] == tag), None)

    def download(self, asset):
        return self.request("GET", "/releases/assets/" + str(asset["id"]), binary=True)

    def create(self, bundle, notes, commit):
        return self.request("POST", "/releases", {
            "tag_name": bundle.tag, "target_commitish": commit,
            "name": "FPV Комісія — ПК " + bundle.version,
            "body": notes, "draft": True, "prerelease": False,
        })

    def release(self, release_id):
        return self.request("GET", "/releases/" + str(release_id))

    def delete_asset(self, asset):
        return self.request("DELETE", "/releases/assets/" + str(asset["id"]))

    def upload(self, release_id, name, raw):
        return self.request("POST", f"/releases/{release_id}/assets?name=" + quote(name, safe=""),
                            raw, upload=True)

    def publish(self, release_id):
        return self.request("PATCH", "/releases/" + str(release_id), {
            "draft": False, "prerelease": False, "make_latest": "true",
        })


def ensure_newer(client, bundle, public_key):
    latest = client.latest()
    if latest:
        catalogs = [a for a in latest["assets"] if a["name"] == "updates.txt"]
        require(len(catalogs) == 1, "Latest release has no unique signed catalog")
        fields = verify_catalog(client.download(catalogs[0]), public_key)
        current = int(fields["windows.code"])
        same = (latest["tag_name"] == bundle.tag
                and fields["windows.name"] == bundle.version and current == bundle.code)
        require(same or bundle.code > current, "Refusing to replace latest with an older build")
    return latest


def publish_bundle(client, bundle, public_key, notes, commit):
    ensure_newer(client, bundle, public_key)
    release = client.find(bundle.tag) or client.create(bundle, notes, commit)
    release_id = release["id"]
    existing = {a["name"]: a for a in release["assets"]}
    require(len(existing) == len(release["assets"]) and set(existing).issubset(FILES),
            "Unexpected assets in the target release")
    for name, raw in bundle.assets.items():
        asset = existing.get(name)
        if asset and client.download(asset) != raw:
            require(release["draft"], "Published release differs; use a new version")
            client.delete_asset(asset)
            asset = None
        if not asset:
            require(release["draft"], "Published release is incomplete; use a new version")
            asset = client.upload(release_id, name, raw)
        require(asset["size"] == len(raw) and asset["state"] == "uploaded",
                "Asset upload did not complete: " + name)
        require(client.download(asset) == raw, "Uploaded bytes differ: " + name)
        print("Verified asset:", name, digest(raw))
    complete = client.release(release_id)
    require({a["name"] for a in complete["assets"]} == set(FILES)
            and len(complete["assets"]) == len(FILES), "Release is incomplete")
    latest = ensure_newer(client, bundle, public_key)
    if release["draft"] or not latest or latest["id"] != release_id:
        client.publish(release_id)
    latest = client.latest()
    require(latest and latest["id"] == release_id and not latest["draft"],
            "Latest release did not switch")
    for asset in latest["assets"]:
        require(client.download(asset) == bundle.assets[asset["name"]],
                "Published asset differs: " + asset["name"])
    print("Published and verified:", bundle.tag)
    return latest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory")
    parser.add_argument("--public-key", default=str(Path(__file__).with_name("update-public.pem")))
    parser.add_argument("--notes", default="release-notes.md")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    bundle = read_bundle(args.directory, args.public_key)
    print("Verified signed bundle:", bundle.version, "build", bundle.code)
    if args.verify_only:
        return
    client = GitHub(os.environ.get("GITHUB_REPOSITORY", REPOSITORY),
                    os.environ.get("GITHUB_TOKEN"))
    published = publish_bundle(client, bundle, args.public_key,
                               Path(args.notes).read_text(encoding="utf-8"),
                               os.environ.get("GITHUB_SHA", "main"))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as stream:
            stream.write(f"Published [{bundle.tag}]({published['html_url']}) / build {bundle.code}.\n")


if __name__ == "__main__":
    main()
