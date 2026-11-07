"""Package the committed project and extension only; never local runtime files."""
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile


def git(*args):
    return subprocess.check_output(["git", *args])


def main():
    if git("status", "--porcelain").strip():
        raise SystemExit("Commit reviewed changes before packaging a release.")
    version = json.loads(git("show", "HEAD:extension/manifest.json"))["version"]
    target = Path(".artifacts/releases", version)
    target.mkdir(parents=True, exist_ok=True)
    source = target / ("yubikey-fill-source-" + version + ".zip")
    extension = target / ("yubikey-fill-extension-" + version + ".zip")
    source.write_bytes(git("archive", "--format=zip", "--prefix=yubikey-fill-" + version + "/", "HEAD"))
    extension.write_bytes(git("archive", "--format=zip", "HEAD:extension"))
    with zipfile.ZipFile(extension, "a", compression=zipfile.ZIP_DEFLATED) as package:
        notice = zipfile.ZipInfo("LICENSE", package.infolist()[0].date_time)
        notice.compress_type = zipfile.ZIP_DEFLATED
        notice.external_attr = 0o100644 << 16
        package.writestr(notice, git("show", "HEAD:LICENSE"))
    sums = "".join(hashlib.sha256(file.read_bytes()).hexdigest() + "  " + file.name + "\n"
                   for file in [source, extension])
    (target / "SHA256SUMS.txt").write_text(sums, encoding="ascii")
    print(target.as_posix())


if __name__ == "__main__":
    main()
