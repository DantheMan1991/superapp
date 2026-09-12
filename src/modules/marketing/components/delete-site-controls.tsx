"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteSiteAction } from "../site-actions";

/**
 * Removing a website.
 *
 * THE CONFIRM COUNTS WHAT GOES. "Are you sure?" asks a question the person
 * cannot answer — they are being asked to weigh something they would have to
 * go and look up. Naming the pages, the messages and the photos puts the
 * weight in the sentence, which is what makes a destructive confirm worth
 * showing at all.
 *
 * It also says what STAYS, because that is the half people get wrong: every
 * enquiry already became a customer in the CRM and a follow-up in Work, and
 * those live in their own tables. Somebody who thinks deleting a site deletes
 * their customers will not press the button they should press, and somebody
 * who thinks it keeps everything will press one they should not.
 *
 * The two refusals — a published site, a connected domain — are NOT drawn as
 * a disabled button. The reason the button is unavailable is a sentence worth
 * reading ("unpublish it first"), and a disabled control with a tooltip is
 * how that sentence goes unread. The server refuses and the message says why.
 */
export function DeleteSiteButton({
  siteId,
  name,
  counts,
}: {
  siteId: string;
  name: string;
  counts: { pages: number; enquiries: number; photos: number };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      className="text-destructive hover:bg-destructive/5 hover:text-destructive"
      onClick={() => {
        const goes = [
          plural(counts.pages, "page", "pages"),
          plural(counts.photos, "photo", "photos"),
          plural(counts.enquiries, "message", "messages"),
        ].join(", ");
        if (
          !window.confirm(
            `Delete ${name}?\n\nThis removes ${goes}, and cannot be undone.\n\n` +
              `Your customers and follow-ups are kept — they live in your CRM and your work list, not on the website.`,
          )
        ) {
          return;
        }
        startTransition(async () => {
          const result = await deleteSiteAction({ siteId });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success(`${name} is deleted.`);
          // Back to the Website screen with nothing asked for: one site left
          // opens straight into it, several draw the list, none draws the
          // build form. The id in the URL is gone, so it must not stay.
          router.push("/dashboard/m/marketing/website");
          router.refresh();
        });
      }}
    >
      <Trash2 className="size-4" />
      {pending ? "Deleting…" : "Delete this website"}
    </Button>
  );
}
