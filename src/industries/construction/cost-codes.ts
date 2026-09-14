import type { CostCodeSetSeed } from "@/packs/jobs/seed-shape";

/**
 * Starter cost code lists — the profile's seed into the `jobs` pack.
 *
 * TWO LISTS, BECAUSE THE INDUSTRY HAS TWO CONVENTIONS AND THE PILOT FOLLOWS
 * NEITHER. Commercial work is chartered in CSI MasterFormat divisions;
 * residential builders mostly keep a phase-of-build chart in the NAHB shape;
 * and the pilot invented its own list years ago and uses it across every kind
 * of job it does. A starter is what a NEW tenant finds so the first project can
 * be budgeted on day one — from that moment the rows are the tenant's, to
 * rename, prune, renumber or replace with a pasted list — and shipping only one
 * convention would push every business toward it, which is the narrowing
 * [construction.md](../../../docs/modules/construction.md)'s three-column table
 * exists to refuse.
 *
 * DIVISION LEVEL ONLY on the CSI list, on purpose. MasterFormat runs to
 * thousands of six-digit sections and a budget is never kept at that depth;
 * the two-digit divisions are what a schedule of values and a subcontract
 * scope are written in, and a tenant that wants `03 30 00` under `03 00 00`
 * adds it. Codes are written in the `NN 00 00` form so the pilot's own
 * `03 30 00` style sorts beside them.
 *
 * THE RESIDENTIAL LIST IS IN BUILD ORDER, not alphabetical, because that is
 * the order a draw schedule reads and the order a superintendent walks the
 * job. Its codes are four digits with room between them for the same reason
 * a chart of accounts leaves room.
 */
export const CSI_DIVISIONS: CostCodeSetSeed = {
  name: "CSI divisions",
  notes:
    "MasterFormat divisions, the commercial convention. Add sections under a division as you need them.",
  codes: [
    { code: "01 00 00", name: "General requirements" },
    { code: "02 00 00", name: "Existing conditions" },
    { code: "03 00 00", name: "Concrete" },
    { code: "04 00 00", name: "Masonry" },
    { code: "05 00 00", name: "Metals" },
    { code: "06 00 00", name: "Wood, plastics and composites" },
    { code: "07 00 00", name: "Thermal and moisture protection" },
    { code: "08 00 00", name: "Openings" },
    { code: "09 00 00", name: "Finishes" },
    { code: "10 00 00", name: "Specialties" },
    { code: "11 00 00", name: "Equipment" },
    { code: "12 00 00", name: "Furnishings" },
    { code: "13 00 00", name: "Special construction" },
    { code: "14 00 00", name: "Conveying equipment" },
    { code: "21 00 00", name: "Fire suppression" },
    { code: "22 00 00", name: "Plumbing" },
    { code: "23 00 00", name: "Heating, ventilating and air conditioning" },
    { code: "26 00 00", name: "Electrical" },
    { code: "27 00 00", name: "Communications" },
    { code: "28 00 00", name: "Electronic safety and security" },
    { code: "31 00 00", name: "Earthwork" },
    { code: "32 00 00", name: "Exterior improvements" },
    { code: "33 00 00", name: "Utilities" },
  ],
};

export const RESIDENTIAL_PHASES: CostCodeSetSeed = {
  name: "Residential phases",
  notes:
    "A home's phases in build order, the residential convention. Rename, prune or renumber to match how you already budget.",
  codes: [
    { code: "1000", name: "Permits and fees" },
    { code: "1100", name: "Plans and engineering" },
    { code: "1200", name: "Site work and excavation" },
    { code: "1300", name: "Utilities and septic" },
    { code: "2000", name: "Foundation" },
    { code: "2100", name: "Concrete flatwork" },
    { code: "2200", name: "Waterproofing and drainage" },
    { code: "3000", name: "Framing labor" },
    { code: "3100", name: "Framing materials" },
    { code: "3200", name: "Trusses" },
    { code: "3300", name: "Windows and exterior doors" },
    { code: "4000", name: "Roofing" },
    { code: "4100", name: "Siding and exterior trim" },
    { code: "4200", name: "Masonry and stone" },
    { code: "4300", name: "Gutters" },
    { code: "5000", name: "Plumbing" },
    { code: "5100", name: "Heating and cooling" },
    { code: "5200", name: "Electrical" },
    { code: "5300", name: "Insulation" },
    { code: "6000", name: "Drywall" },
    { code: "6100", name: "Interior trim and doors" },
    { code: "6200", name: "Cabinets and countertops" },
    { code: "6300", name: "Flooring" },
    { code: "6400", name: "Tile" },
    { code: "6500", name: "Painting" },
    { code: "6600", name: "Appliances" },
    { code: "6700", name: "Fixtures and hardware" },
    { code: "7000", name: "Decks and porches" },
    { code: "7100", name: "Garage doors" },
    { code: "7200", name: "Driveway and walks" },
    { code: "7300", name: "Landscaping" },
    { code: "8000", name: "Cleaning and punch list" },
    { code: "8100", name: "Supervision" },
    { code: "8200", name: "Equipment and tools" },
    { code: "8300", name: "Temporary utilities and toilets" },
    { code: "8400", name: "Insurance and warranty" },
    { code: "9000", name: "Allowances" },
    { code: "9100", name: "Contingency" },
  ],
};

/**
 * Residential first, so a tenant that never chooses gets the list most small
 * builders keep; the first list a tenant has becomes its default by the pack's
 * own rule. A commercial GC makes the other one default with one click.
 */
export const CONSTRUCTION_COST_CODE_SETS: CostCodeSetSeed[] = [
  RESIDENTIAL_PHASES,
  CSI_DIVISIONS,
];
