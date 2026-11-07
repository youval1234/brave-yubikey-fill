(() => {
  const version = chrome.runtime.getManifest().version;
  if (window.top !== window || location.protocol !== "https:" || globalThis.yubiKeyFillPrompt === version) return;
  globalThis.yubiKeyFillDispose?.();
  globalThis.yubiKeyFillPrompt = version;
  document.documentElement.dataset.yubikeyFillVersion = version;
  document.documentElement.dataset.yubikeyFillState = "starting";
  const controls = globalThis.yubiKeyFillField;
  let anchor, host, shadow, detail, fillButton, dismissTimer;
  let setupMode, pageObserver, scanFrame, retryTimer;
  let dismissed;
  let waiting = false;
  let generation = 0;
  let checking = false;
  let scanRequested = false;
  let disposed = false;
  let hoverInput, hoverTarget, hoverTimer, leaveTimer, previewTimer;
  let hoverReadyAt = 0;
  let codeDisplay, countdown, progress;
  const lifetime = new AbortController();

  function listen(target, type, handler, options = {}) {
    target.addEventListener(type, handler, { ...options, signal: lifetime.signal });
  }

  let styles;
  function getStyles() {
    if (styles) return styles;
    styles = new CSSStyleSheet();
    styles.replaceSync(`
    :host { all: initial; }
    .card {
      box-sizing: border-box; display: grid; gap: 12px; padding: 13px;
      background: #202620; color: #f2f5ef; border: 1px solid #4f643c;
      border-radius: 15px; box-shadow: 0 10px 34px #0c140d55, 0 1px 4px #0004;
      font: 13px/1.4 system-ui, sans-serif; color-scheme: dark;
    }
    @keyframes enter { from { opacity: 0; transform: translateY(-5px) scale(.98); } to { opacity: 1; transform: none; } }
    .card { animation: enter 180ms cubic-bezier(.2,.8,.2,1); }
    .preview { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px; background: #141a15; border-radius: 8px; }
    .code { font: 700 25px/1.2 ui-monospace, monospace; letter-spacing: 2px; color: #e5f3da; }
    .timer { font: 600 12px/1 system-ui, sans-serif; color: #acd679; min-width: 28px; text-align: right; }
    .track { height: 3px; background: #2b382b; overflow: hidden; border-radius: 2px; }
    .progress { height: 100%; background: #94ce58; transform-origin: left; transition: transform 250ms linear; }
    .fill { transition: background 120ms, transform 120ms; }
    .fill:active { transform: scale(.98); }
    @media (prefers-reduced-motion: reduce) { .card { animation: none; } .fill, .progress { transition: none; } }
    .header { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 10px; align-items: center; }
    .logo { width: 34px; height: 34px; display: block; }
    .title { font-size: 14px; font-weight: 720; }
    .detail { color: #b6c3ac; overflow-wrap: anywhere; }
    button { font: inherit; cursor: pointer; border: 0; }
    .dismiss {
      width: 27px; height: 27px; border-radius: 8px; font-size: 18px; line-height: 1;
      align-self: start; background: transparent; color: #c5d1ba;
    }
    .dismiss:hover { background: #34432b; }
    .fill {
      min-height: 36px; padding: 7px 12px; border-radius: 9px;
      background: #9aca60; color: #14200d; font-weight: 700;
    }
    .fill:hover { background: #b6df86; }
    .fill:disabled { background: #3b4931; color: #dce8d3; cursor: default; }
    button:focus-visible { outline: 2px solid #bfe58e; outline-offset: 2px; }
  `);
    return styles;
  }
  document.documentElement.dataset.yubikeyFillState = "watching";

  function close() {
    generation++;
    clearTimeout(dismissTimer);
    clearTimeout(previewTimer);
    clearTimeout(hoverTimer);
    controls.markHover(null);
    clearTimeout(retryTimer);
    if (codeDisplay) codeDisplay.textContent = "";
    host?.remove();
    host = anchor = undefined;
    shadow = detail = fillButton = codeDisplay = countdown = progress = undefined;
    if (!hoverInput?.isConnected) hoverInput = hoverTarget = undefined;
    if (!dismissed?.isConnected) dismissed = undefined;
    if (!hoverInput) stopWatching();
  }

  async function refreshPreview() {
    if (!host || !hoverInput || document.hidden || waiting) return;
    const currentHost = host;
    try {
      const result = await chrome.runtime.sendMessage({ kind: "prompt-preview" });
      if (host !== currentHost) return;
      if (!result?.ok) {
        codeDisplay.textContent = "••• •••";
        countdown.textContent = "";
        detail.textContent = result?.protected ? "Click Fill code to use this protected account." : "Preview unavailable. Click Fill code to try.";
        previewTimer = setTimeout(refreshPreview, 3000);
        return;
      }
      codeDisplay.textContent = result.code.replace(/(.{3})(?=.)/g, "$1 ");
      const tick = () => {
        if (host !== currentHost || !hoverInput || document.hidden) return;
        const remaining = result.expiresAt - Date.now();
        const seconds = Math.max(0, Math.ceil(remaining / 1000)) + "s";
        if (countdown.textContent !== seconds) countdown.textContent = seconds;
        progress.style.transform = "scaleX(" + Math.max(0, Math.min(1, remaining / (result.expiresAt - result.startsAt))) + ")";
        if (remaining <= 0) {
          codeDisplay.textContent = "••• •••";
          void refreshPreview();
        } else previewTimer = setTimeout(tick, Math.min(250, remaining));
      };
      tick();
    } catch {
      if (host === currentHost) previewTimer = setTimeout(refreshPreview, 3000);
    }
  }

  function position() {
    if (!host) return;
    if (!host.isConnected || !anchor.isConnected || (!waiting && controls.field() !== anchor)) {
      close();
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(292, window.innerWidth - 16);
    if (width < 144 || rect.bottom < 0 || rect.top > window.innerHeight) {
      close();
      return;
    }
    const height = host.offsetHeight;
    const top = rect.bottom + 8 + height <= window.innerHeight
      ? rect.bottom + 8 : Math.max(8, rect.top - height - 8);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    for (const [name, value] of [["width", width], ["top", top], ["left", left]]) {
      if (host.style.getPropertyValue(name) !== value + "px" || host.style.getPropertyPriority(name) !== "important") {
        host.style.setProperty(name, value + "px", "important");
      }
    }
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  async function requestCode(event, choice) {
    if (!event.isTrusted || waiting || host?.parentNode !== document.documentElement
        || host.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) === false
        || !document.hasFocus()
        || controls.field() !== anchor) return;
    const currentHost = host;
    const requestedField = anchor;
    const mode = setupMode;
    waiting = true;
    fillButton.disabled = true;
    fillButton.textContent = "Waiting for YubiKey…";
    detail.textContent = "Reading your key. Touch it if it flashes.";
    position();
    controls.markClick(requestedField);
    let result;
    try {
      const kind = mode ? "prompt-enroll" : "prompt-fill";
      result = await chrome.runtime.sendMessage({ kind, choice });
    } catch {
      result = null;
    } finally {
      controls.clearClick();
      waiting = false;
    }
    if (currentHost !== host) return;
    detail.textContent = result?.message || "Reload this page and try again.";
    fillButton.textContent = result?.ok ? "Code filled" : "Try again";
    fillButton.disabled = Boolean(result?.ok);
    if (result?.ok) {
      dismissed = requestedField;
      dismissTimer = setTimeout(close, 1800);
    } else {
      position();
    }
  }

  function show(input, setup, choices) {
    anchor = input;
    setupMode = setup;
    host = document.createElement("div");
    host.dataset.yubikeyFillHost = version;
    controls.markHover(input, host);
    host.style.setProperty("all", "initial", "important");
    host.style.setProperty("position", "fixed", "important");
    host.style.setProperty("display", "block", "important");
    host.style.setProperty("z-index", "2147483647", "important");
    host.style.setProperty("width", "292px", "important");
    shadow = host.attachShadow({ mode: "closed" });
    shadow.adoptedStyleSheets = [getStyles()];

    const card = element("section", "card");
    card.setAttribute("aria-label", "YubiKey Fill");
    const header = element("div", "header");
    const logo = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    logo.classList.add("logo");
    logo.setAttribute("viewBox", "0 0 64 64");
    logo.setAttribute("aria-hidden", "true");
    // Static geometry, with no data from the page.
    for (const [tag, attributes] of [
      ["rect", { x: 20, y: 2, width: 24, height: 20, rx: 3, fill: "#b4bcb0" }],
      ["rect", { x: 16, y: 16, width: 32, height: 46, rx: 9, fill: "#252e20", stroke: "#8cbd53", "stroke-width": 2 }],
      ["circle", { cx: 32, cy: 38, r: 10, fill: "#8cbd53" }],
      ["circle", { cx: 32, cy: 38, r: 4, fill: "#28351e" }],
    ]) {
      const part = document.createElementNS(logo.namespaceURI, tag);
      for (const [name, value] of Object.entries(attributes)) part.setAttribute(name, value);
      logo.append(part);
    }

    const copy = element("div", "copy");
    detail = element("div", "detail", setup ? "Match found for " + location.hostname : "Use your security key");
    detail.setAttribute("role", "status");
    copy.append(element("div", "title", "YubiKey Fill"), detail);
    const dismiss = element("button", "dismiss", "×");
    dismiss.type = "button";
    dismiss.setAttribute("aria-label", "Dismiss autofill");
    dismiss.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      dismissed = input;
      close();
    });
    fillButton = element("button", "fill", "Fill code");
    fillButton.type = "button";
    fillButton.addEventListener("click", (event) => { void requestCode(event); });
    header.append(logo, copy, dismiss);
    card.append(header);
    if (!choices?.length) {
      const preview = element("div", "preview");
      codeDisplay = element("span", "code", "••• •••");
      codeDisplay.setAttribute("aria-label", "One-time code");
      countdown = element("span", "timer", "");
      countdown.setAttribute("aria-label", "Code expires in");
      preview.append(codeDisplay, countdown);
      const track = element("div", "track");
      progress = element("div", "progress");
      track.append(progress);
      card.append(preview, track);
    }
    if (choices?.length) {
      for (const [index, label] of choices.entries()) {
        const button = element("button", "fill", label);
        button.type = "button";
        button.addEventListener("click", (event) => {
          fillButton = button;
          void requestCode(event, index);
        });
        card.append(button);
      }
    } else card.append(fillButton);
    shadow.append(card);
    document.documentElement.append(host);
    position();
    if (host && !choices?.length) void refreshPreview();
  }

  function stopWatching() {
    pageObserver?.disconnect();
    pageObserver = undefined;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    if (scanFrame) cancelAnimationFrame(scanFrame);
    scanFrame = 0;
  }

  function scheduleScan() {
    if (disposed || document.hidden || (!hoverInput && !host)) return;
    if (checking) {
      scanRequested = true;
      return;
    }
    if (scanFrame) return;
    scanFrame = requestAnimationFrame(() => {
      scanFrame = 0;
      if (host) position();
      if (!host) void offer();
    });
  }

  async function offer() {
    if (disposed || host || waiting || checking || document.hidden || !hoverInput) return;
    const input = controls.field();
    if (!input || input !== hoverInput || input === dismissed || !controls.isHovered()
        || performance.now() < hoverReadyAt) {
      document.documentElement.dataset.yubikeyFillState = "waiting-for-field";
      return;
    }
    clearTimeout(retryTimer);
    checking = true;
    const attempt = generation;
    const url = location.href;
    try {
      document.documentElement.dataset.yubikeyFillState = "checking-key";
      const result = await chrome.runtime.sendMessage({ kind: "prompt-status" });
      if (disposed) return;
      document.documentElement.dataset.yubikeyFillState = result?.ok ? "matched" : "unmatched-or-inactive";
      if (attempt !== generation || location.href !== url || controls.field() !== input || hoverInput !== input) {
        scanRequested = true;
        return;
      }
      if (result?.ok) show(input, result.setup, result.choices);
      else if (Number.isFinite(result?.retryAfterMs)) {
        retryTimer = setTimeout(scheduleScan, Math.max(1000, result.retryAfterMs));
      }
    } catch {
      document.documentElement.dataset.yubikeyFillState = "extension-unavailable";
      // The extension may have been reloaded in Brave.
    } finally {
      checking = false;
      if (scanRequested) {
        scanRequested = false;
        scheduleScan();
      }
    }
  }

  function startWatching() {
    if (disposed || document.hidden || (!hoverInput && !host)) return;
    if (!pageObserver) {
      pageObserver = new MutationObserver((records) => {
        if (!hoverInput && !host) return;
        const relevant = records.some((record) => {
          if (record.target === host) return false;
          const nodes = [...record.addedNodes, ...record.removedNodes];
          return !nodes.length || !nodes.every((node) =>
            node.nodeType === 1 && node.hasAttribute("data-yubikey-fill-host"));
        });
        if (relevant) scheduleScan();
      });
      pageObserver.observe(document.documentElement, {
        subtree: true, childList: true, attributes: true,
        attributeFilter: ["autocomplete", "name", "id", "hidden", "disabled", "class", "style"],
      });
    }
    scheduleScan();
  }

  listen(document, "focusin", (event) => {
    if (host && event.target !== host && controls.fieldFor(event.target) !== anchor && !waiting) close();
    if (dismissed && event.target !== host && controls.fieldFor(event.target) !== dismissed) dismissed = undefined;
    scheduleScan();
  }, { capture: true });
  listen(document, "pointerover", (event) => {
    if (!event.isTrusted) return;
    if (event.target === host) {
      clearTimeout(leaveTimer);
      hoverInput = anchor;
      controls.markHover(anchor, host);
      return;
    }
    if (!(event.target instanceof HTMLInputElement)) return;
    const input = controls.fieldFor(event.target);
    if (!input) return;
    clearTimeout(leaveTimer);
    hoverTarget = event.target;
    if (input === hoverInput && host) return;
    hoverInput = input;
    hoverReadyAt = performance.now() + 280;
    controls.markHover(input, host);
    startWatching();
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(scheduleScan, 280);
  }, { capture: true });
  listen(document, "pointerout", (event) => {
    if (!event.isTrusted || (event.target !== hoverTarget && event.target !== host)) return;
    if (event.relatedTarget === host || (event.relatedTarget && controls.fieldFor(event.relatedTarget) === hoverInput)) return;
    clearTimeout(hoverTimer);
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      hoverInput = hoverTarget = undefined;
      close();
    }, 180);
  }, { capture: true });
  listen(window, "blur", () => {
    hoverInput = hoverTarget = undefined;
    close();
  });
  listen(document, "pointerdown", (event) => {
    if (host && event.target !== host && controls.fieldFor(event.target) !== anchor) close();
    scheduleScan();
  }, { capture: true });
  listen(document, "keydown", (event) => {
    if (event.key === "Escape" && host) {
      dismissed = anchor;
      close();
    }
  }, { capture: true });
  listen(document, "input", (event) => {
    if (!waiting && host && event.target instanceof HTMLInputElement && controls.field() !== anchor) close();
  }, { capture: true });
  listen(document, "visibilitychange", () => {
    if (document.hidden) {
      stopWatching();
      close();
    } else startWatching();
  });
  listen(window, "pagehide", () => {
    stopWatching();
    close();
  });
  listen(window, "pageshow", startWatching);
  listen(window, "focus", startWatching);
  listen(window, "scroll", scheduleScan, { capture: true, passive: true });
  listen(window, "resize", scheduleScan);
  const onMessage = (message, sender) => {
    if (!["pairing-updated", "retry-offer"].includes(message?.kind) || sender.id !== chrome.runtime.id) return;
    close();
    startWatching();
  };
  chrome.runtime.onMessage.addListener(onMessage);
  globalThis.yubiKeyFillDispose = () => {
    disposed = true;
    lifetime.abort();
    clearTimeout(leaveTimer);
    chrome.runtime.onMessage.removeListener(onMessage);
    stopWatching();
    close();
  };
  startWatching();
})();
