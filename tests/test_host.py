import io
import struct
import unittest
from time import time
from unittest.mock import Mock

from yubikit.oath import Code, Credential, OATH_TYPE

from host.yubikey_fill_host import HostError, frame, process_request, read_request


DEVICE = "A" * 22
TOUCH = Credential(DEVICE, b"Demo:touch", "Demo", "touch", OATH_TYPE.TOTP, 30, True)
NO_TOUCH = Credential(DEVICE, b"no-touch", None, "no-touch", OATH_TYPE.TOTP, 30, False)
COUNTER = Credential(DEVICE, b"counter", None, "counter", OATH_TYPE.HOTP, 0, True)


class HostTest(unittest.TestCase):
    def setUp(self):
        self.session = Mock(device_id=DEVICE, locked=False)
        self.session.calculate_all.return_value = {TOUCH: None, NO_TOUCH: None, COUNTER: None}

    def request(self, entry=TOUCH, device=DEVICE):
        return {"op": "code", "device": device, "id": entry.id.hex()}

    def test_native_messages_validate_the_exact_schema(self):
        self.assertEqual(read_request(io.BytesIO(frame(self.request()))), self.request())
        request = {**self.request(NO_TOUCH), "requireTouch": False}
        self.assertEqual(read_request(io.BytesIO(frame(request))), request)
        for bad in (
            {"op": "code"}, {"op": "accounts", "password": "dummy"},
            {**request, "requireTouch": "false"}, {**request, "requireTouch": 0}, [],
        ):
            with self.assertRaises(HostError):
                read_request(io.BytesIO(frame(bad)))
        with self.assertRaises(HostError):
            read_request(io.BytesIO(struct.pack("<I", 10) + b"{}"))

    def test_enrollment_lists_totp_metadata_with_and_without_touch(self):
        response = process_request({"op": "accounts"}, self.session)
        self.assertEqual(response, {"ok": True, "accounts": [
            {"device": DEVICE, "id": TOUCH.id.hex(), "label": "Demo · touch", "touchRequired": True},
            {"device": DEVICE, "id": NO_TOUCH.id.hex(), "label": "no-touch", "touchRequired": False},
        ]})
        self.session.calculate_all.assert_called_once_with(timestamp=1)
        self.session.calculate_code.assert_not_called()

    def test_passive_discovery_does_not_open_a_password_dialog(self):
        self.session.locked = True
        with self.assertRaisesRegex(HostError, "locked"):
            process_request({"op": "discover"}, self.session)
        self.session.validate.assert_not_called()
        self.session.calculate_all.assert_not_called()

    def test_preview_preserves_password_and_touch_requirements(self):
        request = {**self.request(), "op": "preview", "requireTouch": False}
        with self.assertRaisesRegex(HostError, "touch"):
            process_request(request, self.session)
        self.session.calculate_code.assert_not_called()
        self.session.locked = True
        with self.assertRaisesRegex(HostError, "locked"):
            process_request(request, self.session)
        self.session.validate.assert_not_called()

    def test_preview_returns_validity_window_for_no_touch_account(self):
        expiry = int(time()) + 1
        self.session.calculate_code.return_value = Code("012345", expiry - 30, expiry)
        request = {**self.request(NO_TOUCH), "op": "preview", "requireTouch": False}
        self.assertEqual(process_request(request, self.session), {
            "ok": True, "code": "012345", "expiresAt": expiry * 1000,
            "startsAt": (expiry - 30) * 1000,
        })

    def test_legacy_touch_pairing_cannot_be_downgraded(self):
        with self.assertRaisesRegex(HostError, "touch"):
            process_request(self.request(NO_TOUCH), self.session)
        self.session.calculate_code.assert_not_called()

    def test_counter_based_accounts_are_rejected_even_without_touch(self):
        with self.assertRaisesRegex(HostError, "credential"):
            process_request({**self.request(COUNTER), "requireTouch": False}, self.session)
        self.session.calculate_code.assert_not_called()

    def test_wrong_key_is_rejected_before_any_credential_query(self):
        with self.assertRaisesRegex(HostError, "device"):
            process_request(self.request(device="B" * 22), self.session)
        self.session.calculate_all.assert_not_called()

    def test_calculates_only_the_requested_code_and_preserves_leading_zero(self):
        expiry = int(time()) + 20
        self.session.calculate_code.return_value = Code("012345", expiry - 30, expiry)
        self.assertEqual(process_request(self.request(), self.session), {
            "ok": True, "code": "012345", "expiresAt": expiry * 1000
        })
        self.session.calculate_code.assert_called_once_with(TOUCH)

    def test_calculates_the_selected_no_touch_account(self):
        expiry = int(time()) + 20
        self.session.calculate_code.return_value = Code("012345", expiry - 30, expiry)
        request = {**self.request(NO_TOUCH), "requireTouch": False}
        self.assertEqual(process_request(request, self.session), {
            "ok": True, "code": "012345", "expiresAt": expiry * 1000
        })
        self.session.calculate_code.assert_called_once_with(NO_TOUCH)

    def test_declines_code_about_to_expire(self):
        expiry = int(time()) + 1
        self.session.calculate_code.return_value = Code("012345", expiry - 30, expiry)
        with self.assertRaisesRegex(HostError, "expired"):
            process_request(self.request(), self.session)


if __name__ == "__main__":
    unittest.main()
