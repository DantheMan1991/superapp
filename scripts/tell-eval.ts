import "dotenv/config";
import { and, eq, isNotNull } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "@/db";
import { CLAUDE_MODEL } from "@/lib/claude";
import { callTellModel, resetTellCooldown } from "@/lib/tell-sources/model";
import { proposeTold } from "@/lib/tell-sources/resolve";
import { tellToolFor } from "@/lib/tell-sources/shape";
import { tellSources } from "@/lib/tell-sources/registry";
import type { TellAction, TellCtx } from "@/lib/tell-sources/types";
import { casesFor, isAcceptable, type TellCase } from "../tests/fixtures/tell-sentences";

/**
 * `npm run tell:eval` — DOES THE BOX PICK THE RIGHT VERB?
 *
 * ── WHY A SCRIPT AND NOT A TEST (tell.md, slice A1) ──────────────────────────
 *
 * This calls the real model, once per sentence, against a real tenant's real
 * rows. It costs money, it takes a minute, and it is not deterministic — three
 * reasons it must never run in CI, and none of them a reason not to have it.
 *
 * The failure it exists to catch is the one nothing else can: **the model
 * picking a plausible action from the wrong module.** Nothing throws, nothing
 * is refused, a convincing card appears against the wrong verb and somebody
 * presses Record. `tell-catalogue-db.test.ts` checks what the model is GIVEN,
 * on every push, for free. This checks what it DOES with it.
 *
 * Run it before adding a source and after. The number on its own means little;
 * the number moving means everything, and the confusion table underneath says
 * which pair of actions to go and separate.
 *
 * ── HOW TO RUN IT ────────────────────────────────────────────────────────────
 *
 *   npm run tell:eval -- --tenant hilltop-farm --dev     the Neon dev branch
 *   npm run tell:eval -- --tenant hilltop-farm           the app's database
 *   npm run tell:eval -- --tenant x --dev --only livestock
 *   npm run tell:eval -- --tenant x --dev --repeat 3     same sentence N times
 *   npm run tell:eval -- --tenant x --dev --user user_abc --as staff
 *
 * WHO IS SPEAKING MATTERS, and there is no members table to ask — a tenant is
 * a Clerk organisation, so membership lives there. Pass `--user`, or let it
 * find somebody the business keeps hours for who has a sign-in, which is the
 * same person the time source needs before it offers a clock at all.
 *
 * `--repeat` is worth more than it looks. A model is not deterministic, and a
 * case that passes two runs in three is a case the catalogue has not settled —
 * which is invisible at `--repeat 1` and obvious at 3.
 *
 * READ-ONLY. `proposeTold` runs the model and resolves cards; `recordTold` is
 * what writes, and is never called here. The tenant's data is not touched.
 */

/* -- arguments ------------------------------------------------------------- */

function flag(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : null;
}

const TENANT = flag("tenant");
const USER = flag("user");
const AS = flag("as") === "staff" ? "staff" : "owner";
const ONLY = flag("only");
const REPEAT = Math.max(1, Number(flag("repeat") ?? 1) || 1);
const DEV = process.argv.includes("--dev");

/**
 * The same guard `scripts/seed.ts` applies, and for the same reason: if the
 * "test" database IS the app's database, `--dev` is quietly reading production
 * while the banner claims otherwise.
 */
function aimDatabase(): string | null {
  if (!DEV) return process.env.DATABASE_URL ?? null;
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.error("--dev needs TEST_DATABASE_URL set.");
    return null;
  }
  if (url === process.env.DATABASE_URL) {
    console.error("REFUSING: TEST_DATABASE_URL is the same database as DATABASE_URL.");
    return null;
  }
  return url;
}

/* -- reporting ------------------------------------------------------------- */

