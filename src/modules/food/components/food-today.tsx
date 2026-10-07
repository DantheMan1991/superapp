"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Camera, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ateItAction, changeEatenAction, deleteEatenAction, logFoodAction, logRecipeAction, setTargetsAction } from "../actions";
import { MEAL_LABELS, totals, type Meal, type TargetsInput } from "../core/eating";
import { choiceWords, type Choice, type RecentChoice } from "../core/choice";
import { cheerFor, upNext } from "../core/today";
import { eatsHere, planNumbers, type PlanItem } from "../core/week";
import type { AmountPicked } from "./amount-sheet";
import { DayCard } from "./day-card";
import { MealList, type EntryChange } from "./meal-list";
import { newId } from "./new-id";
import { QuickLog, logFoodHref, usePlateCamera } from "./quick-log";
import { entriesKey, entryFromChoice, entryFromPlan, plansKey, rescaled, targetsKey, type EntryView } from "./today-model";
import { UpNextCard } from "./up-next-card";

/**
 * THE PHONE'S LOG BAR (the redesign): floating over the bottom of Today,
 * "What did you eat?" opens Log food for the meal the time suggests, the
 * camera takes a photo of the plate there.
 */
function FloatingLogBar({ day, meal }: { day: string; meal: Meal }) {
  const camera = usePlateCamera(day, meal);
  return (
    <div className="fixed inset-x-3 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-2 @2xl:hidden">
      {camera.element}
      <Link
        href={logFoodHref(day, meal)}
        className="flex h-[54px] min-w-0 flex-1 items-center gap-3 rounded-full bg-card px-5 text-base text-muted-foreground shadow-food-float"
      >
        <Search className="size-5 shrink-0 text-food-accent" aria-hidden /> What did you eat?
      </Link>
      <button
        type="button"
        onClick={camera.open}
        aria-label="Photo of the plate"
        className="flex size-[54px] shrink-0 items-center justify-center rounded-full bg-food-accent text-white shadow-food-camera hover:bg-food-accent-hover active:translate-y-px"
      >
        <Camera className="size-6" aria-hidden />
      </button>
    </div>
  );
}

/**
 * TODAY (the Fresh Market redesign, docs/help/food/overview.md; D4a's log and
 * D2's plan underneath): the search bar, the day's numbers, what is up next,
 * and the meals. Everything changes at once and is put back if the server
 * refuses: an action answers before the page it re-rendered streams in, so
 * this keeps its own copy of the day, the plan and the targets, and adopts
 * the server's the moment it differs from the one last seen (Health's drive,
 * 2026-10-02).
 */
