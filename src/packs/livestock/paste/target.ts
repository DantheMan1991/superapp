import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { packContext } from "@/lib/packs/tenant-context";
import { normalizeName } from "@/lib/paste-targets/shape";
import {
  PasteRefusal,
  type PasteChoice,
  type PasteCtx,
  type PasteField,
  type PasteRow,
  type PasteSaved,
  type PasteSavedRow,
  type PasteTarget,
} from "@/lib/paste-targets/types";
import { listItems } from "@/packs/inventory/ops";
import { slugLabel } from "@/packs/inventory/vocabulary";
import {
  createLivestockLot,
  listLivestockLots,
  LivestockError,
  setParents,
  startIndividual,
} from "../ops";
import { IDENTIFIER_KIND_LABELS, IDENTIFIER_KINDS, speciesFrom } from "../vocabulary";

/**
 * Animals as a paste target (ADR 0036): the herd book. A farm moving in has
 * its animals in a notebook, a breed-registry printout or a spreadsheet — one
 * line each with a name or a tag, a sex, a birth date and, where anyone wrote
 * it down, the dam and the sire. This reads that list, or a photo of the page.
 *
 * TWO SHAPES OF ROW, decided by `Head`: one named animal, started with
 * `startIndividual` exactly as the form does (she is placed as one head on the
 * day she arrived or was born); or a group — "25 broilers" — started with
 * `createLivestockLot` and its count placed. The pack's own verbs, the pack's
 * own refusals.
 *
 * PARENTS ARE A SECOND PASS, in the same transaction (`afterSave`). A dam is
 * usually three rows up the same list, so she must exist before her daughter
 * can name her; a dam the list names that is neither in the list nor on the
 * farm is a REFUSAL that names the row, not a silent blank — the person blanks
 * it or adds her. `setParents` then applies the pack's rules (a dam that is
 * male, an animal that is its own ancestor) and its refusals surface the same
 * way.
 *
 * THE STOCK LINE resolves by name to an existing head-counted item, and is
 * otherwise created by the pack's own `newItemName` path — so twenty rows
 * saying "Beef cattle" make one item, because the second row's lookup finds
 * what the first row made. Null means the species, in words: "Cattle".
 *
 * NO COST, NO WEIGHT: raised stock has no purchase basis (livestock.md), and a
 * weight is a measurement taken on a day, not a fact about the animal.
 */

const SEX_CHOICES: PasteChoice[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
];

const TAG_CHOICES: PasteChoice[] = IDENTIFIER_KINDS.map((k) => ({
  value: k,
  label: IDENTIFIER_KIND_LABELS[k] ?? k,
}));

const text = (v: PasteRow[string]): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

const today = () => new Date().toISOString().slice(0, 10);

