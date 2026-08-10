import "server-only";

/**
 * Work items, from the module's point of view.
 *
 * THE IMPLEMENTATION MOVED TO `src/lib/work/items.ts` IN SLICE 5A, and this
 * file is now the module's name for it. The move was forced by slice 5b: CRM
 * creates work items when a follow-up is raised on a customer, a module may not
 * import another module, and the alternative — a second write path inside CRM —
 * would duplicate every guard and drift from it within a release.
 *
 * Kept as a re-export rather than deleted so the module's own call sites keep
 * reading `./item-ops`, and so this note sits where somebody looks for the
 * implementation.
 */
export {
  createItem,
  setAssignee,
  setItemState,
  setParent,
  updateItem,
  type CreateItemInput,
  type UpdateItemInput,
} from "@/lib/work/items";
