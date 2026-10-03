import { Dumbbell, Lock, Repeat } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Link from "next/link";
import { isSuperAdmin, requirePersonalSpace } from "@/lib/auth";
import { getRenderableFeature } from "@/lib/features";
import { getActiveModules } from "@/lib/modules";
import { previewPersonalTools } from "@/lib/personal-space";
import { getIcon } from "@/components/app/icon-registry";

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
  const ctx = await requirePersonalSpace();
  // The same list the rail reads, so this card and the sidebar never disagree:
  // after the same preview the layout waits for, read the same way.
  await previewPersonalTools(ctx.tenant.id, await isSuperAdmin());
  const tools = (await getActiveModules(ctx.tenant.id))
    .map(({ module }) => ({ module, feature: getRenderableFeature(module.id) }))
    .filter((tool) => tool.feature);

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
          <CardDescription>
            {tools.length === 0 ? "Nothing is switched on here yet." : "Open one to start."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {tools.length === 0 ? (
            <>
              <p>
                Workouts come first. Follow a program you were given, or build your
                own, with the exercise videos playing right here.
              </p>
              <p>
                Food comes with it: what you eat, counted against your targets, and
                your recipes from a link, a photo of a page or typed in; then the
                week&apos;s meals and the shopping list.
              </p>
              <p>
                Health keeps your cold plunges, your sleep and your own habits, and
                shows your progress across them and your workouts, week by week. Each
                tool appears on this page and in the sidebar as soon as it is ready.
              </p>
            </>
          ) : (
            <>
              <ul className="space-y-2">
                {tools.map(({ module, feature }) => {
                  const Icon = getIcon(feature?.icon);
                  return (
                    <li key={module.id}>
                      <Link
                        href={`/personal/m/${module.id}`}
                        className="flex items-start gap-3 rounded-xl border border-border px-3 py-2 hover:bg-muted"
                      >
                        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span>
                          <span className="font-medium">{module.name}</span>
                          <span className="block text-muted-foreground">{module.description}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <p className="text-muted-foreground">The week&apos;s meals and the shopping list come next.</p>
            </>
          )}
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
