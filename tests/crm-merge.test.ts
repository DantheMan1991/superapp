import { describe, expect, it } from "vitest";
import {
  buildMergePlan,
  joinNotes,
  matchableName,
  mergeCustomBags,
  planAffiliations,
  planCollaborators,
  planContactPoints,
  planDetails,
  rankCandidates,
  scoreEvidence,
  touchesLedger,
  type AffiliationSnapshot,
  type ContactSnapshot,
  type DetailsSnapshot,
  type EvidenceRow,
} from "../src/modules/crm/core/merge";

/**
 * The merge planner. No database — the whole point of `core/merge.ts` is that
 * the rules deciding the fate of live AR foreign keys and of somebody's prose
 * can be tested without a session.
 *
 * What is worth testing here is not "does it move rows". It is the handful of
 * judgements a merge makes that nobody would notice going wrong: a dropped
 * connection, a widened visibility, a note silently replaced by another note.
 */

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";

describe("candidate ranking", () => {
  it("treats a pair as unordered, so one duplicate is never two rows", () => {
    // The SQL finds "A shares an address with B" from both ends unless it is
    // written very carefully. Sorting the ids here means it does not have to be
    // the thing that remembers.
    const rows: EvidenceRow[] = [
      { aPartyId: B, bPartyId: A, kind: "shared_email", value: "x@y.example" },
      { aPartyId: A, bPartyId: B, kind: "shared_email", value: "x@y.example" },
    ];
    const ranked = rankCandidates(rows, 10);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].aPartyId).toBe(A);
    expect(ranked[0].bPartyId).toBe(B);
    expect(ranked[0].evidence).toHaveLength(1);
  });

  it("ranks a shared address above a shared name", () => {
    // An address is evidence about a business; a name is evidence about a
    // string. Two companies can share a trading name and be unrelated.
    const ranked = rankCandidates(
      [
        { aPartyId: A, bPartyId: B, kind: "same_name", value: "probe" },
        { aPartyId: A, bPartyId: C, kind: "shared_email", value: "x@y.example" },
      ],
      10,
    );
    expect(ranked[0].bPartyId).toBe(C);
  });

  it("adds distinct kinds but never counts one kind twice", () => {
    // A pair matching on an address AND a name outranks one matching on an
    // address alone. But two shared aliases are one fact about one
    // relationship — letting them stack would put that pair above the stronger
    // one.
    expect(
      scoreEvidence([
        { kind: "shared_email", value: "a@x.example" },
        { kind: "same_name", value: "probe" },
      ]),
    ).toBeGreaterThan(
      scoreEvidence([
        { kind: "shared_email", value: "a@x.example" },
        { kind: "shared_email", value: "b@x.example" },
      ]),
    );
  });

  it("keeps two different values of the same kind as separate evidence", () => {
    // Worth SHOWING even though it does not raise the score: "they share two
    // addresses" is a stronger story for the person deciding.
    const ranked = rankCandidates(
      [
        { aPartyId: A, bPartyId: B, kind: "shared_email", value: "a@x.example" },
        { aPartyId: A, bPartyId: B, kind: "shared_email", value: "b@x.example" },
      ],
      10,
    );
    expect(ranked[0].evidence).toHaveLength(2);
  });

  it("drops a row pairing a party with itself", () => {
    expect(
      rankCandidates(
        [{ aPartyId: A, bPartyId: A, kind: "shared_email", value: "x@y.example" }],
        10,
      ),
    ).toEqual([]);
  });
});

describe("matchableName", () => {
  it("folds case and whitespace", () => {
    expect(matchableName("  Probe   Construction ")).toBe("probe construction");
  });

  it("DOES NOT strip a company suffix", () => {
    // The load-bearing negative. "Probe Ltd" and "Probe Inc" are different
    // legal entities, and a suffix-stripping matcher would confidently propose
    // fusing two real companies' books.
    expect(matchableName("Probe Ltd")).not.toBe(matchableName("Probe Inc"));
  });
});

