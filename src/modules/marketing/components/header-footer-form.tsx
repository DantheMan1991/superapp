"use client";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  frameFromInput,
  frameInputFrom,
  linkProblem,
  webUrlProblem,
  type FrameInput,
} from "@/lib/sites/frame";
import { guessNetwork, LINK_HINT, SOCIAL_NETWORK_LABELS, SOCIAL_NETWORKS, socialLabel } from "@/lib/sites/links";
import {
  FOOTER_COLUMNS_MAX,
  FOOTER_LINKS_MAX,
  SOCIAL_LINKS_MAX,
  type SiteSettings,
} from "@/lib/sites/schema";
import { saveHeaderFooterAction } from "../site-actions";

/**
 * The Header and footer card on the Website screen: the frame around every
 * page. Every row is kept as typed until Save; the rules live in
 * `src/lib/sites/frame.ts`, a problem shows under its field as it is typed,
 * and the save names the first one still there.
 */

const SELECT = "border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs";

type Result = { ok: true; data?: unknown } | { error: string };

function Problem({ text }: { text: string | null }) {
  if (!text) return null;
  return <p className="text-xs text-destructive">{text}</p>;
}

function Block({ title, lede, children }: { title: string; lede: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{lede}</p>
      </div>
      {children}
    </div>
  );
}

