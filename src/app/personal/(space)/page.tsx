import { Dumbbell, Lock, Repeat } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requirePersonalSpace } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * A PERSONAL SPACE'S HOME (ADR 0111). What the space is, who can see it, what
 * is coming, and the way back to the business.
 *
 * Three statements, each of which the code behind it makes true: nobody else
 * can be in it (Clerk's one-member cap, the webhook's refusal, and
 * `requirePersonalSpace`'s owner check); staff cannot open it from the product
 * (`resolveSupport` ends any support session found on it); and the switcher
 * takes you back. The guide is docs/help/personal/overview.md.
 */
export default async function PersonalHomePage() {
  // The layout checked this already; a page that reads the tenant asks for
  // itself rather than trusting that it is inside that layout.
  await requirePersonalSpace();

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <PageHeader
        title="Personal"
        description="Your own space, beside your business. Only you can open it."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="size-4 text-muted-foreground" aria-hidden />
            Private to you
          </CardTitle>
          <CardDescription>Who can see what you keep here.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Nobody from your business can see anything in your personal space,
            and nobody can be invited into it. It is yours alone.
          </p>
          <p>
            Yosher staff cannot open it from the product either, not even to
            help you. If something here goes wrong, send us a screenshot.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Dumbbell className="size-4 text-muted-foreground" aria-hidden />
            Your tools
          </CardTitle>
          <CardDescription>Nothing is switched on here yet.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Workouts come first. Follow a program you were given, or build your
            own, with the exercise videos playing right here.
          </p>
          <p>
            Recipes and meal planning come after that. Each tool appears on this
            page and in the sidebar as soon as it is ready.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Repeat className="size-4 text-muted-foreground" aria-hidden />
            Back to your business
          </CardTitle>
          <CardDescription>Your business and this space sit side by side.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          <p>
            Pick your business in the workspace switcher. It is at the bottom of
            the sidebar, or at the top right on a phone. Your personal space is
            listed there too, as Personal, whenever you want to come back.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
