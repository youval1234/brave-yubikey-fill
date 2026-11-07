import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseDetails } from "../extension/updates.js";

const prefix = "https://github.com/youval1234/brave-yubikey-fill/releases/tag/";
const response = version => ({ ok: true, version, releaseUrl: prefix + "v" + version });

test("release versions compare numerically and support a fourth component", () => {
  for (const [latest, installed, newer] of [
    ["0.7.10", "0.7.3", true], ["0.7.3", "0.7.3", false],
    ["0.7.2", "0.7.3", false], ["0.7.3.1", "0.7.3", true],
    ["0.7.3", "0.7.3.0", false],
  ]) assert.equal(releaseDetails(response(latest), installed).newer, newer);
});

test("release links stay on the exact repository and agree with the version", () => {
  for (const url of [
    "javascript:alert(1)", "https://github.com.attacker.test/releases/tag/v0.7.4",
    "https://github.com/another/repository/releases/tag/v0.7.4",
    prefix + "v0.7.5", prefix + "v0.7.4?token=example", prefix + "v0.7.4#fragment",
  ]) assert.equal(releaseDetails({ ...response("0.7.4"), releaseUrl: url }, "0.7.3"), null);
});

test("malformed, prerelease, oversized and failed release metadata is rejected", () => {
  for (const version of ["0.7.4-beta", "00.7.4", "0.7", "65536.0.1", "1.2.3.4.5", "<script>", null]) {
    assert.equal(releaseDetails(response(version), "0.7.3"), null);
  }
  assert.equal(releaseDetails({ ...response("0.7.4"), ok: false }, "0.7.3"), null);
  assert.equal(releaseDetails(response("0.7.4"), "invalid"), null);
});
