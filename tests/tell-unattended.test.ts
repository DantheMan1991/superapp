import { describe, expect, it } from "vitest";
import { readyToRecordUnasked } from "../src/lib/tell-sources/shape";
import type { TellCard } from "../src/lib/tell-sources/shape";
import type { TellField } from "../src/lib/tell-sources/types";

/**
 * The one condition under which a model's output reaches a tenant's data with
 * no person in between (ADR 0050).
 *
 * ADR 0039's rule is that the model never writes, and this is its single
 * amendment. Every test below is a way the amendment could quietly grow past
 * what it was allowed to be — which is the failure mode that matters here,
 * because nothing goes red when a confirm step silently stops being asked for.
 */

const noteField: TellField = {
  key: "note",
  label: "What you are starting on",
  kind: "text",
  hint: "optional",
};

const headField: TellField = {
  key: "head",
  label: "How many",
  kind: "number",
  required: true,
  hint: "how many",
};

const clockIn = { slug: "time.clock_in", unattended: true, fields: [noteField] };
const loss = { slug: "livestock.loss", unattended: false, fields: [headField] };
const unsafeButComplete = {
  slug: "livestock.check",
  unattended: false,
  fields: [noteField],
};

const card = (
  actionSlug: string,
  values: TellCard["values"] = {},
  hints: TellCard["hints"] = {},
): TellCard => ({ actionSlug, values, hints });

describe("recording without being asked", () => {
  it("goes straight through for a complete card of a declared-safe action", () => {
    expect(
      readyToRecordUnasked([card("time.clock_in", { note: "fencing" })], [clockIn]),
    ).toBe(true);
  });

  it("goes through when the only optional field is empty", () => {
    // "Clock me in" with nothing else said is the commonest sentence there is.
    expect(readyToRecordUnasked([card("time.clock_in", {})], [clockIn])).toBe(true);
  });

  it("NEVER goes through for an action that did not declare itself", () => {
    // The default is no, and the default is the rule.
    expect(
      readyToRecordUnasked([card("livestock.loss", { head: 3 })], [loss]),
    ).toBe(false);
  });

  it("stops the WHOLE batch when one card dissents", () => {
    // Two things said in one sentence happened together. Half of them landing
    // while the other half waits is the worst of both.
    expect(
      readyToRecordUnasked(
        [card("time.clock_in", {}), card("livestock.loss", { head: 3 })],
        [clockIn, loss],
      ),
    ).toBe(false);
  });

  it("stops on a hint, because a hint is a word that matched nothing", () => {
    expect(
      readyToRecordUnasked(
        [card("time.clock_in", { note: null }, { note: "the north pen" })],
        [clockIn],
      ),
    ).toBe(false);
  });

  it("stops when a required field is empty", () => {
    const safeLoss = { ...loss, unattended: true };
    expect(
      readyToRecordUnasked([card("livestock.loss", { head: null })], [safeLoss]),
    ).toBe(false);
  });

  it("stops when a field holds the wrong kind of thing", () => {
    const safeLoss = { ...loss, unattended: true };
    expect(
      readyToRecordUnasked(
        [card("livestock.loss", { head: "three" })],
        [safeLoss],
      ),
    ).toBe(false);
  });

  it("stops when the card names an action that is not on offer", () => {
    // A slug the tenant does not have cannot be judged, so it is not cleared.
    expect(readyToRecordUnasked([card("time.clock_in", {})], [loss])).toBe(false);
  });

  it("is false for an empty batch, which is not the same as all clear", () => {
    expect(readyToRecordUnasked([], [clockIn])).toBe(false);
  });

  it("is false when nothing is on offer at all", () => {
    expect(readyToRecordUnasked([card("time.clock_in", {})], [])).toBe(false);
  });

  it("does not clear a complete card just because it is complete", () => {
    // The whole point: completeness is necessary and never sufficient.
    expect(
      readyToRecordUnasked(
        [card("livestock.check", { note: "all well" })],
        [unsafeButComplete],
      ),
    ).toBe(false);
  });
});
