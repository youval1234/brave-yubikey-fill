"""One request per process. Stdout is reserved for framed Native Messaging."""
import json
import logging
import re
import struct
import sys
from time import time

MAX_REQUEST = 4096
MAX_RESPONSE = 65536


class HostError(Exception):
    pass


def read_request(stream):
    size = struct.unpack("<I", stream.read(4))[0]
    if not 1 <= size <= MAX_REQUEST:
        raise HostError("host")
    body = stream.read(size)
    if len(body) != size:
        raise HostError("host")
    request = json.loads(body.decode("utf-8"))
    if not isinstance(request, dict):
        raise HostError("host")
    if request in ({"op": "accounts"}, {"op": "discover"}, {"op": "update-check"}):
        return request
    code_fields = {"op", "device", "id"}
    if (request.keys() in (code_fields, code_fields | {"requireTouch"}) and request["op"] in ("code", "preview")
            and isinstance(request.get("requireTouch", True), bool)
            and isinstance(request["device"], str)
            and re.fullmatch(r"[A-Za-z0-9+/]{22}", request["device"])
            and isinstance(request["id"], str)
            and re.fullmatch(r"(?:[0-9a-f]{2}){1,64}", request["id"])):
        return request
    raise HostError("host")


def unlock(session):
    if not session.locked:
        return
    import tkinter as tk
    from tkinter import simpledialog
    from yubikit.core.smartcard import ApduError

    window = tk.Tk()
    window.withdraw()
    try:
        password = simpledialog.askstring(
            "YubiKey Fill",
            "Enter the OATH password for your YubiKey.",
            show="*",
            parent=window,
        )
    finally:
        window.destroy()
    if password is None:
        raise HostError("cancelled")
    try:
        session.validate(session.derive_key(password))
    except ApduError:
        raise HostError("password") from None


def process_request(request, session):
    from yubikit.oath import OATH_TYPE

    if request["op"] in ("code", "preview") and request["device"] != session.device_id:
        raise HostError("device")
    if request["op"] in ("discover", "preview") and session.locked:
        raise HostError("locked")
    unlock(session)

    # LIST omits touch policy. CALCULATE ALL reports it. Use an expired
    # timestamp so unrelated credentials never yield current codes.
    credentials = sorted(
        credential for credential in session.calculate_all(timestamp=1)
        if credential.oath_type == OATH_TYPE.TOTP
    )
    if request["op"] in ("accounts", "discover"):
        return {"ok": True, "accounts": [
            {"device": session.device_id, "id": entry.id.hex(),
             "label": " · ".join(filter(None, (entry.issuer, entry.name))),
             "touchRequired": entry.touch_required is True}
            for entry in credentials
        ]}

    credential = next((entry for entry in credentials if entry.id.hex() == request["id"]), None)
    if credential is None:
        raise HostError("credential")
    if request["op"] == "preview" and credential.touch_required is not False:
        raise HostError("touch")
    if request.get("requireTouch", True) and credential.touch_required is not True:
        raise HostError("touch")

    code = session.calculate_code(credential)
    if code.valid_to - time() <= (0 if request["op"] == "preview" else 3):
        raise HostError("expired")
    if not re.fullmatch(r"[0-9]{6,8}", code.value):
        raise HostError("hardware")
    result = {"ok": True, "code": code.value, "expiresAt": code.valid_to * 1000}
    if request["op"] == "preview":
        result["startsAt"] = code.valid_from * 1000
    return result


def check_update():
    # Only a fixed, read-only endpoint is available. Authentication stays in gh's
    # local credential store; neither a token nor arbitrary CLI arguments enter
    # the extension or Native Messaging protocol.
    import os
    from pathlib import Path
    import subprocess

    try:
        config = json.loads(Path(__file__).with_name("github-cli.local.json").read_text(encoding="utf-8"))
        executable = Path(config["path"])
        if not executable.is_absolute() or executable.name.lower() != "gh.exe" or not executable.is_file():
            raise HostError("updates")
        env = dict(os.environ)
        env.pop("GH_DEBUG", None)
        env.update(GH_PROMPT_DISABLED="1", GH_NO_UPDATE_NOTIFIER="1", GH_NO_EXTENSION_UPDATE_NOTIFIER="1")
        response = subprocess.run([
            str(executable), "api", "--hostname", "github.com",
            "repos/youval1234/brave-yubikey-fill/releases/latest",
            "--jq", "{tag: .tag_name, draft: .draft, prerelease: .prerelease}",
        ], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=15, check=False, env=env, creationflags=subprocess.CREATE_NO_WINDOW)
        if response.returncode or len(response.stdout) > 4096:
            raise HostError("updates")
        release = json.loads(response.stdout)
        if not isinstance(release, dict):
            raise HostError("updates")
        tag = release.get("tag")
        if (release.get("draft") is not False or release.get("prerelease") is not False
                or not isinstance(tag, str) or not re.fullmatch(r"v?\d{1,5}(?:\.\d{1,5}){2,3}", tag)):
            raise HostError("updates")
        version = tag.removeprefix("v")
        parts = version.split(".")
        if any(int(part) > 65535 or (len(part) > 1 and part.startswith("0")) for part in parts):
            raise HostError("updates")
        return {"ok": True, "version": version,
                "releaseUrl": "https://github.com/youval1234/brave-yubikey-fill/releases/tag/" + tag}
    except HostError:
        raise
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired):
        raise HostError("updates") from None


def handle(request):
    if request["op"] == "update-check":
        return check_update()
    from smartcard.ExclusiveConnectCardConnection import ExclusiveConnectCardConnection
    from ykman.pcsc import ScardSmartCardConnection, list_readers
    from yubikit.oath import OathSession

    readers = [reader for reader in list_readers()
               if reader.name.casefold().startswith("yubico yubikey")]
    if len(readers) != 1:
        raise HostError("device")

    # Require an exclusive card connection so the credential can't be
    # replaced between checking its touch policy and calculating the code.
    card = ExclusiveConnectCardConnection(readers[0].createConnection())
    with ScardSmartCardConnection(card) as connection:
        return process_request(request, OathSession(connection))


def frame(result):
    data = json.dumps(result, ensure_ascii=True, separators=(",", ":")).encode("ascii")
    if len(data) > MAX_RESPONSE:
        return frame({"ok": False, "error": "host"})
    return struct.pack("<I", len(data)) + data


def main():
    logging.disable(logging.CRITICAL)
    try:
        request = read_request(sys.stdin.buffer)
        result = handle(request)
    except HostError as error:
        result = {"ok": False, "error": str(error)}
    except (UnicodeError, ValueError, struct.error):
        result = {"ok": False, "error": "host"}
    except Exception:
        # Exceptions from the SDK can contain APDU or credential data.
        result = {"ok": False, "error": "hardware"}
    sys.stdout.buffer.write(frame(result))
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    main()
