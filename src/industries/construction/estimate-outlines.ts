import type { EstimateOutlineSeed } from "@/packs/jobs/seed-shape";

/**
 * Starter estimate outlines — the profile's second seed into the `jobs` pack
 * ([ADR 0098](../../../docs/decisions/0098-an-estimate-outline-is-the-tenants-and-a-question-is-a-row-so-an-answer-can-point-at-one.md)).
 *
 * TWO OUTLINES, BECAUSE A REMODEL IS NOT A SMALL NEW BUILD. It is the
 * founder's own observation and it is right: a remodel starts with what is
 * already there — what comes out, what gets protected, what the family does
 * about a kitchen for six weeks, and what is behind the wall that nobody can
 * price until it is open. Half of its steps have no counterpart in a new
 * build, and the order is different. One outline with optional steps would
 * have made both walks worse.
 *
 * ── EVERY QUESTION ASKS; NONE OF THEM ASSERTS ───────────────────────────────
 *
 * "How wide is the footing?" ships. "The footing is 24 inches" does not, and
 * neither does a price, a wall type, a supplier or a crew rate. Those are the
 * business's, they differ between two builders on the same street, and a pack
 * that carried one company's would have made the software know one company's
 * house — the founder's standing rule, in his words: *"don't narrow the
 * software to just me."* `tests/packs.test.ts` scans for the name; the rest
 * is discipline.
 *
 * ── A STARTER IS A FLOOR, NOT A CEILING ─────────────────────────────────────
 *
 * These are what a NEW tenant finds so the first interview has somewhere to
 * start. From that moment the rows are theirs — to prune to the fourteen
 * steps they actually walk, to rewrite in their own words, to replace
 * entirely with one generated from their cost code list. A re-install never
 * puts back a step somebody deleted, because an outline is skipped whole when
 * one by that name is already there.
 *
 * ── WHO DOES IT COMES FIRST, EVERYWHERE ─────────────────────────────────────
 *
 * Every step opens with the same question, because the answer decides the
 * shape of everything after it: priced in-house as labour and material,
 * carried as one subcontractor's number, or written into the exclusions
 * because somebody else's contract pays for it. It is the one question that
 * needs no knowledge of the trade to ask.
 */

const WHO: EstimateOutlineSeed["steps"][number]["questions"] = [
  {
    prompt: "Who is doing this one?",
    kind: "choice",
    choices: ["In-house", "Bidding it out", "By others", "Not on this job"],
    notes:
      "Bidding it out sends the scope to the subcontractors you pick. By others means somebody else's contract pays for it, so it belongs in the exclusions rather than on a line.",
  },
];

