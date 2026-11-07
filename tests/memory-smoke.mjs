// Approximate memory comparison using fresh Brave profiles and dummy credentials.
// Page heap includes the fixture and all of its JavaScript worlds, not just the extension.
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
  for (let n = 0; n < 100; n++) { const value = await fn(); if (value) return value; await pause(75); }
  throw Error("Browser benchmark timed out");
}
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(), events = {};
  let id = 0;
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const reply = JSON.parse(data);
    if (reply.method) events[reply.method]?.(reply.params);
    const handler = pending.get(reply.id);
    if (!handler) return;
    pending.delete(reply.id);
    if (reply.error) handler.reject(Error(reply.error.message)); else handler.resolve(reply.result);
  };
  return { events, close: () => socket.close(), call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const request = ++id, timer = setTimeout(() => { pending.delete(request); reject(Error(method)); }, 6000);
      pending.set(request, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      socket.send(JSON.stringify({ id: request, method, params }));
    });
  } };
}
async function evaluate(connection, expression) {
  const value = await connection.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (value.exceptionDetails) throw Error(value.exceptionDetails.text);
  return value.result.value;
}
async function heap(connection) {
  await connection.call("HeapProfiler.collectGarbage");
  const usage = await connection.call("Runtime.getHeapUsage");
  return Math.round(usage.usedSize / 1024);
}
function workingSet(pid) {
  // Sum only this isolated browser's process tree, excluding the user's Brave session.
  const script = `$all=@(Get-CimInstance Win32_Process -Filter "Name = 'brave.exe'");$ids=[Collections.Generic.HashSet[int]]::new();[void]$ids.Add(${pid});do{$added=0;foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)){$added++}}}while($added);$sum=($all|Where-Object {$ids.Contains([int]$_.ProcessId)}|ForEach-Object {Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue}|Measure-Object WorkingSet64 -Sum).Sum;[math]::Round($sum/1MB,1)`;
  return Number(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, encoding: "utf8" }).trim());
}

const results = {};
for (const mode of ["baseline", "extension"]) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "yubikey-memory-test-"));
  const browser = spawn("C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe", [
    "--headless=new", "--remote-debugging-port=0", "--enable-unsafe-extension-debugging",
    "--disable-background-networking", "--no-first-run", "--user-data-dir=" + profile,
    ...(mode === "extension" ? ["--load-extension=" + path.resolve("extension")] : []), "about:blank",
  ], { windowsHide: true, stdio: "ignore" });
  let page, worker;
  try {
    const port = await until(() => {
      try { return Number(fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split(/\r?\n/)[0]); } catch { return null; }
    });
    const targets = () => fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
    if (mode === "extension") {
      worker = await connect((await until(async () => (await targets()).find(t => t.url.endsWith("/worker.js")))).webSocketDebuggerUrl);
      await until(() => evaluate(worker, 'typeof chrome !== "undefined" && chrome.runtime?.id'));
      await evaluate(worker, `(async()=>{
        await chrome.storage.local.clear(); await chrome.storage.session.clear();
        const get=chrome.windows.get; chrome.windows.get=async(...args)=>({...await get(...args),focused:true});
        chrome.runtime.sendNativeMessage=async(_host,request)=>request.op==="discover"
          ? {ok:true,accounts:[{device:"dummy",id:"ab",label:"Amazon · demo",touchRequired:false}]}
          : {ok:true,code:"123456",startsAt:Date.now()-5000,expiresAt:Date.now()+25000};
      })()`);
    }
    page = await connect((await targets()).find(t => t.type === "page").webSocketDebuggerUrl);
    await page.call("Emulation.setFocusEmulationEnabled", { enabled: true });
    page.events["Fetch.requestPaused"] = async ({ requestId }) => {
      await page.call("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "text/html" }], body: Buffer.from('<!doctype html><h1>Two-Step Verification</h1><input autocomplete="one-time-code">').toString("base64") });
    };
    await page.call("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await page.call("Page.navigate", { url: "https://www.amazon.com/ap/mfa" });
    await until(() => evaluate(page, 'document.readyState === "complete" && !!document.querySelector("input")'));
    if (worker) await until(() => evaluate(page, 'document.documentElement.dataset.yubikeyFillState === "watching"'));
    await pause(350);
    const result = { idlePageHeapKiB: await heap(page), idleBrowserWorkingSetMiB: workingSet(browser.pid) };
    if (worker) {
      result.idleWorkerHeapKiB = await heap(worker);
      const rect = await evaluate(page, '(()=>{const r=document.querySelector("input").getBoundingClientRect();return {x:r.x+10,y:r.y+10};})()');
      await page.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...rect });
      await until(() => evaluate(page, '!!document.querySelector("[data-yubikey-fill-host]")'));
      await pause(350);
      result.openPageHeapKiB = await heap(page);
      result.openWorkerHeapKiB = await heap(worker);
      result.openBrowserWorkingSetMiB = workingSet(browser.pid);
      await page.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
      await until(() => evaluate(page, '!document.querySelector("[data-yubikey-fill-host]")'));
      await pause(250);
      result.closedPageHeapKiB = await heap(page);
      // A debugger keeps a worker awake. Disconnect to measure normal MV3 idling.
      worker.close(); worker = undefined;
      await pause(35000);
      result.workerSuspended = !(await targets()).some(t => t.url.endsWith("/worker.js"));
      result.suspendedBrowserWorkingSetMiB = workingSet(browser.pid);
    }
    results[mode] = result;
  } finally {
    page?.close(); worker?.close();
    if (browser.exitCode === null) { const exited = once(browser, "exit"); browser.kill(); await exited; }
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith("yubikey-memory-test-"));
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}
console.log(JSON.stringify(results, null, 2));
