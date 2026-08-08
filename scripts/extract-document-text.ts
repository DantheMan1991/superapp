import "dotenv/config";
import { and, asc, eq, inArray, isNotNull, ne, notInArray, sql } from "drizzle-orm";
import { schema, withSystem } from "@/db";
import { readBlobBytes } from "@/modules/documents/ingest";
import { extractDocumentText } from "@/modules/documents/text/extract";
import {
  describeTextExtraction,
  type TextExtractionState,
} from "@/modules/documents/text/state";

/**
 * `npm run docs:extract-text` — read the contents of documents uploaded before
 * the producer existed, so search reaches inside them too.
 *
 * `npm run docs:extract-text -- --dev`          the Neon dev branch
 * `npm run docs:extract-text -- --limit 50`     stop after N documents
 * `npm run docs:extract-text -- --dry-run`      report the queue, write nothing
 *
 * WHY A SCRIPT AND NOT A CRON. A backlog is finite: it is drained once and then
 * the upload path keeps up on its own, because extraction happens inline at
 * registration. A cron would be a permanent scheduled job to solve a problem
 * that stops existing after its first successful run — and this repo has an
 * open, deliberately deferred question about crons versus a job queue
 * (docs/modules/notifications.md), which a fifth passenger would answer by
 * accident rather than on purpose. Retries of `failed` rows ride the same
 * script for the same reason.
 *
 * WHY withSystem. This walks every tenant's documents, which is the god view by
 * definition — the same standing this repo grants seeds and audit writes. The
 * alternative is worse rather than safer: `withTenant` defaults `app.tenant_role`
 * to 'staff', so a tenant-context backfill would silently skip exactly the
 * owners-only documents, leaving a corpus that is searchable for everyone
 * except the people who filed the sensitive things. That is the same trap the
 * owner-only tag delete was written to avoid. Every query below still names
 * `tenant_id` explicitly, and nothing here reads or writes across a tenant
 * boundary within one document.
 */

/** Documents per batch. Small: each one is a blob download plus a parse. */
const BATCH = 25;

interface Args {
  dev: boolean;
  dryRun: boolean;
  limit: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const limitAt = argv.indexOf("--limit");
  const limit =
    limitAt !== -1 ? Number.parseInt(argv[limitAt + 1] ?? "", 10) : Number.NaN;
  return {
    dev: argv.includes("--dev"),
    dryRun: argv.includes("--dry-run"),
    limit: Number.isFinite(limit) && limit > 0 ? limit : Number.POSITIVE_INFINITY,
  };
}

/**
 * Point the pooled connection at the dev branch.
 *
 * This works because `src/db`'s `getPool()` reads `DATABASE_URL` LAZILY, on
 * first query, rather than at module load — so reassigning it here, after the
 * imports have been evaluated but before anything queries, is enough. If that
 * ever becomes eager, this stops working SILENTLY and `--dev` starts writing to
 * production, so it is worth knowing which fact is holding it up.
 */
function retarget(dev: boolean): string {
  if (!dev) return "production";
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.error("--dev needs TEST_DATABASE_URL set.");
    process.exit(1);
  }
  if (url === process.env.DATABASE_URL) {
    console.error("--dev refused: TEST_DATABASE_URL is the same as DATABASE_URL.");
    process.exit(1);
  }
  process.env.DATABASE_URL = url;
  return "dev branch";
}

type Tally = Record<TextExtractionState, number>;

