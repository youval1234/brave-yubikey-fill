(() => {
  const version = chrome.runtime.getManifest().version;
  if (window.top !== window || location.protocol !== "https:" || globalThis.yubiKeyFillPrompt === version) return;
  globalThis.yubiKeyFillPrompt = version;
  const controls = globalThis.yubiKeyFillField;
  let anchor, host, shadow, detail, fillButton, observer, dismissTimer;
  let setupMode, discoveryObserver, scanFrame;
  let dismissed;
  let waiting = false;
  let generation = 0;

  const styles = new CSSStyleSheet();
  styles.replaceSync(`
    :host { all: initial; }
    .card {
      box-sizing: border-box; display: grid; gap: 12px; padding: 13px;
      background: #1b1727; color: #f6f3ff; border: 1px solid #554370;
      border-radius: 15px; box-shadow: 0 10px 34px #160e2d66, 0 1px 4px #0004;
      font: 13px/1.4 system-ui, sans-serif; color-scheme: dark;
    }
    .header { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 10px; align-items: center; }
    .logo { width: 34px; height: 34px; display: block; }
    .title { font-size: 14px; font-weight: 720; }
    .detail { color: #cfc4e5; overflow-wrap: anywhere; }
    button { font: inherit; cursor: pointer; border: 0; }
    .dismiss {
      width: 27px; height: 27px; border-radius: 8px; font-size: 18px; line-height: 1;
      align-self: start; background: transparent; color: #d6c9ec;
    }
    .dismiss:hover { background: #342943; }
    .fill {
      min-height: 36px; padding: 7px 12px; border-radius: 9px;
      background: #c6a9ff; color: #211436; font-weight: 700;
    }
    .fill:hover { background: #dac8ff; }
    .fill:disabled { background: #413456; color: #e8dcff; cursor: default; }
    button:focus-visible { outline: 2px solid #f2e9ff; outline-offset: 2px; }
  `);

  function close() {
    generation++;
    clearTimeout(dismissTimer);
    observer?.disconnect();
    host?.remove();
    host = anchor = undefined;
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
    host.style.setProperty("width", width + "px", "important");
    host.style.setProperty("top", top + "px", "important");
    host.style.setProperty("left", left + "px", "important");
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
    host.style.setProperty("all", "initial", "important");
    host.style.setProperty("position", "fixed", "important");
    host.style.setProperty("display", "block", "important");
    host.style.setProperty("z-index", "2147483647", "important");
    host.style.setProperty("width", "292px", "important");
    shadow = host.attachShadow({ mode: "closed" });
    shadow.adoptedStyleSheets = [styles];

    const card = element("section", "card");
    card.setAttribute("aria-label", "YubiKey Fill");
    const header = element("div", "header");
    const logo = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    logo.classList.add("logo");
    logo.setAttribute("viewBox", "0 0 64 64");
    logo.setAttribute("aria-hidden", "true");
    // Static geometry, with no data from the page.
    for (const [tag, attributes] of [
      ["rect", { x: 2, y: 2, width: 60, height: 60, rx: 17, fill: "#26193f", stroke: "#9d75ff", "stroke-width": 3 }],
      ["path", { d: "M31 30l-13 13v8h8v-5h5v-5l8-8z", fill: "#c6a9ff" }],
      ["circle", { cx: 38, cy: 24, r: 12, fill: "#c6a9ff" }],
      ["circle", { cx: 38, cy: 24, r: 4, fill: "#26193f" }],
      ["path", { d: "M49 10l2 5 5 2-5 2-2 5-2-5-5-2 5-2z", fill: "#8ef5df" }],
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
    if (host) {
      observer = new MutationObserver(position);
      observer.observe(document.documentElement, { subtree: true, childList: true });
    }
  }

  function stopDiscovery() {
    discoveryObserver?.disconnect();
    discoveryObserver = undefined;
    if (scanFrame) cancelAnimationFrame(scanFrame);
    scanFrame = 0;
  }

  function offerReady(setup, requireFocus, choices) {
    const input = controls.field();
    if (host || waiting || !input || input === dismissed
        || (requireFocus && document.activeElement !== input)) return false;
    stopDiscovery();
    show(input, setup, choices);
    return true;
  }

  async function offer(automatic = false) {
    if (host || waiting || (!automatic && (document.activeElement?.tagName !== "INPUT"
        || document.activeElement === dismissed))) return;
    const attempt = ++generation;
    const url = location.href;
    try {
      if (!controls.field()) {
        if (!discoveryObserver) {
          discoveryObserver = new MutationObserver(() => {
            if (scanFrame || document.hidden) return;
            scanFrame = requestAnimationFrame(() => {
              scanFrame = 0;
              if (controls.field()) {
                stopDiscovery();
                void offer(true);
              }
            });
          });
          discoveryObserver.observe(document.documentElement, {
            subtree: true, childList: true, attributes: true,
            attributeFilter: ["autocomplete", "name", "id", "hidden", "disabled"],
          });
        }
        return;
      }
      const result = await chrome.runtime.sendMessage({ kind: "prompt-status" });
      if (!result?.ok || attempt !== generation || location.href !== url) return;
      if (offerReady(result.setup, !automatic, result.choices) || !automatic || discoveryObserver) return;
      discoveryObserver = new MutationObserver(() => {
        if (scanFrame || document.hidden) return;
        scanFrame = requestAnimationFrame(() => {
          scanFrame = 0;
          if (location.href === url) offerReady(result.setup, false);
          else {
            stopDiscovery();
            void offer(true);
          }
        });
      });
      discoveryObserver.observe(document.documentElement, {
        subtree: true, childList: true, attributes: true,
        attributeFilter: ["autocomplete", "name", "id", "hidden", "disabled"],
      });
    } catch {
      // The extension may have been reloaded in Brave.
    }
  }

  document.addEventListener("focusin", (event) => {
    if (event.target !== anchor && event.target !== host && !waiting) close();
    if (event.target !== dismissed && event.target !== host) dismissed = undefined;
    void offer();
  }, true);
  document.addEventListener("pointerdown", (event) => {
    if (event.target !== host && event.target !== anchor) close();
    if (event.target === document.activeElement) void offer();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && host) {
      dismissed = anchor;
      close();
    }
  }, true);
  document.addEventListener("input", (event) => {
    if (!waiting && event.target === anchor && anchor.value) close();
  }, true);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) close();
    else void offer(true);
  });
  window.addEventListener("pagehide", () => {
    stopDiscovery();
    close();
  });
  window.addEventListener("pageshow", () => { void offer(true); });
  window.addEventListener("focus", () => { void offer(true); });
  window.addEventListener("scroll", position, { capture: true, passive: true });
  window.addEventListener("resize", position);
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (!["pairing-updated", "retry-offer"].includes(message?.kind) || sender.id !== chrome.runtime.id) return;
    stopDiscovery();
    close();
    void offer(true);
  });
  void offer(true);
})();