export function FoodToday({
  day,
  isToday,
  hour,
  meal,
  entries,
  targets,
  planned,
  recent,
  speech,
}: {
  day: string;
  isToday: boolean;
  /** The space's hour now, for what is up next and what to say. */
  hour: number;
  /** The meal the time of day suggests (dinner on an earlier day). */
  meal: Meal;
  entries: EntryView[];
  targets: TargetsInput;
  planned: PlanItem[];
  recent: RecentChoice[];
  /** Whether the server can turn speech into words (the microphone). */
  speech: boolean;
}) {
  const [rows, setRows] = useState(entries);
  const [seenRows, setSeenRows] = useState(entriesKey(entries));
  if (entriesKey(entries) !== seenRows) {
    setSeenRows(entriesKey(entries));
    setRows(entries);
  }
  const [plans, setPlans] = useState(planned);
  const [seenPlans, setSeenPlans] = useState(plansKey(planned));
  if (plansKey(planned) !== seenPlans) {
    setSeenPlans(plansKey(planned));
    setPlans(planned);
  }
  const [goal, setGoal] = useState(targets);
  const [seenGoal, setSeenGoal] = useState(targetsKey(targets));
  if (targetsKey(targets) !== seenGoal) {
    setSeenGoal(targetsKey(targets));
    setGoal(targets);
  }
  // The planned meal just eaten from Up next: the card keeps it, with Undo, until the page is next opened.
  const [justAte, setJustAte] = useState<{ planId: string; eatenId: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const day_ = totals(rows);
  const next = isToday ? upNext(plans, hour, eatsHere) : null;
  const shown = justAte ? (plans.find((p) => p.id === justAte.planId) ?? null) : next;
  const cheer = cheerFor({
    day: day_,
    targets: goal,
    next: next ? { meal: next.meal, numbers: planNumbers(next) } : null,
    isToday,
  });

  /** Take a logged thing off again, at once; put back if the server refuses. */
  function unlog(id: string) {
    const before = rows;
    const plansBefore = plans;
    setRows((now) => now.filter((r) => r.id !== id));
    // A planned meal logged and then taken off the log is waiting again.
    setPlans((now) => now.map((p) => (p.eatenId === id ? { ...p, eatenId: null } : p)));
    startTransition(async () => {
      const outcome = await deleteEatenAction({ id });
      if ("error" in outcome) {
        toast.error(outcome.error);
        setRows(before);
        setPlans(plansBefore);
      }
    });
  }

  /** Log a food or a recipe from the search bar: shown in its meal at once, with Undo in the toast. */
  function log(choice: Choice, picked: AmountPicked, into: Meal) {
    const id = newId();
    const entry = entryFromChoice(id, choice, picked, into);
    const before = rows;
    setRows((now) => [...now, entry]);
    startTransition(async () => {
      const outcome =
        choice.kind === "food"
          ? await logFoodAction({ id, day, meal: into, fdcId: choice.food.fdcId, amount: picked.amount, portion: picked.portion })
          : await logRecipeAction({ id, day, meal: into, recipeId: choice.recipe.recipeId, servings: picked.amount });
      if ("error" in outcome) {
        toast.error(outcome.error);
        setRows(before);
        return;
      }
      // Long enough to read it and reach Undo; the default four seconds was gone first in the drive.
      toast(`Added to ${MEAL_LABELS[into].toLowerCase()}: ${choiceWords(choice, picked.amount, picked.portion)}`, {
        duration: 8000,
        action: { label: "Undo", onClick: () => unlog(id) },
      });
    });
  }

  /** "Ate it": the planned meal logged as planned. */
  function ate(plan: PlanItem) {
    const eatenId = newId();
    const before = rows;
    const plansBefore = plans;
    setRows((now) => [...now, entryFromPlan(eatenId, plan)]);
    setPlans((now) => now.map((p) => (p.id === plan.id ? { ...p, eatenId } : p)));
    if (shown?.id === plan.id) setJustAte({ planId: plan.id, eatenId });
    startTransition(async () => {
      const outcome = await ateItAction({ planId: plan.id, eatenId });
      if ("error" in outcome) {
        toast.error(outcome.error);
        setRows(before);
        setPlans(plansBefore);
        setJustAte(null);
      }
    });
  }

  function undoAte() {
    if (!justAte) return;
    setJustAte(null);
    unlog(justAte.eatenId);
  }

  function save(entry: EntryView, change: EntryChange) {
    const numbers = rescaled(entry, change.amount, change.portion);
    if (!numbers) return;
    const before = rows;
    setRows((now) => now.map((r) => (r.id === entry.id ? { ...r, ...numbers, ...change } : r)));
    startTransition(async () => {
      const outcome = await changeEatenAction({
        id: entry.id,
        meal: change.meal,
        amount: change.amount,
        ...(entry.source === "recipe" ? {} : { portion: change.portion }),
      });
      if ("error" in outcome) {
        toast.error(outcome.error);
        setRows(before);
      }
    });
  }

  function saveGoal(next_: TargetsInput) {
    const before = goal;
    setGoal(next_);
    startTransition(async () => {
      const outcome = await setTargetsAction(next_);
      if ("error" in outcome) {
        toast.error(outcome.error);
        setGoal(before);
      }
    });
  }

  return (
    <div className="space-y-5 @2xl:space-y-6">
      <QuickLog day={day} meal={meal} recent={recent} speech={speech} pending={pending} onLog={log} className="hidden @2xl:block" />
      <div className="grid gap-5 @4xl:grid-cols-[1.2fr_1fr]">
        <DayCard
          day={day_}
          goal={goal}
          cheer={cheer}
          isToday={isToday}
          pending={pending}
          onSaveGoal={saveGoal}
          className={cn(!shown && "@4xl:col-span-2")}
        />
        {shown && (
          <UpNextCard plan={shown} logged={justAte !== null} pending={pending} onAte={() => ate(shown)} onUndo={undoAte} />
        )}
      </div>
      <MealList day={day} rows={rows} plans={plans} pending={pending} onSave={save} onRemove={(entry) => unlog(entry.id)} onAte={ate} />
      <FloatingLogBar day={day} meal={meal} />
    </div>
  );
}