function emptyTally(): Tally {
  return {
    pending: 0,
    done: 0,
    empty: 0,
    unsupported: 0,
    too_large: 0,
    failed: 0,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const target = retarget(args.dev);
  console.log(`Reading document text against the ${target} database.`);
  if (args.dryRun) console.log("Dry run — nothing will be written.\n");

  const tally = emptyTally();
  let processed = 0;
  let blobless = 0;

  /**
   * Rows this RUN has already attempted and that are still in the queue.
   *
   * Without this the script never terminates, and it is not a subtle loop: a
   * document whose blob has gone missing is recorded 'failed', 'failed' is in
   * the queue predicate below, and so the next batch serves the very same row
   * again. Found by running it — four dead blobs on the dev branch were read
   * 732 times before the timeout, and the tally would have been nonsense.
   *
   * Excluding them here rather than dropping 'failed' from the queue keeps the
   * behaviour that was actually wanted: a transient failure IS retried, on the
   * next run, when whatever broke may have been fixed.
   */
  const attempted = new Set<string>();
  /** Beyond this the NOT IN list is its own problem; stop and say so. */
  const MAX_ATTEMPTED = 5_000;

  for (;;) {
    if (processed >= args.limit) break;
    if (attempted.size >= MAX_ATTEMPTED) {
      console.log(`\nStopping: ${attempted.size} failures in one run. Fix those before continuing.`);
      break;
    }

    // The queue: never read, or read and failed. A document that came back
    // 'empty', 'unsupported' or 'too_large' is NOT retried — those are settled
    // answers about the file, not transient errors, and re-downloading the
    // whole corpus every run to re-learn them would be the expensive way to
    // change nothing. Re-queue deliberately with an UPDATE when the strategies
    // grow (an OCR pass would claim 'empty').
    const batch = await withSystem((tx) =>
      tx
        .select({
          id: schema.documents.id,
          tenantId: schema.documents.tenantId,
          blobPathname: schema.documents.blobPathname,
          mimeType: schema.documents.mimeType,
          extractedText: schema.documents.extractedText,
        })
        .from(schema.documents)
        .where(
          and(
            inArray(schema.documents.textExtraction, ["pending", "failed"]),
            ne(schema.documents.status, "trashed"),
            isNotNull(schema.documents.blobPathname),
            attempted.size > 0
              ? notInArray(schema.documents.id, [...attempted])
              : undefined,
          ),
        )
        .orderBy(asc(schema.documents.createdAt))
        .limit(Math.min(BATCH, args.limit - processed)),
    );
    if (batch.length === 0) break;

    for (const doc of batch) {
      processed += 1;
      let result: { text: string; state: TextExtractionState };
      try {
        const bytes = await readBlobBytes(doc.blobPathname!);
        result = await extractDocumentText(bytes, doc.mimeType);
      } catch (err) {
        // A blob that has gone missing — infrastructure, not a fact about the
        // file — so 'failed', which the NEXT run retries. Logged once per run
        // now that `attempted` stops this row coming round again.
        console.error(`  ${doc.id}: blob unreadable`, err instanceof Error ? err.message : err);
        result = { text: "", state: "failed" };
        blobless += 1;
      }

      tally[result.state] += 1;
      // Anything still in the queue after this attempt must not be served
      // again by THIS run — see `attempted` above. A dry run writes nothing, so
      // every row it touches stays in the queue and all of them qualify.
      if (args.dryRun || result.state === "failed") attempted.add(doc.id);
      if (args.dryRun) continue;

      // NEVER blank text somebody else produced. A row can already hold a
      // transcript the mail seam wrote; if a strategy has nothing better to
      // offer, the existing text stays and the state records that it is real.
      const keepExisting = result.text === "" && doc.extractedText !== "";
      await withSystem((tx) =>
        tx
          .update(schema.documents)
          .set({
            extractedText: keepExisting ? doc.extractedText : result.text,
            textExtraction: keepExisting ? "done" : result.state,
            // updatedAt deliberately UNTOUCHED. Reading a file is not a change
            // to it, and moving the timestamp would push every document in the
            // business to the top of "recently modified" on the day this runs.
          })
          .where(
            and(
              eq(schema.documents.tenantId, doc.tenantId),
              eq(schema.documents.id, doc.id),
            ),
          ),
      );

      // The current version row describes the same bytes, so it gets the same
      // answer. Only the current one: an older revision's text can only be
      // recovered by re-reading a blob this script is not walking.
      await withSystem((tx) =>
        tx
          .update(schema.documentVersions)
          .set({
            extractedText: keepExisting ? doc.extractedText : result.text,
            textExtraction: keepExisting ? "done" : result.state,
          })
          .where(
            and(
              eq(schema.documentVersions.tenantId, doc.tenantId),
              eq(schema.documentVersions.documentId, doc.id),
              eq(schema.documentVersions.isCurrent, true),
            ),
          ),
      );
    }
    console.log(`  ${processed} documents read…`);
  }

  console.log(`\nRead ${processed} document${processed === 1 ? "" : "s"}.`);
  for (const state of Object.keys(tally) as TextExtractionState[]) {
    if (tally[state] === 0) continue;
    console.log(`  ${state.padEnd(12)} ${String(tally[state]).padStart(6)}   ${describeTextExtraction(state)}`);
  }
  if (blobless > 0) {
    console.log(`\n  ${blobless} of the failures were unreadable blobs, not unreadable files.`);
  }

  /**
   * The number this whole exercise exists to produce.
   *
   * `empty` is a supported file type that genuinely carries no text layer — a
   * scan, a photographed permit. It is the ONLY population OCR would help, and
   * printing it is how the vision question gets decided with evidence rather
   * than with an estimate. Before paying for a model, look at this line.
   */
  if (tally.empty > 0) {
    console.log(
      `\n  ${tally.empty} document${tally.empty === 1 ? " has" : "s have"} no text layer.` +
        ` That is the size of the OCR question — see docs/modules/documents.md.`,
    );
  }

  const remaining = await withSystem((tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.documents)
      .where(
        and(
          inArray(schema.documents.textExtraction, ["pending", "failed"]),
          ne(schema.documents.status, "trashed"),
        ),
      ),
  );
  const left = remaining[0]?.n ?? 0;
  if (left > 0) console.log(`\n  ${left} still queued — run again to continue.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
