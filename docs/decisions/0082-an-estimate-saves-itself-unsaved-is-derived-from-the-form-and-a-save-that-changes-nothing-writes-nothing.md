# 0082. An estimate saves itself, "unsaved" is derived from the form rather than flagged, and a save that changes nothing writes nothing

- **Status:** Accepted
- **Date:** 2026-09-17
- **Deciders:** founder, from the estimate review's "think speed"; the second half of it, after [ADR 0081](0081-an-estimate-line-can-be-typed-as-one-sentence-and-the-grammar-that-reads-it-is-pure-and-refuses-what-it-cannot-read.md)

## Context

[ADR 0081](0081-an-estimate-line-can-be-typed-as-one-sentence-and-the-grammar-that-reads-it-is-pure-and-refuses-what-it-cannot-read.md)
made lines fast to get IN. What was left was the other half of the
complaint, and the part that can lose an afternoon: **one Save button at
the bottom of a form holding every line of the estimate.** Three separate
problems in one shape —

- **You can lose the lot.** A closed tab, a stray navigation, a laptop lid,
  and two hours of takeoff is gone with no warning.
- **You cannot tell what is saved.** The button looks the same whether the
  form matches the database or has forty unsaved changes in it.
- **Saving rewrites everything.** `saveLines` UPDATEs every row it is given,
  so a two-hundred-line estimate is two hundred UPDATEs whether one cell
  changed or none did — which is exactly what makes saving-on-a-timer
  impossible.

The obvious answer — per-row server actions, one call per cell — was
considered and is the wrong shape here: it splits one document into two
hundred independently-failing writes, needs its own dirty tracking, and
invents a second concurrency model beside the estimate's `version` for
rows that are edited together and read together.

## Decision

**THE FORM SAVES ITSELF, 1.2 SECONDS AFTER TYPING STOPS**, and the explicit
Save stays for people who want to press something. One action, one payload,
the whole estimate — the same call that has always been there. An autosave
passes `quiet`, which means no toast and **no revalidation**, so the page
does not re-render under the cursor; the explicit Save refreshes, and so
does the next navigation.

**"UNSAVED" IS DERIVED FROM THE PAYLOAD, NEVER FLAGGED BY A SETTER.** The
payload is built in one function, stringified, and compared with what was
last saved. So a field added to the form is watched with nothing to
remember — the alternative is twenty `setDirty(true)` calls, one of which
is eventually missing, and a screen that says "Saved" over work that is
not. What was SENT becomes the saved snapshot, so anything typed during a
save stays unsaved and is picked up by the next one.

**THE VERSION IS NOT CONTENT, AND MUST NOT BE COMPARED.** It rides along at
send time and is held in the client, advancing with each save's reply,
because the props do not move until the page navigates — and every verb
that guards on a version (accept, use as budget, use as schedule) is handed
this one rather than the stale prop. Comparing it was a real bug, found by
driving: each successful save came back with a new version, which made the
form dirty against its own snapshot, which saved again. Two POSTs and a
status stuck on *Unsaved changes* over work that was, in fact, on disk.

**A SAVE THAT CHANGES NOTHING WRITES NOTHING, AND THE VERSION DOES NOT
MOVE.** This is what makes a timer safe rather than expensive:

- A line or an item whose row already holds every value being written is
  skipped. `rowHolds` **derives its comparison from the keys of the values
  it is about to write**, so a column added to the write is compared
  without anybody adding it to a list — a hand-written field list is how a
  save quietly stops persisting one field. A non-primitive would never
  compare equal and the row would simply be written, which is the safe
  direction to fail in.
- If no child row was inserted, changed or removed **and** the estimate's
  own columns already hold the patch, the estimate row is not updated at
  all: no `updated_at`, no `version`. Otherwise a timer on an untouched
  screen churns the version and the next real edit is refused as stale.
- And an unchanged save is not an edit, so it writes no audit row. The
  audit trail is for what people did, not for what a timer did.

**A FAILED AUTOSAVE IS AS LOUD AS A FAILED SAVE** — the same toast, and the
status reads *Not saved — try Save*. Silence would be the one failure this
whole decision exists to prevent.

## Consequences

- No migration, no new action, no new op. `saveLines` and `saveGroups`
  return what they touched; `updateEstimate` skips its own write when
  nothing moved; `updateEstimateAction` takes `quiet` and returns the new
  `version`.
- The editor holds `version`, `savedJson` and `failed`, and the save
  function lives in a ref assigned in an effect — **not during render**,
  because writing a ref while rendering is impure and the lint rule that
  says so is right.
- **The drift guard is a test, not a promise.** A db-backed scenario patches
  every field a line writes, one at a time, and asserts the version moved
  for each and then did not move when the same form was sent again.
  Eleven fields, plus reordering, plus an item's own values. A field that
  stopped being compared would leave the version standing still, and the
  test says which one.
- **Not built, and not lumped in here:** keyboard grid navigation — arrows
  and Tab between cells, Enter on the last row making another. It is
  **E3c**. It shares nothing with this slice but the file, and pretending
  otherwise is how half a slice gets delivered as a whole one.

## Alternatives considered

- **Per-row server actions.** Rejected above: two hundred independently
  failing writes and a second concurrency model for rows that are edited
  and read as one document.
- **A dirty flag set by each setter.** Rejected: see the derivation rule.
  The bug it invites is the one that matters most — a screen that says
  "Saved" wrongly.
- **Autosave with no explicit Save at all.** Rejected: the button is also
  how somebody says "I am done", and it is the only thing that refreshes
  the figures beside the editor.
- **Save 1.2s after the first change rather than after the last.** That is
  what the first attempt did, because the effect's dependencies left out
  the payload. Rejected on reading it: a save landing mid-word, repeatedly,
  through a long line.
- **Leave the version out of the client and re-read the page after each
  save.** Rejected: that is the re-render under the cursor that `quiet`
  exists to avoid.
