import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Follow-ups moved to Work (work.md slice 5b).
 *
 * A REDIRECT RATHER THAN A DELETED ROUTE, because this URL is in people's
 * history, in bookmarks, and in the CRM nav until every link is chased down. A
 * 404 would read as the feature having been removed, which is the opposite of
 * what happened to it.
 *
 * IT DOES NOT FILTER TO CRM-LINKED WORK, and that is the point of the merge
 * rather than an omission. `crm_tasks.party_id` was nullable so "ring the
 * accountant back" had a home; a page filtered to linked work would silently
 * drop exactly those. What somebody came here for — everything outstanding — is
 * now the whole list, across every module, which is the thing having one home
 * for work was supposed to buy.
 */
export default function CrmTasksPage() {
  redirect("/dashboard/m/work?who=anyone");
}
