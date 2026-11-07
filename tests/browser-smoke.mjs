// Windows integration test with intercepted pages, dummy accounts and dummy codes.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { once } from "node:events";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "yubikey-automatic-test-"));
const extension = path.resolve("extension");
const id = createHash("sha256").update(Buffer.from(extension, "utf16le")).digest("hex").slice(0,32).replace(/./g,c=>String.fromCharCode(97+parseInt(c,16)));
const browser = spawn("C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe", [
  "--headless=new","--remote-debugging-port=0","--enable-unsafe-extension-debugging",
  "--disable-background-networking","--no-first-run","--user-data-dir="+profile,
  "--load-extension="+extension,"about:blank",
], {windowsHide:true,stdio:"ignore"});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,message) {
  for(let n=0;n<100;n++){const value=await fn();if(value)return value;await pause(75);}
  throw Error(message);
}
async function connect(url) {
  const socket=new WebSocket(url);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  const pending=new Map(),events={};
  let sequence=0;
  socket.onmessage=({data})=>{
    const reply=JSON.parse(data);
    if(reply.method) events[reply.method]?.(reply.params);
    const handler=pending.get(reply.id);
    if(!handler)return;
    pending.delete(reply.id);
    if(reply.error)handler.reject(Error(reply.error.message));else handler.resolve(reply.result);
  };
  return {close:()=>socket.close(),events,call(method,params={}){
    return new Promise((resolve,reject)=>{
      const request=++sequence,timer=setTimeout(()=>reject(Error("Timeout "+method)),6000);
      pending.set(request,{
        resolve:value=>{clearTimeout(timer);resolve(value);},
        reject:error=>{clearTimeout(timer);reject(error);}
      });
      socket.send(JSON.stringify({id:request,method,params}));
    });
  }};
}
async function evaluate(connection,expression) {
  const result=await connection.call("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
  return result.result.value;
}
function buttonIn(node) {
  const attrs=node.attributes||[];
  if(attrs.some((name,i)=>i%2===0&&name==="class"&&attrs[i+1].split(" ").includes("fill")))return node;
  for(const child of [...node.children||[],...node.shadowRoots||[]]){
    const found=buttonIn(child);if(found)return found;
  }
}
let worker,page;
try {
  const port=await until(()=>{
    try{return Number(fs.readFileSync(path.join(profile,"DevToolsActivePort"),"utf8").split(/\r?\n/)[0]);}catch{return null;}
  },"No debugger");
  const targets=()=>fetch("http://127.0.0.1:"+port+"/json/list").then(r=>r.json());
  const target=await until(async()=>(await targets()).find(t=>t.url==="chrome-extension://"+id+"/worker.js"),"No worker");
  worker=await connect(target.webSocketDebuggerUrl);
  await until(()=>evaluate(worker,'typeof chrome!=="undefined" && chrome.runtime?.id'),"No runtime");
  await evaluate(worker, '(async()=>{await chrome.storage.local.clear();await chrome.storage.session.clear();globalThis.codes=0;globalThis.previews=0;chrome.runtime.sendNativeMessage=async(_host,request)=>{if(request.op==="discover")return {ok:true,accounts:[{device:"dummy",id:"ab",label:"Amazon · demo",touchRequired:false},{device:"dummy",id:"cd",label:"NVIDIA · demo",touchRequired:false},{device:"dummy",id:"ef",label:"eBay",touchRequired:false}]};if(request.op==="preview"){previews++;return {ok:true,code:previews%2?"123456":"654321",startsAt:Date.now()-29350,expiresAt:Date.now()+650};}codes++;return {ok:true,code:"012345",expiresAt:Date.now()+25000};};})()');
  await evaluate(worker, '(async () => { const getWindow = chrome.windows.get; globalThis.backgroundWindow = true; chrome.windows.get = async (...args) => ({ ...await getWindow(...args), focused: !backgroundWindow }); })()');
  page=await connect((await targets()).find(t=>t.type==="page").webSocketDebuggerUrl);
  await page.call("Page.bringToFront");
  await page.call("Emulation.setFocusEmulationEnabled",{enabled:true});
  let html="";
  page.events["Fetch.requestPaused"]=async({requestId})=>{
    await page.call("Fetch.fulfillRequest",{requestId,responseCode:200,responseHeaders:[{name:"Content-Type",value:"text/html"}],body:Buffer.from(html).toString("base64")});
  };
  await page.call("Fetch.enable",{patterns:[{urlPattern:"*"}]});
  async function visit(url,markup) {
    await page.call("Input.dispatchMouseEvent",{type:"mouseMoved",x:0,y:0});
    html="<!doctype html><meta charset=utf-8>"+markup;
    await page.call("Page.navigate",{url});
    await until(()=>evaluate(page,'document.readyState==="complete" && location.href==='+JSON.stringify(url)),"No fixture");
  }
  const findButton=async()=>buttonIn((await page.call("DOM.getDocument",{depth:-1,pierce:true})).root);
  async function hoveredButton(index = 0) {
    const rect = await evaluate(page, '(() => { const input=document.querySelectorAll("input:not([type=hidden])")[' + index + ']; if(!input)return null; const r=input.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width}; })()');
    if (rect?.width) await page.call("Input.dispatchMouseEvent", { type:"mouseMoved", x:rect.x, y:rect.y });
    return findButton();
  }
  async function clickButton(button) {
    const {model}=await page.call("DOM.getBoxModel",{backendNodeId:button.backendNodeId});
    const x=(model.border[0]+model.border[4])/2,y=(model.border[1]+model.border[5])/2;
    for(const type of ["mousePressed","mouseReleased"]) {
      await page.call("Input.dispatchMouseEvent",{type,x,y,button:"left",clickCount:1});
    }
  }
  // Count extension work without timing-dependent CPU or heap assertions.
  const isolated = async (func, args = []) => evaluate(worker,
    `(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return (await chrome.scripting.executeScript({target:{tabId:tab.id},func:${func},args:${JSON.stringify(args)}}))[0].result;})()`);
  await visit("https://www.amazon.com/ap/mfa", '<input autocomplete="one-time-code"><div id="noise" style="height:60px">Unrelated content</div><div style="height:60px">Other content</div>');
  await until(() => evaluate(page, 'document.documentElement.dataset.yubikeyFillState === "watching"'), "No content script");
  await isolated(() => {
    globalThis.workCounts = { fields: 0, frames: 0 };
    const field = yubiKeyFillField.field, frame = requestAnimationFrame;
    yubiKeyFillField.field = (...args) => { workCounts.fields++; return field(...args); };
    globalThis.requestAnimationFrame = (...args) => { workCounts.frames++; return frame(...args); };
  });
  await evaluate(page, 'new Promise(resolve=>{let n=0;const timer=setInterval(()=>{document.querySelector("#noise").textContent=String(n++);if(n===60){clearInterval(timer);resolve();}},20);})');
  for (let n = 0; n < 20; n++) {
    await page.call("Input.dispatchMouseEvent", {type:"mouseMoved",x:10,y:n%2?40:110});
  }
  await pause(100);
  const idleWork = await isolated(() => ({...workCounts}));
  console.log("Idle mutation and pointer benchmark:", JSON.stringify(idleWork));
  assert.deepEqual(idleWork, {fields:0,frames:0}, "Idle pages performed field scans or scheduled frames");
  for(const [url,markup,hoverIndex = 0] of [
    ["https://www.amazon.com/ap/mfa",'<form action="/verify"><h1>Two-Step Verification</h1><input id="auth-mfa-otpcode" name="otpCode" type="tel"></form>'],
    ["https://login.nvgs.nvidia.com/v1/security/challenge",'<form action="/verify"><h1>Security Challenge</h1><p>Launch your authentication app and generate a security code.</p><label for="code">Enter code</label><input id="code" placeholder="Please enter code"></form>'],
    ["https://accounts.ebay.ch/mfaxs/signin",'<input type="hidden"><h1>Sicherheitscode eingeben</h1><div id="pin-boxes" role="group" aria-label="Sicherheitscode">'+Array.from({length:6},(_,i)=>'<input id="pin-box-'+i+'" name="pin-box-'+i+'" type="tel" maxlength="6" autocomplete="off" style="width:36px">').join('')+'</div><script>document.querySelector("#pin-boxes").addEventListener("input",event=>{const next=event.target.nextElementSibling;if(next&&event.target.value.length===1)next.focus();});</script>',4],
    ["https://www.amazon.de/ap/mfa",'<h1>Bestätigung</h1><input autocomplete="one-time-code">']
  ]){
    if (hoverIndex) await evaluate(worker, "backgroundWindow = false");
    const previewsBefore = await evaluate(worker, "previews");
    await visit(url,markup);
    await pause(400);
    assert.equal(await findButton(), undefined, "Card appeared before hovering");
    const button=await until(() => hoveredButton(hoverIndex),"No automatic offer for "+url);
    if (hoverIndex) await until(async () => await evaluate(worker, "previews") > previewsBefore, "Later digit did not authorize a hover preview");
    const before=await evaluate(worker,"codes");
    const {object}=await page.call("DOM.resolveNode",{backendNodeId:button.backendNodeId});
    await page.call("Runtime.callFunctionOn",{objectId:object.objectId,functionDeclaration:"function(){this.click();}"});
    await pause(100);
    assert.equal(await evaluate(worker,"codes"),before,"Synthetic click generated code");
    await evaluate(worker, "backgroundWindow = false");
    await clickButton(button);
    await until(()=>evaluate(page,'[...document.querySelectorAll("input:not([type=hidden])")].map(input=>input.value).join("")==="012345"'),"Click failed to fill");
    assert.equal(await evaluate(worker,"codes"),before+1);
    await evaluate(worker, "backgroundWindow = true");
    await page.call("Page.reload");
    await until(() => hoveredButton(hoverIndex), "Offer disappeared after refreshing the login page");
    assert.equal(await evaluate(worker,"codes"),before+1,"Refresh generated a code");
  }
  await visit("https://login.nvgs.nvidia.com/v1/nfactor/totp-auth",
    '<style>.concealed { display: none; }</style><h1>Security Challenge</h1><label for="code_input">Enter code</label><input id="code_input" class="concealed" autocomplete="one-time-code">');
  await until(() => evaluate(page, 'document.documentElement.dataset.yubikeyFillState === "watching"'),
    "Expected a hidden field to wait");
  await evaluate(page, 'document.querySelector("#code_input").classList.remove("concealed")');
  await until(hoveredButton, "Offer did not recover after a CSS-only field reveal");
  assert.equal(await evaluate(page, 'document.querySelectorAll("[data-yubikey-fill-host]").length'), 1);

  await visit("https://login.nvgs.nvidia.com/v1/login/identifier", '<h1>Security Challenge</h1>');
  await until(() => evaluate(page, 'document.documentElement.dataset.yubikeyFillState === "watching"'),
    "Expected the initial route to wait for the code field");
  await evaluate(page, 'history.replaceState({}, "", "/v1/nfactor/totp-auth?state=new"); document.body.insertAdjacentHTML("beforeend", \'<input autocomplete="one-time-code">\')');
  const redirectedButton = await until(hoveredButton, "Offer did not follow a same-document login redirect");
  const beforeRedirectFill = await evaluate(worker, "codes");
  await evaluate(worker, "backgroundWindow = false");
  await clickButton(redirectedButton);
  await until(() => evaluate(page, 'document.querySelector("input").value === "012345"'),
    "The redirected route did not accept click-to-fill");
  assert.equal(await evaluate(worker, "codes"), beforeRedirectFill + 1);
  await evaluate(worker, "backgroundWindow = true");

  await evaluate(worker, '(async () => { await chrome.storage.local.clear(); await chrome.storage.session.clear(); const native = chrome.runtime.sendNativeMessage; globalThis.keyUnavailable = true; chrome.runtime.sendNativeMessage = (...args) => args[1].op === "discover" && keyUnavailable ? Promise.resolve({ok:false,error:"device"}) : native(...args); })()');
  await visit("https://www.amazon.com/ap/mfa", '<input autocomplete="one-time-code">');
  await hoveredButton();
  await until(() => evaluate(page, 'document.documentElement.dataset.yubikeyFillState === "unmatched-or-inactive"'),
    "Expected unavailable-key state");
  await evaluate(worker, "keyUnavailable = false");
  await until(hoveredButton, "Offer did not recover when the key became available");
  await evaluate(worker,"backgroundWindow = false");
  await visit("https://www.amazon.com/ap/mfa", '<input autocomplete="one-time-code">');
  await until(() => evaluate(page, 'document.documentElement.dataset.yubikeyFillState === "watching"'), "No preview script");
  await isolated(() => {
    globalThis.activeObservers = 0;
    const Observer = MutationObserver;
    globalThis.MutationObserver = class extends Observer {
      observe(...args) {
        super.observe(...args);
        if (!this.tracked) { this.tracked = true; activeObservers++; }
      }
      disconnect() {
        super.disconnect();
        if (this.tracked) { this.tracked = false; activeObservers--; }
      }
    };
  });
  const previewButton = await until(hoveredButton, "No hover preview");
  assert.equal(await isolated(() => activeObservers), 1, "Expected one observer during hover");
  const {object:previewObject} = await page.call("DOM.resolveNode", {backendNodeId:previewButton.backendNodeId});
  const codeText = async () => (await page.call("Runtime.callFunctionOn", {
    objectId:previewObject.objectId,returnByValue:true,
    functionDeclaration:'function(){return this.getRootNode().querySelector(".code").textContent;}'
  })).result.value;
  await until(async () => /[0-9]/.test(await codeText()), "Preview did not render a code");
  await pause(220);
  const bounds = (await page.call("Runtime.callFunctionOn", {
    objectId:previewObject.objectId,returnByValue:true,
    functionDeclaration:'function(){const r=this.getRootNode().host.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}'
  })).result.value;
  if (process.env.YUBIKEY_TEST_SCREENSHOT) {
    const shot = await page.call("Page.captureScreenshot", {
      format:"png",clip:{x:Math.max(0,bounds.x-8),y:Math.max(0,bounds.y-8),width:bounds.width+16,height:bounds.height+16,scale:1},
    });
    fs.writeFileSync(path.resolve(process.env.YUBIKEY_TEST_SCREENSHOT),Buffer.from(shot.data,"base64"));
  }
  const firstCode = await codeText();
  await until(async () => (await codeText()) !== firstCode, "Preview did not refresh at expiry");
  // The popup remains interactive when the pointer crosses from input to card.
  await page.call("Input.dispatchMouseEvent", {type:"mouseMoved",x:bounds.x+30,y:bounds.y+25});
  await pause(350);
  assert.ok(await findButton(), "Card closed while the pointer was over it");
  await page.call("Input.dispatchMouseEvent", {type:"mouseMoved",x:0,y:0});
  await pause(350);
  assert.equal(await findButton(),undefined,"Card stayed open after pointer left");
  assert.equal(await codeText(), "", "Closed card retained its displayed code");
  assert.equal(await isolated(() => activeObservers), 0, "Observer stayed active after hover ended");
  const stoppedAt = await evaluate(worker,"previews");
  await pause(1100);
  assert.equal(await evaluate(worker,"previews"),stoppedAt,"Preview requests continued after closing");
  await visit("https://www.amazon.com.attacker.test/login",'<input autocomplete="one-time-code">');
  await pause(300);
  assert.equal(await findButton(),undefined,"Lookalike received offer");
  console.log("Hover-only offers, timed preview refresh, hover-out cleanup, safe fill and login regressions passed.");
} finally {
  page?.close();worker?.close();
  if (browser.exitCode === null) {
    const exited = once(browser, "exit");
    browser.kill();
    await exited;
  }
  assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(profile).startsWith("yubikey-automatic-test-"));
  await fs.promises.rm(profile, {recursive:true,force:true,maxRetries:20,retryDelay:100});
}