export function HeaderFooterForm({ settings }: { settings: SiteSettings }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const id = useId();
  const [initial, setInitial] = useState<FrameInput>(() => frameInputFrom(settings));
  const [values, setValues] = useState<FrameInput>(initial);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const update = (fn: (v: FrameInput) => FrameInput) => setValues((v) => fn(v));

  const problems = [
    linkProblem(values.announcement.href),
    linkProblem(values.headerButton.href),
    ...values.social.map((s) => webUrlProblem(s.url)),
    ...values.footerColumns.flatMap((c) => c.links.map((l) => linkProblem(l.href))),
  ].some(Boolean);

  const save = () =>
    startTransition(async () => {
      const result: Result = await saveHeaderFooterAction(values);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      // What was saved is the form trimmed of its blanks: start again from that.
      const checked = frameFromInput(values);
      if (checked.ok) {
        const next = frameInputFrom({ ...settings, ...checked.frame });
        setInitial(next);
        setValues(next);
      }
      toast.success("Header and footer saved. They show on the site straight away.");
      router.refresh();
    });

  return (
    <div className="space-y-8">
      <Block
        title="Announcement bar"
        lede="A line across the top of every page, in your brand color. Holiday hours, a market date, a sale."
      >
        <div className="flex items-center gap-3">
          <Switch
            id={`${id}-shown`}
            checked={values.announcement.shown}
            onCheckedChange={(shown) => update((v) => ({ ...v, announcement: { ...v.announcement, shown } }))}
          />
          <Label htmlFor={`${id}-shown`}>Show the bar</Label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${id}-bar-text`}>Text</Label>
            <Input
              id={`${id}-bar-text`}
              value={values.announcement.text}
              maxLength={120}
              placeholder="Closed Monday for the holiday"
              onChange={(e) => update((v) => ({ ...v, announcement: { ...v.announcement, text: e.target.value } }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-bar-href`}>Link</Label>
            <Input
              id={`${id}-bar-href`}
              value={values.announcement.href}
              maxLength={200}
              className="font-mono"
              placeholder="/contact"
              aria-invalid={linkProblem(values.announcement.href) !== null}
              onChange={(e) => update((v) => ({ ...v, announcement: { ...v.announcement, href: e.target.value } }))}
            />
            <Problem text={linkProblem(values.announcement.href)} />
            <p className="text-xs text-muted-foreground">Optional. Where the line leads when it is clicked.</p>
          </div>
        </div>
      </Block>

      <Block title="Header button" lede="A button at the end of the menu on every page. Leave the label blank for no button.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${id}-button-label`}>Label</Label>
            <Input
              id={`${id}-button-label`}
              value={values.headerButton.label}
              maxLength={40}
              placeholder="Book now"
              onChange={(e) => update((v) => ({ ...v, headerButton: { ...v.headerButton, label: e.target.value } }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-button-href`}>Goes to</Label>
            <Input
              id={`${id}-button-href`}
              value={values.headerButton.href}
              maxLength={200}
              className="font-mono"
              placeholder="/contact"
              aria-invalid={linkProblem(values.headerButton.href) !== null}
              onChange={(e) => update((v) => ({ ...v, headerButton: { ...v.headerButton, href: e.target.value } }))}
            />
            <Problem text={linkProblem(values.headerButton.href)} />
            <p className="text-xs text-muted-foreground">{LINK_HINT}</p>
          </div>
        </div>
      </Block>

      <Block
        title="Social links"
        lede="Your pages elsewhere, shown as icons in the footer. Paste the address of your page and the network fills in from it."
      >
        {values.social.length > 0 && (
          <ul className="space-y-2">
            {values.social.map((row, i) => (
              <li key={i} className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
                <select
                  aria-label="Network"
                  className={SELECT}
                  value={row.network}
                  onChange={(e) =>
                    update((v) => ({
                      ...v,
                      social: v.social.map((s, j) =>
                        j === i ? { ...s, network: e.target.value as FrameInput["social"][number]["network"] } : s,
                      ),
                    }))
                  }
                >
                  {SOCIAL_NETWORKS.map((network) => (
                    <option key={network} value={network}>
                      {SOCIAL_NETWORK_LABELS[network]}
                    </option>
                  ))}
                </select>
                <div className="space-y-1">
                  <Input
                    aria-label="Address"
                    value={row.url}
                    maxLength={200}
                    className="font-mono"
                    placeholder="https://www.facebook.com/yourbusiness"
                    aria-invalid={webUrlProblem(row.url) !== null}
                    onChange={(e) => {
                      const url = e.target.value;
                      const guessed = guessNetwork(url);
                      update((v) => ({
                        ...v,
                        social: v.social.map((s, j) => (j === i ? { ...s, url, network: guessed ?? s.network } : s)),
                      }));
                    }}
                  />
                  <Problem text={webUrlProblem(row.url)} />
                  {row.network === "other" && (
                    <Input
                      aria-label="What to call it"
                      value={row.label}
                      maxLength={30}
                      placeholder="What to call it, such as Etsy shop"
                      onChange={(e) =>
                        update((v) => ({
                          ...v,
                          social: v.social.map((s, j) => (j === i ? { ...s, label: e.target.value } : s)),
                        }))
                      }
                    />
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove link"
                  onClick={() => update((v) => ({ ...v, social: v.social.filter((_, j) => j !== i) }))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={values.social.length >= SOCIAL_LINKS_MAX}
          onClick={() => update((v) => ({ ...v, social: [...v.social, { network: "other", url: "", label: "" }] }))}
        >
          <Plus className="size-4" />
          Add a link
        </Button>
      </Block>

      <Block
        title="Footer"
        lede="Your name, details and social links are always in the footer. Add up to three columns of your own beside them: links to pages, hours, a few words."
      >
        {values.footerColumns.map((column, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-divider p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Column {i + 1}</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => update((v) => ({ ...v, footerColumns: v.footerColumns.filter((_, j) => j !== i) }))}
              >
                Remove column
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`${id}-col-${i}-heading`}>Heading</Label>
                <Input
                  id={`${id}-col-${i}-heading`}
                  value={column.heading}
                  maxLength={40}
                  placeholder="Visit"
                  onChange={(e) =>
                    update((v) => ({
                      ...v,
                      footerColumns: v.footerColumns.map((c, j) => (j === i ? { ...c, heading: e.target.value } : c)),
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${id}-col-${i}-text`}>Text</Label>
                <Textarea
                  id={`${id}-col-${i}-text`}
                  value={column.text}
                  maxLength={300}
                  rows={2}
                  placeholder="Saturdays 8 to 12 at the farmers market"
                  onChange={(e) =>
                    update((v) => ({
                      ...v,
                      footerColumns: v.footerColumns.map((c, j) => (j === i ? { ...c, text: e.target.value } : c)),
                    }))
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Links</p>
              {column.links.map((link, k) => (
                <div key={k} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <Input
                    aria-label="Label"
                    value={link.label}
                    maxLength={40}
                    placeholder="Label"
                    onChange={(e) =>
                      update((v) => ({
                        ...v,
                        footerColumns: v.footerColumns.map((c, j) =>
                          j === i
                            ? { ...c, links: c.links.map((l, m) => (m === k ? { ...l, label: e.target.value } : l)) }
                            : c,
                        ),
                      }))
                    }
                  />
                  <div className="space-y-1">
                    <Input
                      aria-label="Link"
                      value={link.href}
                      maxLength={200}
                      className="font-mono"
                      placeholder="/about"
                      aria-invalid={linkProblem(link.href) !== null}
                      onChange={(e) =>
                        update((v) => ({
                          ...v,
                          footerColumns: v.footerColumns.map((c, j) =>
                            j === i
                              ? { ...c, links: c.links.map((l, m) => (m === k ? { ...l, href: e.target.value } : l)) }
                              : c,
                          ),
                        }))
                      }
                    />
                    <Problem text={linkProblem(link.href)} />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove link"
                    onClick={() =>
                      update((v) => ({
                        ...v,
                        footerColumns: v.footerColumns.map((c, j) =>
                          j === i ? { ...c, links: c.links.filter((_, m) => m !== k) } : c,
                        ),
                      }))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={column.links.length >= FOOTER_LINKS_MAX}
                onClick={() =>
                  update((v) => ({
                    ...v,
                    footerColumns: v.footerColumns.map((c, j) =>
                      j === i ? { ...c, links: [...c.links, { label: "", href: "" }] } : c,
                    ),
                  }))
                }
              >
                <Plus className="size-4" />
                Add a link
              </Button>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={values.footerColumns.length >= FOOTER_COLUMNS_MAX}
          onClick={() =>
            update((v) => ({ ...v, footerColumns: [...v.footerColumns, { heading: "", text: "", links: [] }] }))
          }
        >
          <Plus className="size-4" />
          Add a column
        </Button>
        <div className="space-y-2">
          <Label htmlFor={`${id}-note`}>Footer line</Label>
          <Input
            id={`${id}-note`}
            value={values.footerNote}
            maxLength={160}
            placeholder="Family owned since 1978. Licensed and insured."
            onChange={(e) => update((v) => ({ ...v, footerNote: e.target.value }))}
          />
          <p className="text-xs text-muted-foreground">Under everything, beside the © line, which is always there.</p>
        </div>
      </Block>

      <div className="flex items-center gap-3">
        <Button disabled={pending || !dirty || problems} onClick={save}>
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

/** What staff see: the frame, read-only. */
export function HeaderFooterSummary({ settings }: { settings: SiteSettings }) {
  const bar = settings.announcement;
  const button = settings.headerButton;
  const columns = settings.footerColumns.length;
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-xs text-muted-foreground">Announcement bar</dt>
        <dd>{bar.text ? `${bar.text}${bar.shown ? "" : " (hidden)"}` : "None"}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Header button</dt>
        <dd>{button ? `${button.label}, to ${button.href}` : "None"}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Social links</dt>
        <dd>{settings.social.map(socialLabel).join(", ") || "None"}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Footer</dt>
        <dd>
          {columns === 0 ? "No columns" : columns === 1 ? "1 column" : `${columns} columns`}
          {settings.footerNote && `. ${settings.footerNote}`}
        </dd>
      </div>
      <p className="text-xs text-muted-foreground sm:col-span-2">Only an owner can change these.</p>
    </dl>
  );
}
