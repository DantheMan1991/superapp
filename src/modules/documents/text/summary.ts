import "server-only";
import { and, count, eq, ne } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { TextExtractionState, TextExtractionTally } from "./state";

/**
 * How many of this tenant's documents have contents the search index can reach.
 *
 * Read by the search page so it can explain an absence — "I searched for a
 * phrase I can see in that permit and got nothing" is a question about a file
 * that is NOT in the results, which no per-result badge can answer.
 *
 * Two things it deliberately does:
 *
 *  - **No visibility predicate.** RLS has already removed owners-only rows for a
 *    staff caller, so the count a staff member sees describes the cabinet they
 *    can see. Adding an app-level term would be a second place for that rule to
 *    be wrong — the same reasoning `search.ts` is written on. The consequence
 *    is deliberate: two people can correctly see different totals.
 *  - **Matches search's own predicate** (`status <> 'trashed'`, both origins).
 *    A note explaining a search must count exactly the rows that search
 *    considered, or it explains a different question than the one asked.
 *
 * Counts only. No id, no name, and nothing about WHICH documents — a tally
 * cannot leak a filename.
 */
export async function tallyTextExtraction(
  tx: Tx,
  tenantId: string,
): Promise<TextExtractionTally> {
  const rows = await tx
    .select({
      state: schema.documents.textExtraction,
      n: count(),
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.tenantId, tenantId),
        ne(schema.documents.status, "trashed"),
      ),
    )
    .groupBy(schema.documents.textExtraction);

  const tally: TextExtractionTally = {};
  for (const row of rows) {
    tally[row.state as TextExtractionState] = Number(row.n);
  }
  return tally;
}
