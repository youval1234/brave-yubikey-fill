(() => {
  // This state lives in Brave's isolated world and is shared with the prompt.
  const version = globalThis.chrome?.runtime?.getManifest?.().version || "test";
  if (globalThis.yubiKeyFillField?.version === version) return;
  let pending;
  let completed;
  let completionGeneration = 0;
  let clicked;
  let hovered, hoverHost;
  const selector = [
    'input[autocomplete~="one-time-code" i]',
    'input#auth-mfa-otpcode[name="otpCode"]',
    'form#unified-otp-form input#ap_otp_code[name="otpCode"]',
    'input[name="otp" i], input[name="otpCode" i], input[name="totp" i]',
    'input[name="verificationCode" i], input[name="twoFactorCode" i], input#otp',
  ].join(", ");

  function sameOriginAction(value) {
    try {
      const url = new URL(value || location.href, document.baseURI || location.href);
      return url.origin === location.origin && !url.username && !url.password;
    } catch {
      return false;
    }
  }

  function usable(input) {
    if (!["text", "tel", "number", "password"].includes(input.type)
        || input.matches(":disabled, [readonly]") || input.closest("[inert], [aria-hidden='true']")) return false;
    const style = getComputedStyle(input);
    return input.getClientRects().length > 0
      && input.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false
      && style.visibility === "visible" && style.opacity !== "0";
  }

  function safeDestination(input) {
    const form = input.form;
    if (!form) return true;
    const attr = Element.prototype.getAttribute;
    if (!sameOriginAction(attr.call(form, "action"))) return false;
    return ![...document.querySelectorAll("button[formaction], input[formaction]")].some((button) =>
      button.form === form && !sameOriginAction(attr.call(button, "formaction")));
  }

  function splitGroups() {
    const groups = [];
    for (const group of document.querySelectorAll('[role="group"], fieldset, [data-otp-group], #pin-boxes')) {
      const inputs = [...group.querySelectorAll("input")];
      if (![6, 8].includes(inputs.length) || !inputs.every(usable)
          || !inputs.every(input => input.form === inputs[0].form) || !safeDestination(inputs[0])) continue;
      // eBay's digit controls use maxlength=6 even though each box holds one digit.
      const ebay = group.id === "pin-boxes" && inputs.length === 6
        && inputs.every((input, index) => input.id === "pin-box-" + index && input.maxLength === 6);
      const semantic = [group.id, group.getAttribute("aria-label"),
        ...inputs.map(input => input.name + " " + input.autocomplete)].join(" ");
      const generic = inputs.every(input => input.maxLength === 1)
        && /one-time-code|otp|totp|verification|authenticat|security.?code|sicherheitscode/i.test(semantic);
      if (!ebay && !generic) continue;
      if (!groups.some(existing => existing.length === inputs.length && existing.every((input, index) => input === inputs[index]))) groups.push(inputs);
    }
    return groups;
  }

  function selection(allowFilled = false) {
    if (window.top !== window || document.visibilityState !== "visible") return null;
    const groups = splitGroups();
    const grouped = new Set(groups.flat());
    let inputs = [...document.querySelectorAll(selector)];
    if (!inputs.length) {
      const labeled = [...document.querySelectorAll('input[type="text"], input[type="tel"], input[type="number"], input:not([type])')]
        .filter((input) => /\bcode\b/i.test([
          input.placeholder || "", input.getAttribute?.("aria-label") || "",
          ...[...(input.labels || [])].map((label) => label.textContent),
        ].join(" ")));
      if (labeled.length && /authenticat(?:ion|or) app|two.step verification|security challenge/i.test(document.body?.innerText || "")) {
        inputs = labeled;
      }
    }
    const singles = inputs.filter(input => !grouped.has(input) && usable(input)
      && (input.maxLength < 0 || input.maxLength >= 6));
    const candidates = [...groups, ...singles.map(input => [input])];
    if (candidates.length !== 1) return null;
    const result = candidates[0];
    if (!safeDestination(result[0]) || (!allowFilled && result.some(input => input.value))) return null;
    return result;
  }

  function field() {
    return selection()?.[0] || null;
  }

  function clearCompleted() {
    completionGeneration++;
    if (!completed) return;
    clearTimeout(completed.timer);
    if (completed.form) EventTarget.prototype.removeEventListener.call(completed.form, "submit", completed.onSubmit, true);
    completed = null;
  }

  function defaultSubmitter(form) {
    return [...document.querySelectorAll('button, input[type="submit"], input[type="image"]')]
      .find(button => button.form === form && ["submit", "image"].includes(button.type));
  }

  function submitSignature(form, button) {
    const attr = Element.prototype.getAttribute;
    return JSON.stringify([
      new URL(attr.call(form, "action") || location.href, document.baseURI || location.href).href,
      ...["method", "target", "enctype", "novalidate"].map(name => attr.call(form, name)),
      button && ["formaction", "formmethod", "formtarget", "formenctype", "formnovalidate"]
        .map(name => attr.call(button, name)),
    ]);
  }

  function probe(url, marker, inline) {
    clearCompleted();
    const anchor = clicked;
    clicked = null;
    pending = null;
    const inputs = location.href === url && selection();
    if (!inputs || (inline && anchor !== inputs[0])) return false;
    pending = { marker, inputs };
    return true;
  }

  function fill(url, marker, code, expiresAt) {
    clearCompleted();
    const original = pending;
    pending = null;
    const inputs = location.href === url && selection();
    if (!inputs || original?.marker !== marker
        || original.inputs.length !== inputs.length || !inputs.every((input, index) => input === original.inputs[index])
        || Date.now() + 3000 >= expiresAt
        || typeof code !== "string" || !/^[0-9]{6,8}$/.test(code)
        || (inputs.length > 1 && inputs.length !== code.length)
        || (inputs.length === 1 && inputs[0].maxLength >= 0 && inputs[0].maxLength < code.length)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const record = { marker, inputs, url, expiresAt, form: inputs[0].form || null,
      generation: completionGeneration, submitted: false };
    if (record.form) {
      record.submitter = defaultSubmitter(record.form);
      record.signature = submitSignature(record.form, record.submitter);
    }
    record.onSubmit = event => { if (event.target === record.form) record.submitted = true; };
    if (record.form) EventTarget.prototype.addEventListener.call(record.form, "submit", record.onSubmit, true);
    completed = record;
    record.timer = setTimeout(clearCompleted, 1500);
    for (let index = 0; index < inputs.length; index++) {
      // Page input handlers can replace controls or change the destination.
      // Revalidate all identities, destinations and expected values before
      // releasing the next digit, including after synchronous re-rendering.
      const current = location.href === url && selection(true);
      if (!current || Date.now() + 3000 >= expiresAt || current.length !== inputs.length
          || !current.every((input, offset) => input === inputs[offset]
            && input.value === (offset < index ? code[offset] : ""))) {
        clearCompleted();
        return false;
      }
      setter.call(inputs[index], inputs.length === 1 ? code : code[index]);
      inputs[index].dispatchEvent(new Event("input", { bubbles: true }));
    }
    record.values = inputs.map((_input, index) => inputs.length === 1 ? code : code[index]);
    return true;
  }

  async function submit(url, marker) {
    const record = completed;
    if (!record || record.marker !== marker || record.url !== url) return false;
    completed = null; // Consume this authorization before any page event runs.
    clearTimeout(record.timer);
    try {
      // Let input handlers/microtasks finish; a background tab cannot defer an
      // authorization indefinitely. This is one bounded wait, not polling.
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 50);
        requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
      });
      if (record.generation !== completionGeneration || location.href !== url
          || document.visibilityState !== "visible" || !document.hasFocus()
          || Date.now() + 3000 >= record.expiresAt) return false;
      if (record.submitted) return true; // The website already submitted on input.
      const current = selection(true);
      if (!current || current.length !== record.inputs.length
          || !current.every((input, index) => input === record.inputs[index]
            && input.value === record.values[index] && input.form === record.inputs[0].form)
          || (current[0].form || null) !== record.form) return false;
      const input = current.at(-1);
      input.focus({preventScroll:true});
      if (record.generation !== completionGeneration || Date.now() + 3000 >= record.expiresAt) return false;
      if (record.submitted) return true;
      const focused = location.href === url && document.hasFocus() && selection(true);
      if (!focused || (focused[0].form || null) !== record.form
          || focused.length !== current.length || !focused.every((node, index) =>
        node === current[index] && node.value === record.values[index])) return false;
      if (record.form) {
        const button = defaultSubmitter(record.form);
        if (button !== record.submitter || submitSignature(record.form, button) !== record.signature) return false;
        if (button && (button.matches(":disabled") || button.getAttribute("aria-disabled") === "true"
            || !button.getClientRects().length
            || button.checkVisibility?.({checkOpacity:true,checkVisibilityCSS:true}) === false)) return false;
        // Use the native method; named controls can shadow form.requestSubmit.
        HTMLFormElement.prototype.requestSubmit.call(record.form, button);
        return record.submitted;
      }
      // Form-less widgets may implement their own Enter handler. Synthetic
      // keys have no native submit default; never send a global OS keystroke.
      for (const type of ["keydown", "keyup"]) {
        if (location.href !== url || !document.hasFocus()) break;
        input.dispatchEvent(new KeyboardEvent(type, {key:"Enter",code:"Enter",keyCode:13,which:13,
          bubbles:true,cancelable:true,composed:true}));
      }
      return true;
    } finally {
      if (record.form) EventTarget.prototype.removeEventListener.call(record.form, "submit", record.onSubmit, true);
    }
  }

  globalThis.yubiKeyFillField = {
    version,
    field, probe, fill, submit,
    fieldFor(input) { const inputs = selection(); return inputs?.includes(input) ? inputs[0] : null; },
    isHovered() { return Boolean(selection()?.some(input => input.matches(":hover"))); },
    markClick(input) { clicked = input; },
    clearClick() { clicked = null; },
    markHover(input, host) { hovered = input; hoverHost = host; },
    previewProbe(url) {
      const inputs = location.href === url && document.hasFocus() && selection();
      return Boolean(inputs && inputs[0] === hovered
        && (inputs.some(input => input.matches(":hover")) || hoverHost?.matches(":hover")));
    },
  };
})();
