import assert from "node:assert/strict";
import { test } from "node:test";
import "../extension/field.js";

const { probe, fill: fillField, markClick } = globalThis.yubiKeyFillField;

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
  state = { binding, current: { ...tab, active: true }, focused: true, probe: true, permitted: true };
  globalThis.chrome = {
    action: {
      onClicked: listener(),
      setBadgeText: async () => {},
      setTitle: async ({ title }) => events.push(["status", title]),
    },
    storage: {
      onChanged: listener(),
      local: {
        get: async (key) => key === "site:" + site ? { [key]: state.binding } : {},
        setAccessLevel: async () => {},
      },
    },
    permissions: {
      contains: async () => state.permitted,
      onAdded: listener(),
      onRemoved: listener(),
    },
    tabs: {
      get: async () => state.current,
      onUpdated: listener(),
      onActivated: listener(),
    },
    windows: { get: async () => ({ focused: state.focused }) },
    scripting: {
      executeScript: async ({ target, args, files }) => {
        if (files) return [{ documentId: "original-document" }];
        if (args.length === 4) {
          events.push(["fill", target.documentIds, args[2]]);
          return [{ result: true }];
        }
        events.push(["probe", target.documentIds]);
        return [{ documentId: "original-document", result: state.probe }];
      },
    },
    runtime: {
      id: "test-extension",
      onInstalled: listener(),
      onStartup: listener(),
      onMessage: listener(),
      sendNativeMessage: async (_host, request) => {
        events.push(["request", request]);
        state.duringTouch?.();
        return { ok: true, code, expiresAt: Date.now() + 20_000 };
      },
    },
  };
}

reset();
const { fill, handlePrompt } = await import("../extension/worker.js");

const sender = {
  id: "test-extension", url: tab.url, origin: site, frameId: 0,
  documentId: "original-document", documentLifecycle: "active", tab,
};

test("only requests the approved credential and targets the original document", async () => {
  reset();
  await fill(tab);
  assert.deepEqual(events.filter(([type]) => type !== "status"), [
    ["probe", ["original-document"]],
    ["request", { op: "code", device: binding.device, id: binding.id }],
    ["fill", ["original-document"], code],
  ]);
});

test("inline discovery reports eligibility without calling the helper or exposing account metadata", async () => {
  reset();
  state.binding = { ...binding, prompt: true, touchRequired: false };
  assert.deepEqual(await handlePrompt({ kind: "prompt-status" }, sender), { ok: true });
  assert.deepEqual(events, []);
});

test("only a saved no-touch pairing opts out of touch at the helper", async () => {
  reset();
  state.binding = { ...binding, prompt: true, touchRequired: false };
  const result = await handlePrompt({ kind: "prompt-fill", id: "untrusted" }, sender);
  assert.equal(result.ok, true);
  assert.deepEqual(events.find(([type]) => type === "request")[1], {
    op: "code", device: binding.device, id: binding.id, requireTouch: false,
  });
  assert.ok(events.some(([type]) => type === "fill"));
});

test("inline fill rejects foreign senders, opaque origins, nested frames, cached pages and unapproved ports", async () => {
  for (const changes of [
    { id: "attacker" }, { origin: "null" }, { frameId: 1 }, { documentLifecycle: "cached" },
    { documentId: undefined },
    { url: "https://login.example.test:444/challenge", origin: "https://login.example.test:444" },
  ]) {
    reset();
    state.binding = { ...binding, prompt: true };
    assert.equal((await handlePrompt({ kind: "prompt-fill" }, { ...sender, ...changes })).ok, false);
    assert.equal(events.some(([type]) => type === "request"), false);
  }
});

test("inline fill keeps codes out of replies and blocks revocation before or during touch", async () => {
  reset();
  state.binding = { ...binding, prompt: true };
  const reply = await handlePrompt({ kind: "prompt-fill", id: "attacker-chosen" }, sender);
  assert.deepEqual(reply, { ok: true, message: "Code filled. Review the form and submit." });
  assert.deepEqual(events.find(([type]) => type === "request")[1], {
    op: "code", device: binding.device, id: binding.id,
  });
  for (const revokeDuringTouch of [false, true]) {
    reset();
    state.binding = { ...binding, prompt: true };
    if (revokeDuringTouch) state.duringTouch = () => { state.permitted = false; };
    else state.permitted = false;
    assert.equal((await handlePrompt({ kind: "prompt-fill" }, sender)).ok, false);
    assert.equal(events.some(([type]) => type === "request"), revokeDuringTouch);
    assert.equal(events.some(([type]) => type === "fill"), false);
  }
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
    () => { state.binding = { ...binding, touchRequired: false }; },
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
  globalThis.Element = class {
    getAttribute(name) { return this.attributes?.[name] || null; }
  };
  globalThis.getComputedStyle = () => ({ visibility: "visible" });
  globalThis.document = {
    visibilityState: "visible",
    fields: [input],
    querySelectorAll: (selector) => selector.startsWith("button") ? document.overrides || [] : document.fields,
  };
  return input;
}

test("writes a dummy code and dispatches input without submitting", () => {
  const input = setupPage();
  assert.equal(probe(tab.url, "gesture"), true);
  assert.equal(fillField(tab.url, "gesture", code, Date.now() + 20_000), true);
  assert.equal(input.value, code);
  assert.deepEqual(input.events, ["input"]);
});

test("rejects an ambiguous field, an off-site form and a hidden document", () => {
  const input = setupPage();
  document.fields = [input, new Input()];
  assert.equal(probe(tab.url, "gesture"), false);
  document.fields = [input];
  input.form = { action: input, attributes: { action: "https://attacker.test/" } };
  assert.equal(probe(tab.url, "gesture"), false);
  input.form = null;
  document.visibilityState = "hidden";
  assert.equal(probe(tab.url, "gesture"), false);
});

test("rejects a replacement field and a code about to expire", () => {
  const input = setupPage();
  assert.equal(probe(tab.url, "gesture"), true);
  const replacement = new Input();
  document.fields = [replacement];
  assert.equal(fillField(tab.url, "gesture", code, Date.now() + 20_000), false);
  assert.equal(input.value, "");
  assert.equal(replacement.value, "");
  assert.equal(probe(tab.url, "gesture"), true);
  assert.equal(fillField(tab.url, "gesture", code, Date.now() + 1_000), false);
});

test("inline fill requires a one-use click marker bound to the exact field", () => {
  const input = setupPage();
  assert.equal(probe(tab.url, "gesture", true), false);
  markClick(input);
  document.fields = [new Input()];
  assert.equal(probe(tab.url, "gesture", true), false);
  document.fields = [input];
  assert.equal(probe(tab.url, "gesture", true), false);
  markClick(input);
  assert.equal(probe(tab.url, "gesture", true), true);
});

test("blocks off-site submit buttons and relative actions resolved against an off-site base", () => {
  const input = setupPage();
  input.form = { attributes: { action: "/verify" } };
  document.overrides = [{ form: input.form, attributes: { formaction: "//attacker.test/otp" } }];
  assert.equal(probe(tab.url, "gesture"), false);
  document.overrides = [];
  document.baseURI = "https://attacker.test/";
  assert.equal(probe(tab.url, "gesture"), false);
});
