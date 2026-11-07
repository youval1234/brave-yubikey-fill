import assert from "node:assert/strict";
import { test } from "node:test";
import "../extension/field.js";
import { matchingAccounts, suggestionsForAccounts } from "../extension/matching.js";

const { probe, fill: fillField, markClick } = globalThis.yubiKeyFillField;

const site = "https://login.example.test";
const tab = { id: 7, windowId: 4, url: site + "/challenge" };
const binding = { device: "test-device", id: "ab", label: "Demo" };
const code = "012345";

test("suggests the Amazon account on the exact Amazon origin", () => {
  const accounts = [{ label: "GitHub · demo" }, { label: "Amazon · demo" }];
  assert.deepEqual(matchingAccounts("https://www.amazon.com", accounts), [1]);
  for (const origin of [
    "https://www.amazon.com.attacker.test", "https://amazon.attacker.test",
    "https://attacker-amazon.com", "https://www.amazon.com:444",
  ]) assert.deepEqual(matchingAccounts(origin, accounts), []);
});

test("returns every matching account so the user can resolve ambiguity", () => {
  const accounts = [{ label: "Google · Demo A" }, { label: "Amazon" }, { label: "Google · Demo B" }];
  assert.deepEqual(matchingAccounts("https://accounts.google.com", accounts), [0, 2]);
});

test("recognizes an issuer that explicitly names the host or origin", () => {
  const accounts = [{ label: "Example.test · demo" }, { label: "https://example.test:444 · demo" }];
  assert.deepEqual(matchingAccounts("https://example.test", accounts), [0]);
  assert.deepEqual(matchingAccounts("https://example.test:444", accounts), [1]);
  assert.deepEqual(matchingAccounts("https://sub.example.test", accounts), []);
});

test("discovery requests exact sites only for issuers present on the key", () => {
  const accounts = [{ label: "Amazon · demo" }, { label: "Some service" }, { label: "login.example.test · demo" }];
  assert.deepEqual(suggestionsForAccounts(accounts), {
    "https://amazon.com": [accounts[0]],
    "https://www.amazon.com": [accounts[0]],
    "https://login.example.test": [accounts[2]],
  });
});

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
  state = { binding, suggestions: {}, current: { ...tab, active: true }, focused: true, probe: true, permitted: true };
  globalThis.chrome = {
    extension: { inIncognitoContext: false },
    action: {
      onClicked: listener(),
      setBadgeText: async () => {},
      setTitle: async ({ title }) => events.push(["status", title]),
    },
    storage: {
      session: { get: async () => ({}), set: async () => {} },
      onChanged: listener(),
      local: {
        get: async (key) => {
          if (key === "site:" + site) return { [key]: state.binding };
          if (key === "recognized-sites") return { [key]: state.suggestions };
          return {};
        },
        set: async (values) => { state.binding = values["site:" + site]; },
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
    commands: { onCommand: listener() },
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
      getURL: file => "chrome-extension://test-extension/" + file,
      onInstalled: listener(),
      onStartup: listener(),
      onMessage: listener(),
      sendNativeMessage: async (_host, request) => {
        if (request.op === "discover") return { ok: true, accounts: [] };
        events.push(["request", request]);
        state.duringTouch?.();
        return { ok: true, code, expiresAt: Date.now() + 20_000, startsAt: Date.now() - 10_000 };
      },
    },
  };
}

reset();
const registeredMessages = chrome.runtime.onMessage;
const { fill, handlePrompt, injectOpenTabs } = await import("../extension/worker.js");

test("only this extension's own popup can invoke the private-release check", async () => {
  for (const source of [
    { id: "test-extension", url: "chrome-extension://test-extension/panel.html" },
    { id: "attacker", url: "chrome-extension://test-extension/panel.html" },
    { id: "test-extension", url: "https://login.example.test/challenge" },
  ]) {
    reset();
    let reply;
    // The handler uses the current chrome mock even after reset().
    registeredMessages.emit({ kind: "panel-update-check" }, source, value => { reply = value; });
    await new Promise(resolve => setImmediate(resolve));
    const trusted = source.id === "test-extension" && source.url.endsWith("/panel.html");
    assert.equal(events.some(([kind, request]) => kind === "request" && request.op === "update-check"), trusted);
    assert.equal(Boolean(reply), trusted);
  }
});

test("updates inject the prompt into existing HTTPS tabs without reloading their pages", async () => {
  reset();
  const injected = [];
  chrome.tabs.query = async (query) => {
    assert.deepEqual(query, { url: ["https://*/*"] });
    return [{ id: 7 }, { id: 8, incognito: true }];
  };
  chrome.scripting.executeScript = async (request) => { injected.push(request); };
  await injectOpenTabs();
  assert.deepEqual(injected, [{ target: { tabId: 7 }, files: ["field.js", "prompt.js"] }]);
  injected.length = 0;
  chrome.extension.inIncognitoContext = true;
  await injectOpenTabs();
  assert.deepEqual(injected, [{ target: { tabId: 8 }, files: ["field.js", "prompt.js"] }]);
});

const sender = {
  id: "test-extension", url: tab.url, origin: site, frameId: 0,
  documentId: "original-document", documentLifecycle: "active", tab,
};