const bar = (n: number, of: number, width = 24) => {
  const filled = of === 0 ? 0 : Math.round((n / of) * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
};

interface Outcome {
  testCase: TellCase;
  got: string[][];
  passes: number;
  error: string | null;
}

function report(outcomes: Outcome[], actions: TellAction[]) {
  const runs = outcomes.length * REPEAT;
  const passed = outcomes.reduce((n, o) => n + o.passes, 0);

  console.log(`\n  ${bar(passed, runs)}  ${passed}/${runs} runs picked the right verb`);
  console.log(
    `  ${outcomes.filter((o) => o.passes === REPEAT).length}/${outcomes.length} sentences were right every time\n`,
  );

  const shaky = outcomes.filter((o) => o.passes > 0 && o.passes < REPEAT);
  const wrong = outcomes.filter((o) => o.passes === 0);

  if (wrong.length > 0) {
    console.log("  WRONG EVERY TIME — the catalogue, not the model\n");
    for (const o of wrong) {
      console.log(`    “${o.testCase.said}”`);
      console.log(`      wanted  ${o.testCase.expect.join(" + ") || "(nothing)"}`);
      const picks = [...new Set(o.got.map((g) => g.join(" + ") || "(nothing)"))];
      console.log(`      picked  ${picks.join("  |  ")}`);
      console.log(`      why it is here: ${o.testCase.why}`);
      if (o.error) console.log(`      error   ${o.error}`);
      console.log("");
    }
  }

  if (shaky.length > 0) {
    console.log("  UNSETTLED — right sometimes, which is the same as unreliable\n");
    for (const o of shaky) {
      const picks = [...new Set(o.got.map((g) => g.join(" + ") || "(nothing)"))];
      console.log(`    ${o.passes}/${REPEAT}  “${o.testCase.said}”  →  ${picks.join("  |  ")}`);
    }
    console.log("");
  }

  /*
   * WHICH PAIR TO GO AND SEPARATE. An accuracy figure says something is wrong;
   * this says where. A pair appearing twice is two actions whose `about` texts
   * do not distinguish them, and that is a writing job with a known location.
   */
  const confusions = new Map<string, number>();
  for (const o of [...wrong, ...shaky]) {
    for (const got of o.got) {
      if (isAcceptable(o.testCase, got)) continue;
      for (const wanted of o.testCase.expect) {
        for (const actual of got) {
          if (wanted === actual) continue;
          const key = `${wanted}  →  ${actual}`;
          confusions.set(key, (confusions.get(key) ?? 0) + 1);
        }
      }
    }
  }
  const ranked = [...confusions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (ranked.length > 0) {
    console.log("  CONFUSED FOR — the pairs whose about texts are not far enough apart\n");
    for (const [pair, n] of ranked) console.log(`    ${String(n).padStart(3)}×  ${pair}`);
    console.log("");
  }

  const size = tellToolFor(actions).description.length;
  console.log(
    `  catalogue: ${actions.length} actions, ${size} characters in every sentence's prompt`,
  );
  console.log(`  model:     ${CLAUDE_MODEL}\n`);
}

/* -- the run --------------------------------------------------------------- */

/**
 * A person this business keeps hours for who also has an account. There is no
 * members table to ask — a tenant IS a Clerk organisation — and this is the one
 * row in the database that ties a sign-in to a tenant without leaving for
 * Clerk's API.
 */
async function someoneWhoSignsIn(tenantId: string): Promise<string | null> {
  const worker = await withSystem((tx) =>
    tx.query.timeWorkers.findFirst({
      where: and(
        eq(schema.timeWorkers.tenantId, tenantId),
        isNotNull(schema.timeWorkers.clerkUserId),
      ),
    }),
  );
  return worker?.clerkUserId ?? null;
}

async function main() {
  if (!TENANT) {
    console.error(
      "Which tenant? npm run tell:eval -- --tenant <slug> [--dev] [--only <source>] [--repeat N]",
    );
    process.exit(1);
  }
  const url = aimDatabase();
  if (!url) process.exit(1);
  process.env.DATABASE_URL = url;

  const tenant = await withSystem((tx) =>
    tx.query.tenants.findFirst({ where: eq(schema.tenants.slug, TENANT) }),
  );
  if (!tenant) {
    console.error(`No tenant with slug "${TENANT}" on the ${DEV ? "dev branch" : "app database"}.`);
    process.exit(1);
  }

  /*
   * SOMEBODY WHO IS ACTUALLY SIGNED IN, never a made-up id.
   *
   * The time source contributes NOTHING without a `time_workers` row for this
   * person, so a fabricated user would quietly measure a smaller catalogue than
   * the one a real person is given — which is the exact failure this script
   * exists to catch, committed inside the script itself.
   */
  const userId = USER ?? (await someoneWhoSignsIn(tenant.id));
  if (!userId) {
    console.error(
      `Nobody to speak as. Pass --user <clerk user id>, or give "${TENANT}" a worker with a sign-in.`,
    );
    process.exit(1);
  }

  const ctx: TellCtx = {
    tenantId: tenant.id,
    userId,
    role: AS,
    now: new Date(),
    timezone: tenant.timezone ?? "UTC",
    industry: tenant.industry ?? "",
    today: new Date().toISOString().slice(0, 10),
  };

  const asMember = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenant.id, fn, { role: ctx.role, userId: ctx.userId });

  const actions = await asMember(async (tx) => {
    const out: TellAction[] = [];
    for (const source of tellSources) out.push(...(await source.actions(tx, ctx)));
    return out;
  });
  const have = [...new Set(actions.map((a) => a.slug.split(".")[0]))];

  let cases = casesFor(have);
  if (ONLY) cases = cases.filter((c) => c.expect.some((s) => s.startsWith(`${ONLY}.`)));

  console.log(`\n  ${tenant.name} · ${DEV ? "dev branch" : "app database"} · as ${ctx.role}`);
  console.log(`  sources contributing: ${have.join(", ") || "(none)"}`);
  console.log(`  ${cases.length} sentences × ${REPEAT}\n`);
  if (cases.length === 0) {
    console.error("  Nothing to ask. This tenant's sources contribute no action the set covers.");
    process.exit(1);
  }

  const outcomes: Outcome[] = [];
  for (const testCase of cases) {
    const got: string[][] = [];
    let passes = 0;
    let error: string | null = null;

    for (let run = 0; run < REPEAT; run++) {
      // The 5s per-person window is there to stop a double submit from two
      // tabs. A loop of sentences is not that, and waiting it out would make a
      // 20-sentence run take two minutes for no safety at all.
      resetTellCooldown(ctx.tenantId, ctx.userId);
      try {
        const proposal = await proposeTold(ctx, testCase.said, callTellModel);
        const picked = proposal.cards.map((c) => c.actionSlug);
        got.push(picked);
        if (isAcceptable(testCase, picked)) passes++;
      } catch (err) {
        // A refusal is an answer: "nothing to record from that" is exactly
        // right for the cases that expect nothing, and wrong for the rest.
        error = err instanceof Error ? err.message : String(err);
        got.push([]);
        if (isAcceptable(testCase, [])) passes++;
      }
    }

    const mark = passes === REPEAT ? "✓" : passes === 0 ? "✗" : "~";
    console.log(`  ${mark} ${passes}/${REPEAT}  ${testCase.said}`);
    outcomes.push({ testCase, got, passes, error });
  }

  report(outcomes, actions);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
