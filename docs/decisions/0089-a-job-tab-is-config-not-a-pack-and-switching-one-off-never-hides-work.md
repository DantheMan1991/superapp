# 0089. A job tab is config, not a pack, and switching one off never hides work

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** the founder — *"How does it work for the construction companies that don't do warranty. That should be able to be turned off. Or selections is not a commercial contractor thing, so again turned off."*

## Context

A job has eleven tabs and no construction business uses all eleven. *Selections*
— allowances and the choices a client makes against them — is a custom-home
screen; a commercial contractor never picks a tile. A framing sub who hands the
job over and leaves has no warranty period to track. A remodeler who bids on the
back of an envelope has no use for *Estimates*. Every one of them was looking at
a strip where most of it belonged to somebody else's trade.

`ProjectNav` built all eleven from a hardcoded array with no conditional, so
there was nothing to turn off short of editing the pack.

## Decision

**A TAB IS `tenant_modules.config`, NOT A PACK.**

The obvious move — split `selections` and `warranty` into packs you can switch
off — is wrong, and the reason is the one that makes the tabs tabs in the first
place: **they are all facets of one record.** A selection belongs to a project,
a change order belongs to a project, a warranty claim belongs to a project.
Packaging them separately would be packaging for navigation, and a pack boundary
is meant to be a capability boundary (extension-model §3). It would also put
seven more rows in the rail, which is the problem the tab strip exists to solve.

So it is the pack's own config, which `jobs` already reads for its delivery
methods and its cost-code sets: the profile suggests, the tenant overrides, the
pack parses its own key with its own tolerance for nonsense.

**THREE TABS ARE NOT NEGOTIABLE**: Overview, Contracts, Job cost. The pack's
whole claim is that a job has a number, a value and a cost measured against it.
A tenant who switched those off installed the wrong thing. They are refused by
the action rather than ignored.

**STORED AS WHAT IS OFF, NOT WHAT IS ON.** `config.tabsOff` is a list of the
hidden ones. A tab added to the pack next year is then ON for a business that
configured this today — the other way round it would be silently missing for
them, because their stored list predates it, and nobody would ever find out why.

**SWITCHING ONE OFF NEVER HIDES WORK THAT EXISTS.** This is the rule that makes
the feature safe rather than dangerous, and it is not a nicety: a warranty claim
is an obligation and a change order is money. `visibleTabs(config, withRows)`
takes the tabs that HAVE ROWS on the project being looked at and draws them
whatever the setting says. **The setting decides what a job starts with, not
what it is allowed to remember.** The settings screen says the same thing before
you tick the box, naming the tabs the business has already used.

**THE PAGE STAYS REACHABLE BY URL.** Hiding a tab is a preference, not a
permission, and `requireModuleEnabled` is where permissions live. A bookmark to
a switched-off section still opens, which is the same promise the paragraph
above makes in a different medium.

**OWNER-ONLY, AND `withSystem` WITH THE S2 JUSTIFICATION.**
`tenant_modules` is deliberately SELECT-only for tenant context
(`drizzle/0001_rls.sql`) — it is the ENTITLEMENT table, and a member policy
letting an owner update their own row would let them switch modules on and skip
billing. RLS is row-level, not column-level, so no narrower policy exists. The
action therefore does exactly what `setTenantTimezoneAction` already does and
for the same stated reasons: authorization first (`requireTenantOwner`), a
tenant id that comes from the session and never from the request, a constant
module id, and one field written. **The rest of the config is read and spread
back**, because writing `{ tabsOff }` over it would take a client's delivery
methods away and nothing would have failed.

## Consequences

- A commercial contractor's job strip is seven tabs instead of eleven.
- The pack gets a settings screen of its own, `/dashboard/m/jobs/setup`, which
  is where its next setting goes too. **Not** Business settings: Layer 0 would
  have to know what a job tab is to draw it, and a core surface that learns one
  pack's shape learns every pack's next.
- One extra query on the job layout — eight `EXISTS` in a single round trip,
  each covered by the `(tenant_id, project_id)` index the tab's own page uses,
  and cheaper than the vitals strip that was already there.
- The cross-job Warranty page comes off the module home with the tab, because
  it is the same feature seen from the other end.
- A raw-SQL result is not type-checked, so both readers are wrong in the SAFE
  direction: anything that is not exactly `false` counts as "there is something
  here". Showing an empty tab costs a click; hiding a warranty claim costs the
  claim.

## Alternatives rejected

**A pack per tab.** Breaks the spine, and puts seven more rows in the rail.

**Refuse to switch off a tab that has any rows anywhere.** One query instead of
one per job, and it fails the wrong way: a business that raised a single change
order in 2019 could never tidy its strip, and the only advice would be to delete
the data.

**Hide it and leave the data unreachable.** The failure this whole decision is
shaped to avoid.

**Infer it — hide a tab nobody has used.** No decision to make, which is
appealing, and it makes the feature undiscoverable: a new tenant would never see
*Selections* to start using it.