describe("contact points", () => {
  const point = (over: Partial<ContactSnapshot>): ContactSnapshot => ({
    id: "p1",
    kind: "email",
    normalizedValue: "a@x.example",
    isPrimary: false,
    ...over,
  });

  it("drops an address the survivor already has", () => {
    const plan = planContactPoints(
      [point({ id: "s1" })],
      [point({ id: "l1" })],
    );
    expect(plan.dropDuplicate).toEqual(["l1"]);
    expect(plan.move).toEqual([]);
  });

  it("demotes an incoming primary when the survivor already has one", () => {
    // The partial unique allows exactly one primary per (party, kind), so
    // moving a second one would fail the transaction.
    const plan = planContactPoints(
      [point({ id: "s1", isPrimary: true })],
      [point({ id: "l1", normalizedValue: "b@x.example", isPrimary: true })],
    );
    expect(plan.move).toEqual(["l1"]);
    expect(plan.demote).toEqual(["l1"]);
  });

  it("lets an incoming primary keep the flag when the survivor has none", () => {
    const plan = planContactPoints(
      [point({ id: "s1", kind: "phone", normalizedValue: "5551234567" })],
      [point({ id: "l1", isPrimary: true })],
    );
    expect(plan.demote).toEqual([]);
  });

  it("demotes only the FIRST incoming primary of a kind", () => {
    // Two of the loser's own points cannot both arrive primary either.
    const plan = planContactPoints(
      [],
      [
        point({ id: "l1", normalizedValue: "a@x.example", isPrimary: true }),
        point({ id: "l2", normalizedValue: "b@x.example", isPrimary: true }),
      ],
    );
    expect(plan.demote).toEqual(["l2"]);
  });
});

describe("details", () => {
  const details = (over: Partial<DetailsSnapshot> = {}): DetailsSnapshot => ({
    lifecycleStage: "",
    source: "",
    notes: "",
    ownerClerkUserId: null,
    visibility: "members",
    custom: {},
    ...over,
  });

  it("the survivor wins a contested field and the loser fills a blank", () => {
    const plan = planDetails(
      details({ lifecycleStage: "customer" }),
      details({ lifecycleStage: "lead", source: "referral" }),
    );
    expect(plan.patch.lifecycleStage).toBe("customer");
    expect(plan.patch.source).toBe("referral");
  });

  it("KEEPS BOTH RECORDS' NOTES", () => {
    // The single most irreversible thing a merge could do is throw away the
    // only copy of what somebody wrote.
    const plan = planDetails(
      details({ notes: "Pays on time." }),
      details({ notes: "Site contact is Aoife." }),
    );
    expect(plan.patch.notes).toContain("Pays on time.");
    expect(plan.patch.notes).toContain("Site contact is Aoife.");
  });

  it("takes the MORE RESTRICTIVE visibility, not the survivor's", () => {
    // The one field the survivor does not automatically win. Merging must never
    // be a way to widen who can see a record.
    const plan = planDetails(
      details({ visibility: "members" }),
      details({ visibility: "restricted" }),
    );
    expect(plan.patch.visibility).toBe("restricted");
  });

  it("re-points the loser's row when CRM never knew the survivor", () => {
    const plan = planDetails(null, details({ notes: "kept" }));
    expect(plan.repointLoserDetails).toBe(true);
    expect(plan.deleteLoserDetails).toBe(false);
    expect(plan.patch.notes).toBe("kept");
  });

  it("does nothing to a survivor whose duplicate CRM never knew", () => {
    const plan = planDetails(details({ notes: "kept" }), null);
    expect(plan.repointLoserDetails).toBe(false);
    expect(plan.deleteLoserDetails).toBe(false);
  });
});

