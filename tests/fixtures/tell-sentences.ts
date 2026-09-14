/**
 * THE GOLDEN SET — what somebody says, and which verb it has to become.
 *
 * ── WHY THIS EXISTS (tell.md, slice A1) ──────────────────────────────────────
 *
 * Every action a tenant has goes into ONE tool description (`tellToolFor`).
 * Eight actions today; all sixteen possible sources filled is sixty-plus, and
 * many of them are near-synonyms ACROSS module boundaries — "log a cost" in
 * inventory against "record a bill" in accounting, "add a job" in work against
 * "book it" in scheduling.
 *
 * **The model picking the wrong MODULE is a likelier failure than it misreading
 * a number, and it is the one that will make this feel broken.** It is also
 * invisible: nothing throws, nothing is refused, a plausible card appears
 * against the wrong verb and somebody presses Record.
 *
 * So the catalogue gets a measurement before it gets bigger. `npm run tell:eval`
 * runs these against the live model and reports an accuracy figure and, more
 * usefully, WHAT IT PICKED INSTEAD.
 *
 * ── WHAT EARNS A PLACE HERE ──────────────────────────────────────────────────
 *
 * Not the sentences already written into an action's `about`. Those are the
 * answers printed on the back of the paper; a model reciting them proves
 * nothing. What earns a place is a sentence that could plausibly go somewhere
 * else — a synonym nobody wrote down, a verb that belongs to two modules, a
 * sentence whose SUBJECT is one module and whose ACTION is another.
 *
 * Every case says `why` in one line. A case that cannot say why it is hard
 * should be deleted, because it costs a model call on every run and answers
 * nothing.
 */

export interface TellCase {
  /** What somebody says, in their own words. */
  said: string;
  /**
   * The action slugs this must produce, order-insensitive. More than one is a
   * sentence that holds more than one thing — the box supports that and almost
   * nothing shows it off.
   */
  expect: string[];
  /**
   * Other whole answers that are defensible rather than wrong.
   *
   * A genuinely ambiguous sentence is a fact about English, not a bug, and
   * scoring it as a failure would push the catalogue towards fixing the model
   * instead of fixing the words. Recorded rather than argued about.
   */
  tolerate?: string[][];
  /** Why this one is hard. One line. Delete a case that cannot answer. */
  why: string;
  /**
   * SOURCE slugs — the things in `tellSources` — and never a module name.
   *
   * The runner SKIPS a case whose sources are not all contributing, so a case
   * naming a module that has no source yet (`land`, `inventory`) never runs
   * and the accuracy figure goes UP by losing its hardest cases. That happened
   * on the first run of this file, to four of its twenty-two. What a case needs
   * beyond a source — zones to move onto, feed to give — is a fact about the
   * tenant, and a tenant that cannot answer should FAIL the case loudly rather
   * than drop it quietly.
   */
  needs: string[];
}

