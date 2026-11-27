import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_BINDINGS,
  displaySpec,
  formatCombo,
  matchesBinding,
  parseSpec,
  rejectionReason,
} from "./keybindings.ts";
import { initPlatform } from "./platform.ts";

function fakeEvent(init) {
  return {
    key: init.key,
    ctrlKey: Boolean(init.ctrlKey),
    altKey: Boolean(init.altKey),
    shiftKey: Boolean(init.shiftKey),
    metaKey: Boolean(init.metaKey),
  };
}

test("includes app.commandPalette default binding and rejects malformed specs", () => {
  initPlatform("windows");
  assert.equal(DEFAULT_BINDINGS["app.commandPalette"], "Ctrl+Shift+p");
  assert.equal(displaySpec(DEFAULT_BINDINGS["app.commandPalette"]), "Ctrl+Shift+P");
  assert.equal(parseSpec(""), null);
  const parsed = parseSpec("Ctrl+Shift+P");
  assert.deepEqual(parsed, { ctrl: true, alt: false, shift: true, key: "p" });
  assert.equal(formatCombo(parsed), "Ctrl+Shift+p");
});

test("allows controlled Ctrl+letter and Ctrl+Shift+letter while enforcing blacklists", () => {
  initPlatform("windows");
  // Safe letters are permitted
  assert.equal(rejectionReason(parseSpec("Ctrl+K")), null);
  assert.equal(rejectionReason(parseSpec("Ctrl+Shift+P")), null);
  assert.equal(rejectionReason(parseSpec("Ctrl+Shift+K")), null);

  // System / clipboard / WebView2 reserved letters stay blocked
  assert.equal(rejectionReason(parseSpec("Ctrl+C"))?.key, "settings.keybindRejectCtrlLetter");
  assert.equal(rejectionReason(parseSpec("Ctrl+V"))?.key, "settings.keybindRejectCtrlLetter");
  assert.equal(
    rejectionReason(parseSpec("Ctrl+Shift+I"))?.key,
    "settings.keybindRejectCtrlShiftLetter",
  );
  assert.equal(
    rejectionReason(parseSpec("Ctrl+Shift+R"))?.key,
    "settings.keybindRejectCtrlShiftLetter",
  );

  // Shift with non-letter and Ctrl+Alt stay rejected
  assert.equal(rejectionReason(parseSpec("Shift+A"))?.key, "settings.keybindRejectNoModifier");
  assert.equal(rejectionReason(parseSpec("Alt+Shift+A"))?.key, "settings.keybindRejectShift");
  assert.equal(rejectionReason(parseSpec("Ctrl+Alt+K"))?.key, "settings.keybindRejectCtrlAltWin");
});

test("matches letter shift strictly while preserving symbol shift flexibility", () => {
  initPlatform("windows");
  assert.equal(
    matchesBinding("Ctrl+Shift+P", fakeEvent({ key: "P", ctrlKey: true, shiftKey: true })),
    true,
  );
  assert.equal(
    matchesBinding("Ctrl+K", fakeEvent({ key: "k", ctrlKey: true, shiftKey: false })),
    true,
  );
  assert.equal(
    matchesBinding("Ctrl+K", fakeEvent({ key: "K", ctrlKey: true, shiftKey: true })),
    false,
  );
  assert.equal(
    matchesBinding("Ctrl+=", fakeEvent({ key: "+", ctrlKey: true, shiftKey: true })),
    true,
  );
});