/** A tag is read off an ear; a name is said. Digits and punctuation only = a tag. */
const looksLikeTag = (s: string) => /^[\d\s\-#./]+$/.test(s);

function refusal(err: unknown): unknown {
  return err instanceof LivestockError ? new PasteRefusal(err.message) : err;
}

/** Every animal wearing one of these exact values, retired tags included. */
async function lotsByExactIdentifier(
  tx: Tx,
  tenantId: string,
  values: string[],
): Promise<Map<string, { lotId: string; value: string }>> {
  const out = new Map<string, { lotId: string; value: string }>();
  const wanted = [...new Set(values.map((v) => normalizeName(v)).filter(Boolean))];
  if (wanted.length === 0) return out;
  const rows = await tx
    .select({
      lotId: schema.livestockIdentifiers.livestockLotId,
      value: schema.livestockIdentifiers.value,
    })
    .from(schema.livestockIdentifiers)
    .where(
      and(
        eq(schema.livestockIdentifiers.tenantId, tenantId),
        inArray(sql`lower(trim(${schema.livestockIdentifiers.value}))`, wanted),
      ),
    );
  for (const row of rows) {
    const key = normalizeName(row.value);
    if (!out.has(key)) out.set(key, { lotId: row.lotId, value: row.value });
  }
  return out;
}

/** An existing head-counted item by name, or the name to create one under. */
async function stockLineFor(
  tx: Tx,
  tenantId: string,
  line: string,
): Promise<{ itemId: string } | { newItemName: string }> {
  const items = await listItems(tx, tenantId);
  const wanted = normalizeName(line);
  const found = items.find(
    (i) => i.stockingUnit === "head" && normalizeName(i.name) === wanted,
  );
  return found ? { itemId: found.id } : { newItemName: line };
}

export const animalsPasteTarget: PasteTarget = {
  slug: "livestock.animals",
  moduleSlug: "livestock",
  label: "Animals",
  noun: { one: "animal", many: "animals" },
  about:
    "animals — a herd book, a flock list, or a list of animals with names or tags, sexes, breeds, birth dates and parents",
  async describe(tx: Tx, ctx: PasteCtx) {
    // Species are the industry's vocabulary (ADR 0004), plus whatever this
    // farm already keeps; a tenant with neither types the word.
    const fromProfile = ctx.industry
      ? speciesFrom((await packContext(tx, ctx.tenantId, ctx.industry, "livestock")).config)
      : [];
    const inUse = (await listLivestockLots(tx, ctx.tenantId)).map((l) => l.species);
    const species = [...new Set([...fromProfile, ...inUse])];
    const lines = (await listItems(tx, ctx.tenantId))
      .filter((i) => i.stockingUnit === "head")
      .map((i) => i.name);

    const speciesField: PasteField =
      species.length > 0
        ? {
            key: "species",
            label: "Species",
            kind: "choice",
            required: true,
            hint: "What kind of animal.",
            choices: species.map((s) => ({ value: s, label: slugLabel(s) })),
          }
        : {
            key: "species",
            label: "Species",
            kind: "text",
            required: true,
            hint: "What kind of animal, as one lower-case word: cattle, swine, poultry, sheep, goats.",
          };

    const fields: PasteField[] = [
      {
        key: "name",
        label: "Name or tag",
        kind: "text",
        required: true,
        hint: "Her name, or her tag number when she has no name — exactly as written.",
      },
      {
        key: "tagKind",
        label: "That is a",
        kind: "choice",
        hint: "Whether the name column holds a name or a number read off a tag, and which kind of tag when the list says.",
        choices: TAG_CHOICES,
      },
      speciesField,
      {
        key: "sex",
        label: "Sex",
        kind: "choice",
        hint: "Only when the list gives it or the word used settles it — a cow, heifer, ewe, sow or hen is female; a bull, steer, ram, boar or rooster is male.",
        choices: SEX_CHOICES,
      },
      {
        key: "breed",
        label: "Breed",
        kind: "text",
        hint: "The breed, if the list gives one — Angus, Berkshire, Rhode Island Red.",
      },
      { key: "bornOn", label: "Born", kind: "date", hint: "Her birth date." },
      {
        key: "arrivedOn",
        label: "Arrived",
        kind: "date",
        hint: "The day she came to the farm, when the list gives that instead of, or as well as, a birth date.",
      },
      {
        key: "dam",
        label: "Dam",
        kind: "text",
        hint: "Her mother's name or tag, exactly as the list writes it.",
      },
      {
        key: "sire",
        label: "Sire",
        kind: "text",
        hint: "Her father's name or tag, exactly as the list writes it.",
      },
      {
        key: "head",
        label: "Head",
        kind: "number",
        hint: "For a GROUP rather than one animal — a pen of 25 broilers — how many. Null for one named animal.",
      },
      {
        key: "stockLine",
        label: "Counted under",
        kind: "text",
        hint:
          "The line these animals are counted under, such as Beef cattle or Laying hens." +
          (lines.length > 0
            ? ` Lines here already: ${lines.map((l) => `“${l}”`).join(", ")} — copy one exactly when it fits.`
            : "") +
          " Null to use the species.",
      },
    ];
    return { fields };
  },
  async duplicates(tx: Tx, ctx: PasteCtx, rows: PasteRow[]) {
    const names = rows.map((r) => text(r.name)).filter((n): n is string => n !== null);
    const found = await lotsByExactIdentifier(tx, ctx.tenantId, names);
    return rows.map((row) => {
      const name = text(row.name);
      return name ? (found.get(normalizeName(name))?.value ?? null) : null;
    });
  },
  async save(tx: Tx, ctx: PasteCtx, row: PasteRow): Promise<PasteSaved> {
    const name = text(row.name)!;
    const species = text(row.species)!.toLowerCase();
    const sex = text(row.sex);
    const breed = text(row.breed) ?? undefined;
    const bornOn = text(row.bornOn);
    const occurredOn = text(row.arrivedOn) ?? bornOn ?? today();
    const head = typeof row.head === "number" ? Math.round(row.head) : null;
    const line = await stockLineFor(tx, ctx.tenantId, text(row.stockLine) ?? slugLabel(species));
    try {
      if (head !== null && head > 1) {
        const created = await createLivestockLot(tx, ctx, {
          ...line,
          code: name,
          recordKind: "lot",
          species,
          sex,
          breed,
          bornOn,
          head,
          arrivedOn: occurredOn,
        });
        return { id: created.lot.id, label: name };
      }
      const created = await startIndividual(tx, ctx, {
        ...line,
        name,
        identifierKind: text(row.tagKind) ?? (looksLikeTag(name) ? "visual" : "name"),
        occurredOn,
        species,
        sex,
        breed,
        bornOn,
      });
      return { id: created.lot.id, label: name };
    } catch (err) {
      throw refusal(err);
    }
  },
  async afterSave(tx: Tx, ctx: PasteCtx, saved: PasteSavedRow[]) {
    const inBatch = new Map(saved.map((s) => [normalizeName(s.saved.label), s.saved.id]));
    const wanted = saved.flatMap((s) => [text(s.row.dam), text(s.row.sire)]).filter(
      (v): v is string => v !== null,
    );
    const onFarm = await lotsByExactIdentifier(tx, ctx.tenantId, wanted);

    const resolve = (s: PasteSavedRow, role: "dam" | "sire"): string | null => {
      const named = text(s.row[role]);
      if (!named) return null;
      const key = normalizeName(named);
      const id = inBatch.get(key) ?? onFarm.get(key)?.lotId ?? null;
      if (!id) {
        throw new PasteRefusal(
          `Row ${s.index + 1} (${s.saved.label}): its ${role} “${named}” is not an animal here or in this list. Blank it, or add her.`,
        );
      }
      return id;
    };

    for (const s of saved) {
      const damLotId = resolve(s, "dam");
      const sireLotId = resolve(s, "sire");
      if (!damLotId && !sireLotId) continue;
      try {
        await setParents(tx, ctx, s.saved.id, {
          ...(damLotId ? { damLotId } : {}),
          ...(sireLotId ? { sireLotId } : {}),
        });
      } catch (err) {
        if (err instanceof LivestockError) {
          throw new PasteRefusal(`Row ${s.index + 1} (${s.saved.label}): ${err.message}`);
        }
        throw err;
      }
    }
  },
  revalidate: ["/dashboard/m/livestock", "/dashboard"],
};
