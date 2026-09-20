import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { allowsWrite } from "@/lib/packs/authorize";
import { packContext } from "@/lib/packs/tenant-context";
import { PageHeader } from "@/components/app/page-header";
import { listCostCodes, listCostCodeSets } from "@/packs/jobs/ops";
import { choicesOf, loadOutline } from "@/packs/jobs/outline-ops";
import { interviewGateFrom } from "@/packs/jobs/interview-gate";
import { PACK } from "@/packs/jobs/vocabulary";
import { OutlineEditor } from "@/packs/jobs/components/outline-editor";

/**
 * One outline, open for editing (X1, ADR 0098).
 *
 * The whole tree is read here and handed to the editor as its starting draft:
 * the document saves at once, so it loads at once. `choices` comes out of the
 * jsonb as the strings it is, because a `jsonb` column is `unknown` to
 * TypeScript and a component that had to guess would guess wrong on the empty
 * case.
 */
export default async function EstimateOutlinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const canWrite = allowsWrite(ctx.role, "owner");

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const pack = await packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK);
      const gate = interviewGateFrom(pack.config);
      if (!gate.available) return { gate, loaded: null, books: [] };
      /**
       * EVERY LIST, NOT JUST THE DEFAULT. A step's code is checked against all
       * of them, because "2000 is in Residential phases but not in CSI
       * divisions" is the useful sentence — an outline walked on a job using
       * the other list would come out uncoded there and nowhere else.
       */
      const sets = await listCostCodeSets(tx, ctx.tenant.id);
      const books = await Promise.all(
        sets.map(async (set) => ({
          id: set.id,
          name: set.name,
          isDefault: set.isDefault,
          codes: (await listCostCodes(tx, ctx.tenant.id, set.id)).map((c) => ({
            code: c.code,
            name: c.name,
          })),
        })),
      );
      return { gate, loaded: await loadOutline(tx, ctx.tenant.id, id), books };
    },
    { role: ctx.role },
  );
  if (!data.gate.available || !data.loaded) notFound();

  const { outline, steps } = data.loaded;

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/m/jobs/estimate-outlines"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> Estimate outlines
      </Link>

      <PageHeader
        title={outline.name}
        description="Steps in the order you price them, and the questions each one asks. Type over a step's number to move it."
      />

      <OutlineEditor
        outlineId={outline.id}
        initialName={outline.name}
        initialNotes={outline.notes}
        initialVersion={outline.version}
        canWrite={canWrite}
        books={data.books}
        initialSteps={steps.map((step) => ({
          id: step.id,
          title: step.title,
          section: step.section,
          costCode: step.costCode,
          guidance: step.guidance,
          questions: step.questions.map((q) => ({
            id: q.id,
            prompt: q.prompt,
            kind: q.kind,
            choices: choicesOf(q),
            unit: q.unit,
            notes: q.notes,
            alwaysAsk: q.alwaysAsk,
          })),
        }))}
      />
    </div>
  );
}
