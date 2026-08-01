import { describe, expect, it } from "vitest";
import {
  isEditingTarget,
  moveCursor,
  resolveShortcut,
  SHORTCUT_HELP,
  type KeyEventLike,
} from "@/modules/email/triage/keymap";

function press(key: string, mods: Partial<KeyEventLike> = {}): KeyEventLike {
  return { key, ctrlKey: false, metaKey: false, altKey: false, ...mods };
}

describe("mail keymap", () => {
  it("maps the letters every mail client uses", () => {
    const reading = { isEditing: false };
    expect(resolveShortcut(press("j"), reading)).toBe("next");
    expect(resolveShortcut(press("k"), reading)).toBe("previous");
    expect(resolveShortcut(press("e"), reading)).toBe("archive");
    expect(resolveShortcut(press("s"), reading)).toBe("star");
    expect(resolveShortcut(press("#"), reading)).toBe("trash");
    expect(resolveShortcut(press("c"), reading)).toBe("compose");
    expect(resolveShortcut(press("/"), reading)).toBe("search");
  });

  it("accepts the arrow keys as well as j and k", () => {
    // Somebody who has never used mutt still expects arrows to move a list.
    const reading = { isEditing: false };
    expect(resolveShortcut(press("ArrowDown"), reading)).toBe("next");
    expect(resolveShortcut(press("ArrowUp"), reading)).toBe("previous");
  });

  it("declines every modified key", () => {
    // Ctrl-R is reload, Cmd-F is find. Stealing those breaks the browser
    // rather than extending it, and the user has nowhere to complain to.
    const reading = { isEditing: false };
    expect(resolveShortcut(press("r", { ctrlKey: true }), reading)).toBeNull();
    expect(resolveShortcut(press("c", { metaKey: true }), reading)).toBeNull();
    expect(resolveShortcut(press("s", { altKey: true }), reading)).toBeNull();
  });

  it("goes silent while the user is typing, except for Escape", () => {
    // The bug this prevents: typing "There" into a reply archives the thread
    // on the E and trashes it on the R.
    const typing = { isEditing: true };
    expect(resolveShortcut(press("e"), typing)).toBeNull();
    expect(resolveShortcut(press("r"), typing)).toBeNull();
    expect(resolveShortcut(press("j"), typing)).toBeNull();
    expect(resolveShortcut(press("#"), typing)).toBeNull();
    // But the composer still needs a door.
    expect(resolveShortcut(press("Escape"), typing)).toBe("close");
  });

  it("ignores keys it has no opinion about", () => {
    const reading = { isEditing: false };
    expect(resolveShortcut(press("q"), reading)).toBeNull();
    expect(resolveShortcut(press("F5"), reading)).toBeNull();
    expect(resolveShortcut(press("Tab"), reading)).toBeNull();
  });

  it("distinguishes shifted letters from their lowercase meaning", () => {
    // `I` and `U` are read/unread; `i` and `u` are nothing. A case-insensitive
    // lookup would make lowercase i mark things read by accident.
    const reading = { isEditing: false };
    expect(resolveShortcut(press("I"), reading)).toBe("read");
    expect(resolveShortcut(press("U"), reading)).toBe("unread");
    expect(resolveShortcut(press("i"), reading)).toBeNull();
    expect(resolveShortcut(press("u"), reading)).toBeNull();
  });

  it("documents every shortcut it implements", () => {
    // The help panel drifting out of date is how a shortcut becomes folklore.
    expect(SHORTCUT_HELP.length).toBeGreaterThan(0);
    for (const entry of SHORTCUT_HELP) {
      expect(entry.keys.trim()).not.toBe("");
      expect(entry.does.trim()).not.toBe("");
    }
  });
});

describe("moveCursor", () => {
  it("moves within the list", () => {
    expect(moveCursor(5, 0, "next")).toBe(1);
    expect(moveCursor(5, 3, "next")).toBe(4);
    expect(moveCursor(5, 3, "previous")).toBe(2);
  });

  it("lands on the first row when nothing is open", () => {
    // Otherwise the keyboard needs a click to prime it, which defeats it.
    expect(moveCursor(5, -1, "next")).toBe(0);
    expect(moveCursor(5, -1, "previous")).toBe(0);
  });

  it("stops at the ends instead of wrapping", () => {
    // Wrapping means holding j at the bottom silently teleports you to the
    // top, and the next # deletes something you were not looking at.
    expect(moveCursor(5, 4, "next")).toBeNull();
    expect(moveCursor(5, 0, "previous")).toBeNull();
  });

  it("has nowhere to go in an empty list", () => {
    expect(moveCursor(0, -1, "next")).toBeNull();
    expect(moveCursor(0, 0, "previous")).toBeNull();
  });

  it("handles a single row without moving off it", () => {
    expect(moveCursor(1, -1, "next")).toBe(0);
    expect(moveCursor(1, 0, "next")).toBeNull();
    expect(moveCursor(1, 0, "previous")).toBeNull();
  });
});

describe("isEditingTarget", () => {
  it("treats a contenteditable as typing, not just inputs", () => {
    // The one that gets forgotten: a rich composer is a div, so a tagName-only
    // check would swallow every letter typed into a reply.
    expect(isEditingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("recognises the form elements", () => {
    expect(isEditingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isEditingTarget({ tagName: "SELECT" })).toBe(true);
  });

  it("says no to everything else, including nothing at all", () => {
    expect(isEditingTarget({ tagName: "DIV" })).toBe(false);
    expect(isEditingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isEditingTarget(null)).toBe(false);
    expect(isEditingTarget(undefined)).toBe(false);
    // `document` as a target: no tagName, and must not throw.
    expect(isEditingTarget({})).toBe(false);
  });
});