export const NEW_BUILD_OUTLINE: EstimateOutlineSeed = {
  name: "New build",
  notes:
    "A house from a bare lot, in build order. Prune the phases you never do and write your own questions into the ones you do.",
  steps: [
    {
      title: "Permits and fees",
      costCode: "1000",
      guidance:
        "Everything the job owes before a shovel moves. Jurisdictions differ enormously — some charge impact and tap fees that dwarf the permit itself.",
      questions: [
        ...WHO,
        { prompt: "Which jurisdiction is this in?", kind: "text" },
        {
          prompt: "Are there impact, tap or connection fees on top of the permit?",
          kind: "yes_no",
          notes: "If yes, they are usually published and worth looking up rather than guessing.",
        },
      ],
    },
    {
      title: "Plans and engineering",
      costCode: "1100",
      guidance: "What still has to be drawn or stamped before the job can be built.",
      questions: [
        ...WHO,
        {
          prompt: "Are the drawings complete, or still in design?",
          kind: "choice",
          choices: ["Complete", "Still in design", "Not started"],
        },
        { prompt: "Does anything need an engineer's stamp?", kind: "yes_no" },
      ],
    },
    {
      title: "Site work and excavation",
      costCode: "1200",
      guidance:
        "The phase that hides the most money. Access, spoil and rock are what turn a cheap dig expensive.",
      questions: [
        ...WHO,
        {
          prompt: "Is the lot cleared, or is there clearing and grubbing in it?",
          kind: "choice",
          choices: ["Cleared", "Some clearing", "Heavy clearing"],
        },
        { prompt: "Is rock expected?", kind: "yes_no" },
        {
          prompt: "Does the spoil stay on site or get hauled off?",
          kind: "choice",
          choices: ["Stays on site", "Hauled off", "Some of each"],
        },
      ],
    },
    {
      title: "Utilities and septic",
      costCode: "1300",
      guidance: "Water, waste and power to the house, and how far each has to come.",
      questions: [
        ...WHO,
        {
          prompt: "Water: well or public?",
          kind: "choice",
          choices: ["Well", "Public", "Already on site"],
        },
        {
          prompt: "Waste: septic or sewer?",
          kind: "choice",
          choices: ["Septic", "Sewer", "Already on site"],
        },
        { prompt: "How far is the service run?", kind: "number", unit: "lf" },
      ],
    },
    {
      title: "Foundation",
      costCode: "2000",
      guidance:
        "Establish the type first, then the wall, then what is in it. The footing and wall quantities come off the foundation plan if the drawings are in.",
      questions: [
        ...WHO,
        {
          prompt: "Basement, crawl or slab?",
          kind: "choice",
          choices: ["Full basement", "Walkout basement", "Crawl space", "Slab on grade"],
        },
        {
          prompt: "Block or poured wall?",
          kind: "choice",
          choices: ["Poured", "Block", "ICF", "None — slab only"],
        },
        { prompt: "How many linear feet of footing?", kind: "number", unit: "lf" },
        { prompt: "How wide and deep is the footing?", kind: "text" },
        { prompt: "How tall is the wall?", kind: "text" },
        {
          prompt: "Is there rebar, and how much?",
          kind: "text",
          notes: "Ask even when the answer is none — an unasked rebar question is a common miss.",
        },
      ],
    },
    {
      title: "Waterproofing and drainage",
      costCode: "2200",
      guidance:
        "Easy to forget on a poured wall, and expensive to add after backfill. Worth its own stop for that reason alone.",
      questions: [
        ...WHO,
        {
          prompt: "Damproofed or waterproofed?",
          kind: "choice",
          choices: ["Damproofing", "Waterproofing membrane", "Neither"],
        },
        { prompt: "Is there drain tile, and does it go to daylight or a sump?", kind: "text" },
      ],
    },
    {
      title: "Concrete flatwork",
      costCode: "2100",
      guidance: "Basement floor, garage slab, porches and stoops.",
      questions: [
        ...WHO,
        { prompt: "How many square feet of flatwork, and where?", kind: "text" },
        { prompt: "Any thickened edges, steps or exposed finishes?", kind: "text" },
      ],
    },
    {
      title: "Framing labour",
      costCode: "3000",
      guidance: "What the crew is paid to stand the house up, however you price it.",
      questions: [
        ...WHO,
        { prompt: "How many square feet under roof?", kind: "number", unit: "sf" },
        {
          prompt: "How many storeys?",
          kind: "choice",
          choices: ["One", "One and a half", "Two", "More"],
        },
        {
          prompt: "Stick built or trusses?",
          kind: "choice",
          choices: ["Trusses", "Stick built", "Some of each"],
        },
      ],
    },
    {
      title: "Framing materials",
      costCode: "3100",
      guidance:
        "The lumber package. If the model carries a material takeoff, this is where it lands.",
      questions: [
        ...WHO,
        {
          prompt: "Is there a takeoff or a supplier quote for the package?",
          kind: "choice",
          choices: ["Supplier quote", "Takeoff from the model", "Neither yet"],
        },
        { prompt: "What is the exterior wall — thickness and spacing?", kind: "text" },
      ],
    },
    {
      title: "Windows and exterior doors",
      costCode: "3300",
      questions: [
        ...WHO,
        { prompt: "How many window openings?", kind: "number", unit: "ea" },
        { prompt: "How many exterior doors, and is a garage entry among them?", kind: "text" },
        { prompt: "Is there a quote, or is this an allowance?", kind: "choice", choices: ["Quoted", "Allowance"] },
      ],
    },
    {
      title: "Roofing",
      costCode: "4000",
      questions: [
        ...WHO,
        { prompt: "How many squares?", kind: "number", unit: "sq" },
        { prompt: "What is the pitch, and is any of it steep or cut up?", kind: "text" },
        { prompt: "What material?", kind: "text" },
      ],
    },
    {
      title: "Siding and exterior trim",
      costCode: "4100",
      questions: [
        ...WHO,
        { prompt: "How many square feet of wall?", kind: "number", unit: "sf" },
        { prompt: "What material, and is there more than one?", kind: "text" },
        { prompt: "Is there soffit and fascia in this, or is it separate?", kind: "yes_no" },
      ],
    },
    {
      title: "Masonry and stone",
      costCode: "4200",
      questions: [
        ...WHO,
        { prompt: "Where is it — veneer, chimney, piers, water table?", kind: "text" },
        { prompt: "Is there a brick ledge in the foundation for it?", kind: "yes_no", notes: "A no here is worth going back to the foundation step for." },
      ],
    },
    {
      title: "Gutters",
      costCode: "4300",
      questions: [...WHO, { prompt: "How many linear feet, and how many downspouts?", kind: "text" }],
    },
    {
      title: "Plumbing",
      costCode: "5000",
      questions: [
        ...WHO,
        { prompt: "How many fixtures?", kind: "number", unit: "ea" },
        { prompt: "How many baths, and is there a rough-in for a future one?", kind: "text" },
        { prompt: "Gas, electric or heat pump water heater?", kind: "choice", choices: ["Gas", "Electric", "Heat pump", "Tankless"] },
      ],
    },
    {
      title: "Heating and cooling",
      costCode: "5100",
      questions: [
        ...WHO,
        { prompt: "How many systems?", kind: "number", unit: "ea" },
        { prompt: "What fuel, and what kind of system?", kind: "text" },
        { prompt: "Is there anything unusual — zoning, ERV, radiant, mini-splits?", kind: "text" },
      ],
    },
    {
      title: "Electrical",
      costCode: "5200",
      questions: [
        ...WHO,
        { prompt: "What size service?", kind: "text" },
        { prompt: "Is the service overhead or underground, and how far?", kind: "text" },
        { prompt: "Anything on top of a standard rough — generator, EV charger, solar, low voltage?", kind: "text" },
      ],
    },
    {
      title: "Insulation",
      costCode: "5300",
      questions: [
        ...WHO,
        { prompt: "What is specified in the walls, and in the attic?", kind: "text" },
        { prompt: "Is there spray foam anywhere — rim, roof deck, cathedral?", kind: "text" },
      ],
    },
    {
      title: "Drywall",
      costCode: "6000",
      guidance:
        "The square footage here is board, not floor. If you want it measured rather than guessed, this is the step to open the drawings on.",
      questions: [
        ...WHO,
        { prompt: "How many square feet of board?", kind: "number", unit: "sf" },
        { prompt: "What finish level, and are the ceilings textured or smooth?", kind: "text" },
      ],
    },
    {
      title: "Interior trim and doors",
      costCode: "6100",
      questions: [
        ...WHO,
        { prompt: "How many interior doors?", kind: "number", unit: "ea" },
        { prompt: "What is the trim package — base, casing, crown, anything built?", kind: "text" },
        { prompt: "Is there a stair, and is it finished or carpet grade?", kind: "text" },
      ],
    },
    {
      title: "Cabinets and countertops",
      costCode: "6200",
      questions: [
        ...WHO,
        { prompt: "Quoted or an allowance?", kind: "choice", choices: ["Quoted", "Allowance"] },
        { prompt: "What is the allowance or the quote?", kind: "money" },
        { prompt: "Which rooms — kitchen, baths, laundry, built-ins?", kind: "text" },
      ],
    },
    {
      title: "Flooring",
      costCode: "6300",
      questions: [
        ...WHO,
        { prompt: "What goes where, and how many square feet of each?", kind: "text" },
        { prompt: "Quoted or an allowance?", kind: "choice", choices: ["Quoted", "Allowance"] },
      ],
    },
    {
      title: "Tile",
      costCode: "6400",
      questions: [
        ...WHO,
        { prompt: "Where — floors, showers, backsplash?", kind: "text" },
        { prompt: "Are the showers tiled pans or units?", kind: "choice", choices: ["Tiled pans", "Units", "Some of each"] },
      ],
    },
    {
      title: "Painting",
      costCode: "6500",
      questions: [
        ...WHO,
        { prompt: "Interior, exterior or both?", kind: "choice", choices: ["Interior", "Exterior", "Both"] },
        { prompt: "Is the trim painted or stained?", kind: "choice", choices: ["Painted", "Stained", "Some of each"] },
      ],
    },
    {
      title: "Appliances",
      costCode: "6600",
      questions: [
        ...WHO,
        { prompt: "Quoted or an allowance?", kind: "choice", choices: ["Quoted", "Allowance", "By the client"] },
        { prompt: "What is the allowance?", kind: "money" },
      ],
    },
    {
      title: "Fixtures and hardware",
      costCode: "6700",
      questions: [
        ...WHO,
        { prompt: "What is the lighting allowance?", kind: "money" },
        { prompt: "What is the plumbing fixture allowance?", kind: "money" },
        { prompt: "Is door hardware in this or in the trim package?", kind: "text" },
      ],
    },
    {
      title: "Decks and porches",
      costCode: "7000",
      questions: [
        ...WHO,
        { prompt: "How many square feet, and what material?", kind: "text" },
        { prompt: "Is there railing, and how many linear feet?", kind: "text" },
      ],
    },
    {
      title: "Garage doors",
      costCode: "7100",
      questions: [...WHO, { prompt: "How many doors, what size, and are there openers?", kind: "text" }],
    },
    {
      title: "Driveway and walks",
      costCode: "7200",
      questions: [
        ...WHO,
        { prompt: "What material?", kind: "choice", choices: ["Concrete", "Asphalt", "Gravel", "Pavers"] },
        { prompt: "How many square feet, or how long?", kind: "text" },
      ],
    },
    {
      title: "Landscaping",
      costCode: "7300",
      guidance:
        "Frequently excluded, and an exclusion is a decision worth recording rather than a silence.",
      questions: [
        ...WHO,
        { prompt: "What is in scope — grading, seed, sod, plantings, irrigation?", kind: "text" },
      ],
    },
    {
      title: "Cleaning and punch list",
      costCode: "8000",
      questions: [
        ...WHO,
        { prompt: "Is there a final clean, and is window cleaning in it?", kind: "text" },
        { prompt: "How many dumpster pulls over the job?", kind: "number", unit: "ea" },
      ],
    },
    {
      title: "General conditions",
      costCode: "8100",
      guidance:
        "Supervision, temporary utilities, the toilet, the trailer, the insurance. The costs that belong to the job rather than to any phase of it, and the ones most often left out of a fast bid.",
      questions: [
        { prompt: "How many weeks from start to finish?", kind: "number", unit: "wk" },
        { prompt: "Who is supervising, and how much of their week does this job take?", kind: "text" },
        { prompt: "Temporary power, water and toilet — how long for each?", kind: "text" },
      ],
    },
    {
      title: "Contingency",
      costCode: "9100",
      guidance:
        "The last stop, once the number is real. A contingency is a line like any other so it lands in the budget; whether the client sees it is a separate choice on the line.",
      questions: [
        {
          prompt: "How much contingency does this job need?",
          kind: "text",
          notes: "A percentage of cost or a figure — both end up as a line.",
        },
        {
          prompt: "Is the contingency shown to the client or carried inside an item?",
          kind: "choice",
          choices: ["Shown", "Carried inside an item"],
        },
      ],
    },
  ],
};

