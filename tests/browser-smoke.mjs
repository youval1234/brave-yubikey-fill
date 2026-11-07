// Windows integration test with intercepted pages, dummy accounts and dummy codes.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
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
  await evaluate(worker, '(async()=>{await chrome.storage.local.clear();await chrome.storage.session.clear();globalThis.codes=0;chrome.runtime.sendNativeMessage=async(_host,request)=>{if(request.op==="discover")return {ok:true,accounts:[{device:"dummy",id:"ab",label:"Amazon · demo",touchRequired:false},{device:"dummy",id:"cd",label:"NVIDIA · demo",touchRequired:false}]};codes++;return {ok:true,code:"012345",expiresAt:Date.now()+25000};};})()');
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
    html="<!doctype html><meta charset=utf-8>"+markup;
    await page.call("Page.navigate",{url});
    await until(()=>evaluate(page,'document.readyState==="complete" && location.href==='+JSON.stringify(url)),"No fixture");
  }
  const findButton=async()=>buttonIn((await page.call("DOM.getDocument",{depth:-1,pierce:true})).root);
  async function clickButton(button) {
    const {model}=await page.call("DOM.getBoxModel",{backendNodeId:button.backendNodeId});
    const x=(model.border[0]+model.border[4])/2,y=(model.border[1]+model.border[5])/2;
    for(const type of ["mousePressed","mouseReleased"]) {
      await page.call("Input.dispatchMouseEvent",{type,x,y,button:"left",clickCount:1});
    }
  }
  for(const [url,markup] of [
    ["https://www.amazon.com/ap/mfa",'<form action="/verify"><h1>Two-Step Verification</h1><input id="auth-mfa-otpcode" name="otpCode" type="tel"></form>'],
    ["https://login.nvgs.nvidia.com/v1/security/challenge",'<form action="/verify"><h1>Security Challenge</h1><p>Launch your authentication app and generate a security code.</p><label for="code">Enter code</label><input id="code" placeholder="Please enter code"></form>']
  ]){
    await visit(url,markup);
    const button=await until(findButton,"No automatic offer for "+url);
    const before=await evaluate(worker,"codes");
    const {object}=await page.call("DOM.resolveNode",{backendNodeId:button.backendNodeId});
    await page.call("Runtime.callFunctionOn",{objectId:object.objectId,functionDeclaration:"function(){this.click();}"});
    await pause(100);
    assert.equal(await evaluate(worker,"codes"),before,"Synthetic click generated code");
    await evaluate(worker, "backgroundWindow = false");
    await clickButton(button);
    await until(()=>evaluate(page,'document.querySelector("input").value==="012345"'),"Click failed to fill");
    assert.equal(await evaluate(worker,"codes"),before+1);
    await evaluate(worker, "backgroundWindow = true");
    await page.call("Page.reload");
    await until(findButton, "Offer disappeared after refreshing the login page");
    assert.equal(await evaluate(worker,"codes"),before+1,"Refresh generated a code");
  }
  await visit("https://login.nvgs.nvidia.com/v1/nfactor/totp-auth",
    '<style>.concealed { display: none; }</style><h1>Security Challenge</h1><label for="code_input">Enter code</label><input id="code_input" class="concealed" autocomplete="one-time-code">');
  await until(() => evaluate(page, 'document.documentElement.dataset.yubikeyFillState === "waiting-for-field"'),
    "Expected a hidden field to wait");
  await evaluate(page, 'document.querySelector("#code_input").classList.remove("concealed")');
  await until(findButton, "Offer did not recover after a CSS-only field reveal");
  assert.equal(await evaluate(page, 'document.querySelectorAll("[data-yubikey-fill-host]").length'), 1);

  await evaluate(worker, '(async () => { await chrome.storage.local.clear(); await chrome.storage.session.clear(); const native = chrome.runtime.sendNativeMessage; globalThis.keyUnavailable = true; chrome.runtime.sendNativeMessage = (...args) => args[1].op === "discover" && keyUnavailable ? Promise.resolve({ok:false,error:"device"}) : native(...args); })()');
  await visit("https://www.amazon.com/ap/mfa", '<input autocomplete="one-time-code">');
  await until(() => evaluate(page, 'document.documentElement.dataset.yubikeyFillState === "unmatched-or-inactive"'),
    "Expected unavailable-key state");
  await evaluate(worker, "keyUnavailable = false");
  await until(findButton, "Offer did not recover when the key became available");
  await visit("https://www.amazon.com.attacker.test/login",'<input autocomplete="one-time-code">');
  await pause(300);
  assert.equal(await findButton(),undefined,"Lookalike received offer");
  console.log("Automatic offers, background refresh, CSS-only reveal, key recovery, click-only fill and lookalike rejection passed.");
} finally {
  page?.close();worker?.close();browser.kill();
}
