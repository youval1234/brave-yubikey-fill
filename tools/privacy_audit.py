"""Local pattern checks; prints locations/categories, never matched values.

This is a repeatable privacy aid, not proof that all secrets are absent.
"""
import argparse
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import zipfile

CHECKS = {
    "private-key": rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----",
    "access-token": rb"(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{30,}|AIza[A-Za-z0-9_-]{30,})",
    "email": rb"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b",
    "personal-path": rb"(?i)[A-Z]:[\\/](?:Users|home)[\\/](?!Public|Default|YOUR_USERNAME)[^\\/\s\"']+",
    "otp-seed-uri": rb"otpauth://(?:totp|hotp)/[^\s\"']+",
    "secret-literal": rb"(?i)(?:password|api[_-]?key|secret|token)\s*[:=]\s*[\"'][A-Za-z0-9_+/-]{16,}[\"']",
    "auth-query": rb"(?i)(?:state|token|session|nonce)=[A-Za-z0-9_-]{24,}",
}
PATTERNS = {name: re.compile(pattern) for name, pattern in CHECKS.items()}
BLOCKED_NAMES = {".env", "native-host.json", "origin.txt", "hosts.yml", "credentials"}
BLOCKED_SUFFIXES = {".pem", ".key", ".pfx", ".p12", ".db", ".sqlite", ".sqlite3", ".log", ".exe", ".pyc"}


def git(*args):
    return subprocess.check_output(["git", *args])


def scan(name, data, findings, source):
    path = PurePosixPath(name)
    if (path.name in BLOCKED_NAMES or path.name.startswith(".env.") or path.suffix.lower() in BLOCKED_SUFFIXES
            or name.endswith(".local.json")
            or any(part in path.parts for part in (".git", ".artifacts", ".venv", "venv", "__pycache__"))):
        findings.append({"source": source, "path": name, "category": "private-or-generated-file"})
    if data.startswith(b"\x89PNG"):
        return  # Images need separate visual/metadata review.
    for category, pattern in PATTERNS.items():
        for match in pattern.finditer(data):
            if category == "email":
                domain = match.group().rsplit(b"@", 1)[-1].lower()
                if domain == b"users.noreply.github.com" or domain.endswith((b".test", b".example")):
                    continue
            findings.append({"source": source, "path": name, "category": category,
                             "line": data[:match.start()].count(b"\n") + 1})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", action="store_true")
    parser.add_argument("--archive", action="append", default=[])
    args = parser.parse_args()
    findings, seen = [], set()
    files = git("ls-files", "-z").decode().split("\0")
    checked = 0
    for name in filter(None, files):
        scan(name, Path(name).read_bytes(), findings, "working-tree")
        checked += 1
    if args.history:
        for entry in git("rev-list", "--objects", "--all").decode().splitlines():
            oid, _, name = entry.partition(" ")
            if not name or oid in seen:
                continue
            seen.add(oid)
            if git("cat-file", "-t", oid).strip() != b"blob":
                continue
            scan(name, git("cat-file", "blob", oid), findings, oid)
            checked += 1
    for archive in args.archive:
        with zipfile.ZipFile(archive) as package:
            for item in package.infolist():
                if item.is_dir():
                    continue
                name = item.filename
                if PurePosixPath(name).is_absolute() or ".." in PurePosixPath(name).parts or "\\" in name or ":" in name:
                    findings.append({"source": Path(archive).name, "path": name, "category": "unsafe-archive-path"})
                scan(name, package.read(item), findings, Path(archive).name)
                checked += 1
    print(json.dumps({"checkedFileVersions": checked, "findings": findings}, indent=2))
    return bool(findings)


if __name__ == "__main__":
    raise SystemExit(main())