describe("custom field bags", () => {
  it("the survivor's answer stands and the loser fills the gaps", () => {
    expect(mergeCustomBags({ f1: "survivor" }, { f1: "loser", f2: "only" })).toEqual({
      f1: "survivor",
      f2: "only",
    });
  });

  it("a blank survivor answer yields to a real one", () => {
    expect(mergeCustomBags({ f1: "  " }, { f1: "real" })).toEqual({ f1: "real" });
    expect(mergeCustomBags({ f1: [] }, { f1: ["a"] })).toEqual({ f1: ["a"] });
  });

  it("false and 0 are ANSWERS, not blanks", () => {
    // A checkbox somebody deliberately unticked must not be overwritten by the
    // other record's tick.
    expect(mergeCustomBags({ f1: false }, { f1: true })).toEqual({ f1: false });
    expect(mergeCustomBags({ f1: 0 }, { f1: 99 })).toEqual({ f1: 0 });
  });

  it("keeps a value belonging to a field neither form would show", () => {
    // Nothing here consults the live definitions, so an archived field's stored
    // value survives a merge — the same promise archiving already makes.
    expect(mergeCustomBags({}, { archived: "kept" })).toEqual({ archived: "kept" });
  });
});

describe("affiliations", () => {
  const link = (over: Partial<AffiliationSnapshot>): AffiliationSnapshot => ({
    id: "a1",
    personPartyId: A,
    organizationPartyId: B,
    endedOn: null,
    isPrimary: false,
    ...over,
  });

  it("DROPS a connection that would point the merged record at itself", () => {
    // Merging a person into the company they work for is a thing somebody will
    // do by accident, and the CHECK that the two ends differ would fail the
    // whole transaction rather than skip the row.
    const plan = planAffiliations(B, A, [], [link({ id: "l1" })]);
    expect(plan.dropSelf).toEqual(["l1"]);
    expect(plan.move).toEqual([]);
  });

  it("re-points the OTHER end when the loser is the organization", () => {
    const plan = planAffiliations(
      C,
      B,
      [],
      [link({ id: "l1", personPartyId: A, organizationPartyId: B })],
    );
    expect(plan.move).toEqual(["l1"]);
  });

  it("drops a connection the survivor already has", () => {
    const plan = planAffiliations(
      C,
      B,
      [link({ id: "s1", personPartyId: A, organizationPartyId: C })],
      [link({ id: "l1", personPartyId: A, organizationPartyId: B })],
    );
    expect(plan.dropDuplicate).toEqual(["l1"]);
  });

  it("KEEPS a former connection that duplicates a current one", () => {
    // Both uniques are partial on `ended_on is null`, so this pair is legal —
    // and it is real history. "They worked there, left, and came back" is two
    // rows, and deduplicating on the pair alone would delete the past and keep
    // only the present, losing the fact the join table exists to hold.
    const plan = planAffiliations(
      C,
      B,
      [link({ id: "s1", personPartyId: A, organizationPartyId: C })],
      [
        link({
          id: "l1",
          personPartyId: A,
          organizationPartyId: B,
          endedOn: "2024-03-31",
        }),
      ],
    );
    expect(plan.move).toEqual(["l1"]);
    expect(plan.dropDuplicate).toEqual([]);
  });

  it("DEMOTES an incoming primary when the merged person already has one", () => {
    // `crm_affiliations_primary_idx` allows one current primary per person, so
    // moving a second would abort the whole merge on an index.
    const plan = planAffiliations(
      A,
      C,
      [link({ id: "s1", personPartyId: A, organizationPartyId: B, isPrimary: true })],
      [link({ id: "l1", personPartyId: C, organizationPartyId: B, isPrimary: true })],
    );
    // Same pair once re-pointed? No — the org differs from the survivor, and
    // the person becomes A, so this is A→B twice. The pair rule catches it
    // first, which is the correct precedence.
    expect(plan.dropDuplicate).toEqual(["l1"]);
  });

  it("demotes rather than drops when the primaries name different companies", () => {
    const plan = planAffiliations(
      A,
      C,
      [link({ id: "s1", personPartyId: A, organizationPartyId: B, isPrimary: true })],
      [
        link({
          id: "l1",
          personPartyId: C,
          organizationPartyId: "org-2",
          isPrimary: true,
        }),
      ],
    );
    expect(plan.move).toEqual(["l1"]);
    expect(plan.demote).toEqual(["l1"]);
  });

  it("leaves a primary alone when the loser is the ORGANIZATION", () => {
    // The person is unchanged, so their primary already satisfies the index —
    // re-pointing the other end cannot contend with it.
    const plan = planAffiliations(
      C,
      B,
      [],
      [link({ id: "l1", personPartyId: A, organizationPartyId: B, isPrimary: true })],
    );
    expect(plan.move).toEqual(["l1"]);
    expect(plan.demote).toEqual([]);
  });
});