test("private windows support preview and fill with the same click and focus checks", async () => {
  for (const failure of ["none", "click", "focus"]) {
    reset();
    chrome.extension.inIncognitoContext = true;
    const privateTab = { ...tab, incognito: true };
    const privateSender = { ...sender, tab: privateTab };
    state.current.incognito = true;
    state.binding = { ...binding, prompt: true, touchRequired: false };
    assert.deepEqual(await handlePrompt({ kind: "prompt-status" }, privateSender), { ok: true });
    assert.equal((await handlePrompt({ kind: "prompt-preview" }, privateSender)).ok, true);
    events.length = 0;
    if (failure === "click") state.probe = false;
    if (failure === "focus") state.focused = false;
    assert.equal((await handlePrompt({ kind: "prompt-fill" }, privateSender)).ok, failure === "none");
    assert.equal(events.some(([type]) => type === "request"), failure === "none");
    assert.equal(events.some(([type]) => type === "fill"), failure === "none");
  }
});

test("private first-use fills never persist a new site pairing", async () => {
  reset();
  chrome.extension.inIncognitoContext = true;
  state.current.incognito = true;
  const privateSender = { ...sender, tab: { ...tab, incognito: true } };
  state.binding = undefined;
  state.suggestions[site] = [{ ...binding, touchRequired: false }];
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.deepEqual(await handlePrompt({ kind: "prompt-status" }, privateSender), { ok: true, setup: "unique" });
    assert.equal((await handlePrompt({ kind: "prompt-enroll" }, privateSender)).ok, true);
    assert.equal(state.binding, undefined);
  }
});

test("normal and private workers reject tabs and senders from the other context", async () => {
  for (const privateWorker of [false, true]) {
    reset();
    chrome.extension.inIncognitoContext = privateWorker;
    state.current.incognito = !privateWorker;
    state.binding = { ...binding, prompt: true };
    const foreignTab = { ...tab, incognito: !privateWorker };
    assert.equal((await fill(foreignTab)).ok, false);
    assert.equal((await handlePrompt({ kind: "prompt-fill" }, { ...sender, tab: foreignTab })).ok, false);
    // Check the browser's current tab as well as the sender snapshot.
    assert.equal((await handlePrompt({ kind: "prompt-fill" }, { ...sender, tab: { ...tab, incognito: privateWorker } })).ok, false);
    assert.equal(events.some(([type]) => type === "request"), false);
  }
});

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

test("a visible login tab can offer fill while another application has focus", async () => {
  reset();
  state.binding = { ...binding, prompt: true };
  state.focused = false;
  assert.deepEqual(await handlePrompt({ kind: "prompt-status" }, sender), { ok: true });
  assert.deepEqual(events, []);
  assert.equal((await handlePrompt({ kind: "prompt-fill" }, sender)).ok, false);
  assert.equal(events.some(([type]) => type === "request"), false);
});

test("same-document login redirects use the current page URL", async () => {
  reset();
  state.binding = { ...binding, prompt: true };
  const initialSender = { ...sender, url: site + "/identifier?state=previous" };
  assert.deepEqual(await handlePrompt({ kind: "prompt-status" }, initialSender), { ok: true });
  assert.equal((await handlePrompt({ kind: "prompt-fill" }, initialSender)).ok, true);
  assert.ok(events.some(([type]) => type === "fill"));
});

test("preview requires a hovered field and foreground window and rechecks revocation", async () => {
  for (const failure of ["none", "hover", "focus", "revoked"]) {
    reset();
    state.binding = { ...binding, prompt: true, touchRequired: false };
    if (failure === "hover") state.probe = false;
    if (failure === "focus") state.focused = false;
    if (failure === "revoked") state.duringTouch = () => { state.binding = undefined; };
    const result = await handlePrompt({ kind: "prompt-preview" }, sender);
    assert.equal(result.ok, failure === "none");
    assert.equal(events.some(([type]) => type === "request"), ["none", "revoked"].includes(failure));
    assert.equal(events.some(([type]) => type === "fill"), false);
  }
});

test("first-use offers are private until a valid enrollment click", async () => {
  reset();
  state.binding = undefined;
  state.suggestions[site] = [{ ...binding, label: "Demo account", touchRequired: false }];
  assert.deepEqual(await handlePrompt({ kind: "prompt-status" }, sender), { ok: true, setup: "unique" });
  assert.deepEqual(events, []);
  assert.equal(state.binding, undefined);

  state.probe = false;
  assert.equal((await handlePrompt({ kind: "prompt-enroll" }, sender)).ok, false);
  assert.equal(events.some(([type]) => type === "request"), false);
  state.probe = true;
  assert.equal((await handlePrompt({ kind: "prompt-enroll" }, sender)).ok, true);
  assert.equal(state.binding.id, binding.id);
  assert.equal(state.binding.prompt, true);
});

test("enrollment refuses ambiguous suggestions, revoked permission and a changed match", async () => {
  for (const problem of ["ambiguous", "revoked", "changed"]) {
    reset();
    state.binding = undefined;
    state.suggestions[site] = [binding];
    if (problem === "ambiguous") {
      state.suggestions[site].push({ ...binding, id: "different-account" });
      assert.deepEqual(await handlePrompt({ kind: "prompt-status" }, sender), {
        ok: true, setup: "choose", choices: ["Demo", "Demo"],
      });
    }
    if (problem === "revoked") state.permitted = false;
    if (problem === "changed") {
      state.duringTouch = () => { state.suggestions[site] = [{ ...binding, id: "different-account" }]; };
    }
    assert.equal((await handlePrompt({ kind: "prompt-enroll" }, sender)).ok, false);
    assert.equal(events.some(([type]) => type === "request"), problem === "changed");
    assert.equal(events.some(([type]) => type === "fill"), false);
    assert.equal(state.binding, undefined);
  }
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