export const TELL_CASES: readonly TellCase[] = [
  /* ── time ─────────────────────────────────────────────────────────────── */
  {
    said: "clock me in",
    expect: ["time.clock_in"],
    why: "The baseline. If this ever fails, something structural broke.",
    needs: ["time"],
  },
  {
    said: "starting now",
    expect: ["time.clock_in"],
    why: "No clock word at all — the shortest thing anybody actually says.",
    needs: ["time"],
  },
  {
    said: "that's me done for the day",
    expect: ["time.clock_out"],
    why: "Idiom with no clock word, and 'done' is work.done's whole territory.",
    needs: ["time", "work"],
  },
  {
    said: "add a job to clock in the new lad on Monday",
    expect: ["work.add"],
    why: "THE TRAP. Says 'clock in' and means a job. Subject of one module, verb of another.",
    needs: ["time", "work"],
  },

  /* ── work ─────────────────────────────────────────────────────────────── */
  {
    said: "someone needs to look at the pump in the far shed",
    expect: ["work.add"],
    why: "A job with no imperative and no 'job' — it describes a state, not a request.",
    needs: ["work"],
  },
  {
    said: "don't let me forget the vet is coming Thursday",
    expect: ["work.add"],
    why: "A reminder phrased as a negative, with a date that is not today.",
    needs: ["work"],
  },
  {
    said: "sorted the top gate",
    expect: ["work.done"],
    why: "Past tense with no 'job': done, not a new one. The pair this and 'the top gate needs fixing' must split.",
    needs: ["work"],
  },
  {
    said: "the top gate needs fixing",
    expect: ["work.add"],
    why: "Same noun as the case above, opposite verb. If both land on one action the about texts are not doing their job.",
    needs: ["work"],
  },

  /* ── livestock ────────────────────────────────────────────────────────── */
  {
    said: "we lost Bluebell overnight",
    expect: ["livestock.loss"],
    why: "'Lost' about a NAMED animal, not a pen, and no number said — head must be left blank rather than guessed at 1.",
    needs: ["livestock"],
  },
  {
    said: "two of the steers went to the sale barn",
    expect: ["livestock.loss"],
    why: "A sale is a loss of head here, and nothing in the sentence says 'dead' or 'lost'.",
    needs: ["livestock"],
  },
  {
    said: "had a look at the broilers, all quiet",
    expect: ["livestock.check"],
    why: "A GOOD observation. It used to be impossible to record one without flagging a problem.",
    needs: ["livestock"],
  },
  {
    said: "walked the pens, nothing to report",
    expect: ["livestock.check"],
    why: "A check with no subject the search can name — the shortlist has to become a question rather than a guess.",
    needs: ["livestock"],
  },
  {
    said: "put the cows out on the creek field this morning",
    expect: ["livestock.move"],
    why: "'Put out on' rather than 'moved to', and 'the cows' is a species word, not a name.",
    needs: ["livestock"],
  },
  {
    said: "gave the broilers forty pounds of crumble",
    expect: ["livestock.feed"],
    why: "A real unit said plainly. The quantity must survive as 40, not become 'forty pounds'.",
    needs: ["livestock"],
  },
  {
    said: "fed the broilers two bags",
    expect: ["livestock.feed"],
    why: "Two traps in one. 'Bags' is not a unit this pack knows, so the amount must be LEFT BLANK rather than converted — and since inventory can be told, this must still reach the PEN, because stock leaving without reaching a lot loses the feed cost the pack exists to carry.",
    needs: ["livestock", "inventory"],
  },

  /* ── inventory ────────────────────────────────────────────────────────── */
  {
    said: "took twenty pounds of crumble out of the store",
    expect: ["inventory.used"],
    why: "Stock consumed on purpose, in a real unit, with no animal anywhere in the sentence.",
    needs: ["inventory"],
  },
  {
    said: "twenty pounds of crumble went off",
    expect: ["inventory.adjusted"],
    why: "Lost rather than used, and the reason has to become Went off rather than the sentence being forced into Stock used.",
    needs: ["inventory"],
  },
  {
    said: "found half a bag of crumble behind the shed",
    expect: ["inventory.adjusted"],
    why: "The only reason that ADDS stock. If this reads as a loss the sign is inverted and nobody sees it.",
    needs: ["inventory"],
  },
  {
    said: "I make it three hundred pounds of crumble",
    expect: ["inventory.counted"],
    why: "A TOTAL, not a change — the number said is what is there, and the books move by the difference. No count word in the sentence at all.",
    needs: ["inventory"],
  },
  {
    said: "there are only nine bags of crumble left",
    expect: ["inventory.counted"],
    why: "A total phrased as a complaint. The trap is reading \u201conly nine\u201d as nine having gone.",
    needs: ["inventory"],
  },
  /* ── the books ────────────────────────────────────────────────────────── */
  {
    said: "paid the feed store two hundred forty cash",
    expect: ["accounting.paid"],
    why: "The sentence the whole of Phase C was planned around. Money already gone, with a payee and an amount said as words.",
    needs: ["accounting"],
  },
  {
    said: "forty dollars of diesel on the farm card",
    expect: ["accounting.paid"],
    why: "No verb at all — no \u201cpaid\u201d, no \u201cspent\u201d. The account is named and the payment is implied by the card.",
    needs: ["accounting"],
  },
  {
    said: "we owe the feed store two forty",
    expect: [],
    tolerate: [["work.add"]],
    why: "OWING IS NOT PAYING, and what must never happen is a PAYMENT — money is still in the account. The model wrote it down as a job to pay them instead, three times out of three, which is a defensible reading of a liability somebody mentioned out loud and touches no books. Nothing is the cleaner answer; a reminder is not a failure.",
    needs: ["accounting", "work"],
  },
  {
    said: "paid two hundred forty for feed",
    expect: ["accounting.paid"],
    why: "THE PAIR THAT MATTERS NOW. Paying FOR feed is money out; using feed is stock out. Nothing was consumed here, so inventory.used would be wrong twice \u2014 a movement that never happened and a payment that never landed.",
    needs: ["accounting", "inventory"],
  },
  /* ── across modules, which is where it will actually break ────────────── */
  {
    said: "the water trough in pen two is broken",
    expect: ["livestock.check", "work.add"],
    tolerate: [["livestock.check"], ["work.add"]],
    why: "THE HARNESS CORRECTED ITS AUTHOR. This was written expecting ONE answer — an observation about a pen, or a job for somebody — and the model returned BOTH, three times out of three. Which is right: the trough is a thing seen AND a thing to fix, and a person would write down both. Either alone is still defensible, so both singles are tolerated; the pair is what is wanted.",
    needs: ["livestock", "work"],
  },
  {
    said: "the broilers went through two bags of crumble",
    expect: ["livestock.feed"],
    tolerate: [["inventory.used"]],
    why: "GENUINELY AMBIGUOUS once stock can be told: feeding animals is also using stock. Feeding is the better answer because it reaches the pen; using it is not wrong.",
    needs: ["livestock", "inventory"],
  },
  {
    said: "order more feed bags before Friday",
    expect: ["work.add"],
    why: "About feed, and about NEITHER feeding nor stock. A future intention is a job, whatever its subject.",
    needs: ["livestock", "work"],
  },
  {
    said: "three chicks dead in pen two and moved the cows to the creek field",
    expect: ["livestock.loss", "livestock.move"],
    why: "TWO THINGS IN ONE BREATH. The most impressive thing the box does and the least shown off.",
    needs: ["livestock"],
  },
  {
    said: "clock me in, then remind me to ring the vet",
    expect: ["time.clock_in", "work.add"],
    why: "Two things across two modules, and one of them records itself while the other waits — the mixed batch must not record either unasked.",
    needs: ["time", "work"],
  },
  {
    said: "checked pen one, pen two fine, pen three the water was frozen",
    expect: ["livestock.check", "livestock.check", "livestock.check"],
    why: "The morning round in one sentence. Three cards of the same action, two normal and one not.",
    needs: ["livestock"],
  },

  /* ── what it must REFUSE to invent ────────────────────────────────────── */
  {
    said: "what did we feed the broilers last week",
    expect: [],
    why: "A QUESTION, not an event. Ask answers; this records. Proposing anything here is the failure.",
    needs: ["livestock"],
  },
  {
    said: "nice weather today",
    expect: [],
    why: "Nothing happened. An empty proposal is the right answer and the model must not reach for the nearest verb.",
    needs: [],
  },
];

/** Cases this tenant can actually be asked, given which sources it has. */
export function casesFor(enabledSources: readonly string[]): TellCase[] {
  const have = new Set(enabledSources);
  return TELL_CASES.filter((c) => c.needs.every((n) => have.has(n)));
}

/** Order-insensitive, duplicate-sensitive: three checks is not one check. */
export function sameAnswer(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((slug, i) => slug === right[i]);
}

/** Wanted, or merely defensible. */
export function isAcceptable(testCase: TellCase, got: readonly string[]): boolean {
  if (sameAnswer(testCase.expect, got)) return true;
  return (testCase.tolerate ?? []).some((alt) => sameAnswer(alt, got));
}