describe("collaborators", () => {
  it("MOVES grants rather than letting them lapse", () => {
    // The bug this exists to prevent: `crm_record_collaborators` cascades on
    // the party, so a merge that ignored the table would not fail — it would
    // silently revoke access for everyone named on the losing record, at the
    // moment the two records became one.
    const plan = planCollaborators([], [{ id: "g1", clerkUserId: "aoife" }]);
    expect(plan.move).toEqual(["g1"]);
    expect(plan.dropDuplicate).toEqual([]);
  });

  it("keeps the grant somebody already has on the survivor", () => {
    const plan = planCollaborators(
      [{ id: "s1", clerkUserId: "aoife" }],
      [{ id: "l1", clerkUserId: "aoife" }],
    );
    expect(plan.dropDuplicate).toEqual(["l1"]);
    expect(plan.move).toEqual([]);
  });

  it("does not move the same person twice", () => {
    // Two grants for one person cannot exist on one record, but they can exist
    // one apiece — and after the merge that is one record.
    const plan = planCollaborators(
      [],
      [
        { id: "l1", clerkUserId: "aoife" },
        { id: "l2", clerkUserId: "aoife" },
      ],
    );
    expect(plan.move).toEqual(["l1"]);
    expect(plan.dropDuplicate).toEqual(["l2"]);
  });
});

describe("the whole plan", () => {
  const counts = {
    deals: 0,
    dealStakeholders: 0,
    activities: 0,
    tasks: 0,
    invoices: 0,
    recurringEntries: 0,
    bills: 0,
  };

  const inputs = {
    survivorPartyId: A,
    loserPartyId: B,
    survivor: {
      customerId: null,
      vendorId: null,
      details: null,
      contactPoints: [],
      affiliations: [],
      collaborators: [],
    },
    loser: {
      customerId: null,
      vendorId: null,
      details: null,
      contactPoints: [],
      affiliations: [],
      collaborators: [],
      counts,
    },
  };

  it("re-points a role only the loser holds", () => {
    const plan = buildMergePlan({
      ...inputs,
      loser: { ...inputs.loser, customerId: "cust-l" },
    });
    expect(plan.customer).toEqual({ action: "repoint", roleId: "cust-l" });
  });

  it("ABSORBS a role both hold — the case that moves posted invoices", () => {
    const plan = buildMergePlan({
      ...inputs,
      survivor: { ...inputs.survivor, customerId: "cust-s" },
      loser: { ...inputs.loser, customerId: "cust-l" },
    });
    expect(plan.customer).toEqual({
      action: "absorb",
      survivingRoleId: "cust-s",
      losingRoleId: "cust-l",
    });
  });

  it("does nothing for a role neither holds", () => {
    expect(buildMergePlan(inputs).vendor).toEqual({ action: "none" });
  });

  it("flags a merge that reaches into the ledger", () => {
    // The preview leads with this in a sentence rather than burying it in a
    // table of counts.
    expect(touchesLedger(buildMergePlan(inputs))).toBe(false);
    expect(
      touchesLedger(
        buildMergePlan({
          ...inputs,
          loser: { ...inputs.loser, counts: { ...counts, invoices: 3 } },
        }),
      ),
    ).toBe(true);
  });
});

describe("joinNotes", () => {
  it("returns the one that exists when only one does", () => {
    expect(joinNotes("only", "")).toBe("only");
    expect(joinNotes("", "only")).toBe("only");
  });

  it("does not duplicate identical notes", () => {
    expect(joinNotes("same", "same")).toBe("same");
  });
});
