import assert from "node:assert/strict";
import { test } from "node:test";
import { otpField } from "../extension/field.js";

const site = "https://login.example.test";
const tab = { id: 7, windowId: 4, url: site + "/challenge" };
const binding = { device: "test-device", id: "ab" };
const code = "012345";

function listener() {
  const callbacks = new Set();
  return {
    addListener: (callback) => callbacks.add(callback),
    removeListener: (callback) => callbacks.delete(callback),
    emit: (...args) => callbacks.forEach((callback) => callback(...args)),
  };
}

let events;
let state;
function reset() {
  events = [];
  state = { binding, current: { ...tab, active: true }, focused: true, probe: true };
  globalThis.chrome = {
    action: {
      onClicked: listener(),
      setBadgeText: async () => {},
      setTitle: async ({ title }) => events.push(["status", title]),
    },
    storage: { local: { get: async (key) => key === "site:" + site ? { [key]: state.binding } : {} } },
    tabs: {
      get: async () => state.current,
      onUpdated: listener(),
      onActivated: listener(),
    },
    windows: { get: async () => ({ focused: state.focused }) },
    scripting: {
      executeScript: async ({ target, args }) => {
        if (target.documentIds) {
          events.push(["fill", target.documentIds, args[2]]);
          return [{ result: true }];
        }
        events.push(["probe"]);
        return [{ documentId: "original-document", result: state.probe }];
      },
    },
    runtime: {
      sendNativeMessage: async (_host, request) => {
        events.push(["request", request]);
        state.duringTouch?.();
        return { ok: true, code, expiresAt: Date.now() + 20_000 };
      },
    },
  };
}

reset();
const { fill } = await import("../extension/worker.js");

test("only requests the approved credential and targets the original document", async () => {
  reset();
  await fill(tab);
  assert.deepEqual(events.filter(([type]) => type !== "status"), [
    ["probe"],
    ["request", { op: "code", device: binding.device, id: binding.id }],
    ["fill", ["original-document"], code],
  ]);
});

test("a lookalike domain, a subdomain and HTTP never reach the helper", async () => {
  for (const url of [site + ".attacker.test", "https://other.login.example.test", "http://login.example.test"]) {
    reset();
    await fill({ ...tab, url });
    assert.deepEqual(events.map(([type]) => type), ["status"]);
  }
});

test("missing field never reaches the helper", async () => {
  reset();
  state.probe = false;
  await fill(tab);
  assert.deepEqual(events.map(([type]) => type), ["probe", "status"]);
});

test("navigation, switching tabs, lost focus and revoked approval block the fill", async () => {
  for (const action of [
    () => chrome.tabs.onUpdated.emit(tab.id, { status: "loading" }),
    () => chrome.tabs.onActivated.emit({ tabId: 8, windowId: tab.windowId }),
    () => { state.current.pendingUrl = site + "/next"; },
    () => { state.current.url = site + "/next"; },
    () => { state.focused = false; },
    () => { state.binding = undefined; },
  ]) {
    reset();
    state.duringTouch = action;
    await fill(tab);
    assert.equal(events.filter(([type]) => type === "request").length, 1);
    assert.equal(events.some(([type]) => type === "fill"), false);
  }
});

class Input {
  constructor() {
    this.type = "text";
    this.maxLength = 6;
    this.events = [];
  }
  get value() { return this.contents || ""; }
  set value(value) { this.contents = value; }
  matches() { return false; }
  closest() { return null; }
  getClientRects() { return [{}]; }
  dispatchEvent(event) { this.events.push(event.type); }
}

function setupPage() {
  const input = new Input();
  globalThis.location = new URL(tab.url);
  globalThis.window = {};
  window.top = window;
  globalThis.HTMLInputElement = Input;
  globalThis.getComputedStyle = () => ({ visibility: "visible" });
  globalThis.document = {
    visibilityState: "visible",
    fields: [input],
    querySelectorAll: () => document.fields,
  };
  return input;
}

test("writes a dummy code and dispatches input without submitting", () => {
  const input = setupPage();
  assert.equal(otpField(tab.url, "gesture"), true);
  assert.equal(otpField(tab.url, "gesture", code, Date.now() + 20_000), true);
  assert.equal(input.value, code);
  assert.deepEqual(input.events, ["input"]);
});

test("rejects an ambiguous field, an off-site form and a hidden document", () => {
  const input = setupPage();
  document.fields = [input, new Input()];
  assert.equal(otpField(tab.url, "gesture"), false);
  document.fields = [input];
  input.form = { action: "https://attacker.test/" };
  assert.equal(otpField(tab.url, "gesture"), false);
  input.form = null;
  document.visibilityState = "hidden";
  assert.equal(otpField(tab.url, "gesture"), false);
});

test("rejects a replacement field and a code about to expire", () => {
  const input = setupPage();
  assert.equal(otpField(tab.url, "gesture"), true);
  const replacement = new Input();
  document.fields = [replacement];
  assert.equal(otpField(tab.url, "gesture", code, Date.now() + 20_000), false);
  assert.equal(input.value, "");
  assert.equal(replacement.value, "");
  assert.equal(otpField(tab.url, "gesture"), true);
  assert.equal(otpField(tab.url, "gesture", code, Date.now() + 1_000), false);
});