export const REMODEL_OUTLINE: EstimateOutlineSeed = {
  name: "Remodel",
  notes:
    "Work in a building that already exists. Starts with what comes out, what gets protected and what nobody can see yet.",
  steps: [
    {
      title: "Scope and existing conditions",
      costCode: "",
      guidance:
        "Before anything is priced: what the job actually is, and what the building is like to work in. Everything after this reads differently depending on the answers.",
      questions: [
        { prompt: "What is the job, in one sentence?", kind: "text" },
        {
          prompt: "Is the building occupied while the work goes on?",
          kind: "choice",
          choices: ["Occupied throughout", "Vacated for part of it", "Empty"],
        },
        { prompt: "Roughly what year was it built?", kind: "text", notes: "Drives the lead, asbestos and knob-and-tube questions later." },
        { prompt: "How is access — stairs, lift, parking, hours?", kind: "text" },
      ],
    },
    {
      title: "Demolition",
      costCode: "",
      guidance: "What comes out, who carries it and where it goes.",
      questions: [
        ...WHO,
        { prompt: "What is being removed?", kind: "text" },
        { prompt: "How many dumpster pulls?", kind: "number", unit: "ea" },
        {
          prompt: "Is anything being salvaged or reinstalled?",
          kind: "yes_no",
          notes: "Salvage is slow demo. It is worth pricing as its own thing.",
        },
      ],
    },
    {
      title: "Hazardous materials",
      costCode: "",
      guidance:
        "Asked on every remodel of a certain age, and answered before demolition is priced rather than after it starts.",
      questions: [
        {
          prompt: "Is there any asbestos, lead paint or mould known or suspected?",
          kind: "choice",
          choices: ["None suspected", "Suspected", "Tested and confirmed", "Not tested yet"],
        },
        { prompt: "Is testing or abatement in this contract, or the client's?", kind: "text" },
      ],
    },
    {
      title: "Protection and containment",
      costCode: "",
      guidance:
        "The phase that has no equivalent on a new build, and the one an estimator who mostly builds new leaves out.",
      questions: [
        ...WHO,
        { prompt: "Which rooms and paths need protecting?", kind: "text" },
        { prompt: "Are dust walls or negative air needed?", kind: "yes_no" },
      ],
    },
    {
      title: "Temporary arrangements",
      costCode: "",
      guidance:
        "What the household loses and for how long. Often a real cost and almost always a conversation worth having before the bid goes out.",
      questions: [
        { prompt: "Is the kitchen or a bathroom out of service, and for how long?", kind: "text" },
        { prompt: "Is a temporary kitchen, bathroom or storage part of the job?", kind: "yes_no" },
      ],
    },
    {
      title: "Structural changes",
      costCode: "",
      guidance: "Anything moving that holds the building up.",
      questions: [
        ...WHO,
        { prompt: "Are any walls coming out?", kind: "yes_no" },
        { prompt: "Is any of it bearing, and has an engineer looked?", kind: "text" },
        { prompt: "Is there temporary shoring in this?", kind: "yes_no" },
      ],
    },
    {
      title: "Concealed conditions",
      costCode: "9100",
      guidance:
        "What is likely behind the wall, and what the contract does about it. A remodel priced as though nothing will be found is a remodel that loses money — the allowance here is the honest version of that.",
      questions: [
        { prompt: "What do you expect to find?", kind: "text" },
        { prompt: "How much is carried for what nobody can see yet?", kind: "money" },
        {
          prompt: "How are surprises handled — allowance, change order, or time and materials?",
          kind: "choice",
          choices: ["Allowance in the price", "Change order as found", "Time and materials"],
        },
      ],
    },
    {
      title: "Permits",
      costCode: "1000",
      questions: [
        ...WHO,
        { prompt: "Does this scope need a permit?", kind: "yes_no" },
        { prompt: "Is a historic or HOA review involved?", kind: "yes_no" },
      ],
    },
    {
      title: "Framing and carpentry",
      costCode: "3000",
      questions: [
        ...WHO,
        { prompt: "What framing changes are there?", kind: "text" },
        { prompt: "Does the existing floor need levelling or sistering?", kind: "text" },
      ],
    },
    {
      title: "Windows and doors",
      costCode: "3300",
      questions: [
        ...WHO,
        { prompt: "How many, and are they replacements in the same openings?", kind: "text" },
        { prompt: "Does any opening change size?", kind: "yes_no", notes: "A changed opening is a header, and a header may be a structural question." },
      ],
    },
    {
      title: "Plumbing",
      costCode: "5000",
      questions: [
        ...WHO,
        { prompt: "Are fixtures moving, or staying where they are?", kind: "choice", choices: ["Staying put", "Some moving", "All new locations"] },
        { prompt: "What is the existing supply and drain material?", kind: "text" },
        { prompt: "Is any of the existing being replaced beyond the work area?", kind: "yes_no" },
      ],
    },
    {
      title: "Electrical",
      costCode: "5200",
      questions: [
        ...WHO,
        { prompt: "Is the existing panel big enough, or is a service change in this?", kind: "text" },
        { prompt: "What is the existing wiring?", kind: "text" },
        { prompt: "Does anything outside the work area have to be brought to code?", kind: "yes_no" },
      ],
    },
    {
      title: "Heating and cooling",
      costCode: "5100",
      questions: [
        ...WHO,
        { prompt: "Is the existing system staying?", kind: "yes_no" },
        { prompt: "Can the ductwork reach the new layout?", kind: "text" },
      ],
    },
    {
      title: "Insulation",
      costCode: "5300",
      questions: [
        ...WHO,
        { prompt: "Are any opened walls being insulated while they are open?", kind: "yes_no" },
      ],
    },
    {
      title: "Drywall and patching",
      costCode: "6000",
      guidance: "Patching into existing is slower per foot than hanging a new room, and the texture match is where the complaints come from.",
      questions: [
        ...WHO,
        { prompt: "How much is new board and how much is patching?", kind: "text" },
        { prompt: "Does the texture have to match existing?", kind: "yes_no" },
      ],
    },
    {
      title: "Trim and doors",
      costCode: "6100",
      questions: [
        ...WHO,
        { prompt: "Does the trim profile have to match existing?", kind: "yes_no", notes: "A match may mean milling, which is a different price." },
        { prompt: "How many doors?", kind: "number", unit: "ea" },
      ],
    },
    {
      title: "Cabinets and countertops",
      costCode: "6200",
      questions: [
        ...WHO,
        { prompt: "Quoted or an allowance?", kind: "choice", choices: ["Quoted", "Allowance"] },
        { prompt: "What is the allowance or the quote?", kind: "money" },
        { prompt: "Is the template and install lead time in the schedule?", kind: "yes_no" },
      ],
    },
    {
      title: "Flooring",
      costCode: "6300",
      questions: [
        ...WHO,
        { prompt: "New floor, or repair and refinish what is there?", kind: "choice", choices: ["All new", "Repair and refinish", "Some of each"] },
        { prompt: "How do the transitions to the existing floor work?", kind: "text" },
      ],
    },
    {
      title: "Tile",
      costCode: "6400",
      questions: [...WHO, { prompt: "Where, and how many square feet?", kind: "text" }],
    },
    {
      title: "Painting",
      costCode: "6500",
      questions: [
        ...WHO,
        {
          prompt: "Whole rooms or just the work area?",
          kind: "choice",
          choices: ["Whole rooms", "Work area only", "Whole house"],
        },
        { prompt: "Does the colour have to match existing?", kind: "yes_no" },
      ],
    },
    {
      title: "Fixtures and hardware",
      costCode: "6700",
      questions: [
        ...WHO,
        { prompt: "What is the fixture allowance?", kind: "money" },
        { prompt: "Is the client supplying any of it?", kind: "yes_no" },
      ],
    },
    {
      title: "Cleaning and debris",
      costCode: "8000",
      questions: [
        ...WHO,
        { prompt: "Is there a daily clean as well as a final one?", kind: "yes_no" },
      ],
    },
    {
      title: "General conditions",
      costCode: "8100",
      guidance:
        "On a remodel this is mostly trips, parking and the hours you are allowed to make noise.",
      questions: [
        { prompt: "How many weeks?", kind: "number", unit: "wk" },
        { prompt: "How much supervision does this one take?", kind: "text" },
        { prompt: "Are there working-hour or parking restrictions?", kind: "text" },
      ],
    },
  ],
};

/**
 * New build first, so it becomes the default by the pack's own rule — it is
 * the longer walk and the one a tenant is most likely to want first. A
 * remodeller makes the other one default with one click.
 */
export const CONSTRUCTION_ESTIMATE_OUTLINES: EstimateOutlineSeed[] = [
  NEW_BUILD_OUTLINE,
  REMODEL_OUTLINE,
];
