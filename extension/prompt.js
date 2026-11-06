(() => {
  if (window.top !== window || location.protocol !== "https:" || globalThis.yubiKeyFillPrompt) return;
  globalThis.yubiKeyFillPrompt = true;
  const controls = globalThis.yubiKeyFillField;
  let anchor, host, shadow, detail, fillButton, observer, dismissTimer;
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

  async function requestCode(event) {
    if (!event.isTrusted || waiting || host?.parentNode !== document.documentElement
        || host.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) === false
        || !document.hasFocus()
        || controls.field() !== anchor) return;
    const currentHost = host;
    const requestedField = anchor;
    waiting = true;
    fillButton.disabled = true;
    fillButton.textContent = "Waiting for YubiKey…";
    detail.textContent = "Reading your key. Touch it if it flashes.";
    position();
    controls.markClick(requestedField);
    let result;
    try {
      result = await chrome.runtime.sendMessage({ kind: "prompt-fill" });
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

  function show(input) {
    anchor = input;
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
    detail = element("div", "detail", "Use your security key");
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
    fillButton.addEventListener("click", requestCode);
    header.append(logo, copy, dismiss);
    card.append(header, fillButton);
    shadow.append(card);
    document.documentElement.append(host);
    position();
    if (host) {
      observer = new MutationObserver(position);
      observer.observe(document.documentElement, { subtree: true, childList: true });
    }
  }

  async function offer() {
    if (host || waiting || document.activeElement?.tagName !== "INPUT"
        || document.activeElement === dismissed) return;
    const input = document.activeElement;
    const attempt = ++generation;
    const url = location.href;
    try {
      const result = await chrome.runtime.sendMessage({ kind: "prompt-status" });
      if (result?.ok && attempt === generation && location.href === url
          && document.activeElement === input && controls.field() === input) show(input);
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
    else void offer();
  });
  window.addEventListener("pagehide", close);
  window.addEventListener("pageshow", offer);
  window.addEventListener("focus", offer);
  window.addEventListener("scroll", position, { capture: true, passive: true });
  window.addEventListener("resize", position);
  void offer();
})();
