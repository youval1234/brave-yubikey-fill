// Chrome serializes this function into the extension's isolated world.
export function otpField(url, marker, code, expiresAt) {
  const slot = "__braveYubiKeyFillField";
  if (location.href !== url || window.top !== window || document.visibilityState !== "visible") {
    delete globalThis[slot];
    return false;
  }
  const candidates = [...document.querySelectorAll('input[autocomplete~="one-time-code" i]')]
    .filter((input) => ["text", "tel", "number", "password"].includes(input.type)
      && !input.matches(":disabled, [readonly]")
      && !input.closest("[inert], [aria-hidden='true']")
      && input.getClientRects().length > 0
      && getComputedStyle(input).visibility === "visible"
      && (input.maxLength < 0 || input.maxLength >= 6));

  const input = candidates.length === 1 ? candidates[0] : null;
  // An explicit form destination must also stay on the approved origin.
  const validDestination = input && (!input.form
    || new URL(input.form.action, location.href).origin === location.origin);
  if (!code) {
    delete globalThis[slot];
    if (!validDestination || input.value) return false;
    globalThis[slot] = { marker, input };
    return true;
  }
  const original = globalThis[slot];
  delete globalThis[slot];
  if (!validDestination || original?.marker !== marker || original.input !== input
      || input.value || Date.now() + 3000 >= expiresAt
      || (input.maxLength >= 0 && input.maxLength < code.length)) return false;

  // Use the native setter so the framework can observe the input event.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, code);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}
