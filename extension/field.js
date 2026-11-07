(() => {
  // This state lives in Brave's isolated world and is shared with the prompt.
  if (globalThis.yubiKeyFillField) return;
  let pending;
  let clicked;
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

  function field() {
    if (window.top !== window || document.visibilityState !== "visible") return null;
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
    const candidates = inputs.filter((input) => {
      const style = getComputedStyle(input);
      return ["text", "tel", "number", "password"].includes(input.type)
        && !input.matches(":disabled, [readonly]")
        && !input.closest("[inert], [aria-hidden='true']")
        && input.getClientRects().length > 0
        && input.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false
        && style.visibility === "visible" && style.opacity !== "0"
        && (input.maxLength < 0 || input.maxLength >= 6);
    });
    const input = candidates.length === 1 ? candidates[0] : null;
    if (!input || input.value) return null;
    const form = input.form;
    if (form) {
      // Named form controls can shadow form.action and even form.getAttribute.
      const attr = Element.prototype.getAttribute;
      if (!sameOriginAction(attr.call(form, "action"))) return null;
      const overrides = document.querySelectorAll("button[formaction], input[formaction]");
      if ([...overrides].some((button) => button.form === form
          && !sameOriginAction(attr.call(button, "formaction")))) return null;
    }
    return input;
  }

  function probe(url, marker, inline) {
    const anchor = clicked;
    clicked = null;
    pending = null;
    const input = location.href === url && field();
    if (!input || (inline && anchor !== input)) return false;
    pending = { marker, input };
    return true;
  }

  function fill(url, marker, code, expiresAt) {
    const original = pending;
    pending = null;
    const input = location.href === url && field();
    if (!input || original?.marker !== marker || original.input !== input
        || Date.now() + 3000 >= expiresAt
        || (input.maxLength >= 0 && input.maxLength < code.length)) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, code);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  globalThis.yubiKeyFillField = {
    field, probe, fill,
    markClick(input) { clicked = input; },
    clearClick() { clicked = null; },
  };
})();
