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
    if request == {"op": "accounts"}:
        return request
    code_fields = {"op", "device", "id"}
    if (request.keys() in (code_fields, code_fields | {"requireTouch"}) and request["op"] == "code"
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

    if request["op"] == "code" and request["device"] != session.device_id:
        raise HostError("device")
    unlock(session)

    # LIST omits touch policy. CALCULATE ALL reports it. Use an expired
    # timestamp so unrelated credentials never yield current codes.
    credentials = sorted(
        credential for credential in session.calculate_all(timestamp=1)
        if credential.oath_type == OATH_TYPE.TOTP
    )
    if request["op"] == "accounts":
        return {"ok": True, "accounts": [
            {"device": session.device_id, "id": entry.id.hex(),
             "label": " · ".join(filter(None, (entry.issuer, entry.name))),
             "touchRequired": entry.touch_required is True}
            for entry in credentials
        ]}

    credential = next((entry for entry in credentials if entry.id.hex() == request["id"]), None)
    if credential is None:
        raise HostError("credential")
    if request.get("requireTouch", True) and credential.touch_required is not True:
        raise HostError("touch")

    code = session.calculate_code(credential)
    if code.valid_to - time() <= 3:
        raise HostError("expired")
    if not re.fullmatch(r"[0-9]{6,8}", code.value):
        raise HostError("hardware")
    return {"ok": True, "code": code.value, "expiresAt": code.valid_to * 1000}


def handle(request):
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
