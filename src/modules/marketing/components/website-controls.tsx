"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { SiteSettings } from "@/lib/sites/schema";
import { normalizeSiteSlug, slugReasonMessage } from "@/lib/sites/slug";
import {
  changeSiteSlugAction,
  createSiteAction,
  publishSiteAction,
  rewriteSiteCopyAction,
  saveSiteDetailsAction,
  unpublishSiteAction,
} from "../site-actions";

type Result = { ok: true; data?: unknown } | { error: string };

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<Result>, done: string, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(done);
      after?.();
      router.refresh();
    });
  return { pending, run };
}

/** What the address will read as, while it is being typed. */
function AddressPreview({ slug, siteDomain }: { slug: string; siteDomain: string | null }) {
  const check = normalizeSiteSlug(slug);
  if (!check.ok) {
    return <p className="text-xs text-destructive">{slugReasonMessage(check.reason)}</p>;
  }
  return (
    <p className="text-xs text-muted-foreground">
      {siteDomain ? (
        <>
          Your site will be at <span className="font-mono">{check.slug}.{siteDomain}</span>
        </>
      ) : (
        <>
          Your site will be at <span className="font-mono">/sites/{check.slug}</span> until a site domain is set up.
        </>
      )}
    </p>
  );
}

function DetailFields({
  values,
  onChange,
  withTitle,
}: {
  values: { title: string; phone: string; email: string; address: string; hoursText: string };
  onChange: (patch: Partial<typeof values>) => void;
  withTitle: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {withTitle && (
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="site-title">Name in the header</Label>
          <Input
            id="site-title"
            value={values.title}
            maxLength={80}
            placeholder="Leave blank to use your brand's name"
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="site-phone">Phone</Label>
        <Input id="site-phone" value={values.phone} maxLength={40} onChange={(e) => onChange({ phone: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="site-email">Email</Label>
        <Input id="site-email" type="email" value={values.email} maxLength={120} onChange={(e) => onChange({ email: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="site-address">Address</Label>
        <Textarea id="site-address" value={values.address} maxLength={240} rows={2} onChange={(e) => onChange({ address: e.target.value })} />
        <p className="text-xs text-muted-foreground">Shown on the contact page. Leave blank if customers come to you by appointment.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="site-hours">Hours</Label>
        <Textarea
          id="site-hours"
          value={values.hoursText}
          maxLength={800}
          rows={3}
          placeholder={"Saturday 8 to 12, at the market\nWeekdays by appointment"}
          onChange={(e) => onChange({ hoursText: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">One line each, up to seven. Blank hides the hours section.</p>
      </div>
    </div>
  );
}

const EMPTY_DETAILS = { title: "", phone: "", email: "", address: "", hoursText: "" };

/** The first screen: an address and the details, then "Build it". */
export function BuildSiteForm({
  defaultSlug,
  siteDomain,
}: {
  defaultSlug: string;
  siteDomain: string | null;
}) {
  const { pending, run } = useRun();
  const [slug, setSlug] = useState(defaultSlug);
  const [details, setDetails] = useState(EMPTY_DETAILS);
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="site-slug">Address</Label>
        <Input
          id="site-slug"
          value={slug}
          maxLength={40}
          className="font-mono"
          onChange={(e) => setSlug(e.target.value)}
        />
        <AddressPreview slug={slug} siteDomain={siteDomain} />
      </div>
      <DetailFields values={details} onChange={(p) => setDetails((d) => ({ ...d, ...p }))} withTitle={false} />
      <Button
        disabled={pending || !normalizeSiteSlug(slug).ok}
        onClick={() => run(() => createSiteAction({ slug, ...details }), "Your website is drafted. Have a look before you publish it.")}
      >
        {pending ? "Writing…" : "Build it"}
      </Button>
    </div>
  );
}

/** Publish, take down, and ask for the words again. */
export function SiteStatusButtons({ status }: { status: string }) {
  const { pending, run } = useRun();
  const published = status === "published";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {published ? (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Take the website off the internet? Your pages are kept and you can publish again any time.")) return;
            run(unpublishSiteAction, "Your website is offline.");
          }}
        >
          {pending ? "One moment…" : "Unpublish"}
        </Button>
      ) : (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run(publishSiteAction, "Your website is live.")}
        >
          {pending ? "Publishing…" : "Publish"}
        </Button>
      )}
      {published && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run(publishSiteAction, "Your website is updated.")}
        >
          {pending ? "Publishing…" : "Publish changes"}
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Write every page again from your brand kit and details? The current drafts are replaced. What is published stays until you publish again.")) return;
          run(rewriteSiteCopyAction, "The words are rewritten. Have a look before you publish.");
        }}
      >
        {pending ? "Writing…" : "Rewrite the words"}
      </Button>
    </div>
  );
}

export function SiteSlugForm({ slug, siteDomain }: { slug: string; siteDomain: string | null }) {
  const { pending, run } = useRun();
  const [value, setValue] = useState(slug);
  const check = normalizeSiteSlug(value);
  const unchanged = check.ok && check.slug === slug;
  return (
    <div className="space-y-2">
      <Label htmlFor="site-slug-change">Address</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="site-slug-change"
          value={value}
          maxLength={40}
          className="max-w-xs font-mono"
          onChange={(e) => setValue(e.target.value)}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={pending || !check.ok || unchanged}
          onClick={() => run(() => changeSiteSlugAction({ slug: value }), "Address changed.")}
        >
          {pending ? "Saving…" : "Change address"}
        </Button>
      </div>
      <AddressPreview slug={value} siteDomain={siteDomain} />
      <p className="text-xs text-muted-foreground">
        Changing the address breaks links people already have to the old one.
      </p>
    </div>
  );
}

export function SiteDetailsForm({
  title,
  settings,
}: {
  title: string;
  settings: SiteSettings;
}) {
  const { pending, run } = useRun();
  const initial = {
    title,
    phone: settings.phone,
    email: settings.email,
    address: settings.address,
    hoursText: settings.hoursLines.join("\n"),
  };
  const [values, setValues] = useState(initial);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  return (
    <div className="space-y-4">
      <DetailFields values={values} onChange={(p) => setValues((v) => ({ ...v, ...p }))} withTitle />
      <div className="flex items-center gap-3">
        <Button
          disabled={pending || !dirty}
          onClick={() => run(() => saveSiteDetailsAction(values), "Details saved. They show on the site straight away.")}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
        {dirty && !pending && (
          <Button variant="ghost" size="sm" onClick={() => setValues(initial)}>
            Discard changes
          </Button>
        )}
      </div>
    </div>
  );
}
