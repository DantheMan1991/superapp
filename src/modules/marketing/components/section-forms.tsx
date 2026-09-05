"use client";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { paragraphsToText, textToParagraphs } from "@/lib/sites/pages";
import type { Section } from "@/lib/sites/schema";

/**
 * One form per kind of section. Each edits the section it is given and hands
 * back a whole new one; the editor owns the list. Every field's limit is the
 * content model's, so what the form allows is what the save will accept.
 */
export function SectionForm({
  section,
  onChange,
  idPrefix,
}: {
  section: Section;
  onChange: (next: Section) => void;
  idPrefix: string;
}) {
  const id = (name: string) => `${idPrefix}-${name}`;
  switch (section.type) {
    case "hero":
      return (
        <div className="space-y-4">
          <Field id={id("headline")} label="Headline" hint="Under ten words reads best.">
            <Input id={id("headline")} value={section.headline} maxLength={120} onChange={(e) => onChange({ ...section, headline: e.target.value })} />
          </Field>
          <Field id={id("sub")} label="Line under it" hint="One sentence, or blank.">
            <Input id={id("sub")} value={section.subheadline} maxLength={240} onChange={(e) => onChange({ ...section, subheadline: e.target.value })} />
          </Field>
          <CtaFields
            idPrefix={idPrefix}
            cta={section.cta}
            optional
            onChange={(cta) => onChange({ ...section, cta })}
          />
        </div>
      );
    case "cta":
      return (
        <div className="space-y-4">
          <Field id={id("headline")} label="Line" hint="The one line in the band.">
            <Input id={id("headline")} value={section.headline} maxLength={120} onChange={(e) => onChange({ ...section, headline: e.target.value })} />
          </Field>
          <CtaFields
            idPrefix={idPrefix}
            cta={section.cta}
            optional={false}
            onChange={(cta) => onChange({ ...section, cta: cta ?? { label: "Contact us", href: "/contact" } })}
          />
        </div>
      );
    case "about":
    case "text":
      return (
        <div className="space-y-4">
          <Field id={id("heading")} label="Heading" hint={section.type === "text" ? "Optional." : undefined}>
            <Input id={id("heading")} value={section.heading} maxLength={80} onChange={(e) => onChange({ ...section, heading: e.target.value })} />
          </Field>
          <Field id={id("body")} label="Paragraphs" hint="Leave a blank line between paragraphs. Up to eight.">
            <Textarea
              id={id("body")}
              value={paragraphsToText(section.body)}
              rows={8}
              onChange={(e) => onChange({ ...section, body: textToParagraphs(e.target.value) })}
            />
          </Field>
        </div>
      );
    case "offer":
      return (
        <div className="space-y-4">
          <Field id={id("heading")} label="Heading">
            <Input id={id("heading")} value={section.heading} maxLength={80} onChange={(e) => onChange({ ...section, heading: e.target.value })} />
          </Field>
          <div className="space-y-3">
            <Label>Items</Label>
            {section.items.map((item, i) => (
              <div key={i} className="space-y-2 rounded-xl bg-muted/50 p-3">
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`Item ${i + 1} name`}
                    value={item.name}
                    maxLength={60}
                    placeholder="Name"
                    onChange={(e) => {
                      const items = section.items.map((it, j) => (j === i ? { ...it, name: e.target.value } : it));
                      onChange({ ...section, items });
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove item ${i + 1}`}
                    disabled={section.items.length <= 1}
                    onClick={() => onChange({ ...section, items: section.items.filter((_, j) => j !== i) })}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <Input
                  aria-label={`Item ${i + 1} line`}
                  value={item.blurb}
                  maxLength={240}
                  placeholder="A line about it"
                  onChange={(e) => {
                    const items = section.items.map((it, j) => (j === i ? { ...it, blurb: e.target.value } : it));
                    onChange({ ...section, items });
                  }}
                />
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={section.items.length >= 8}
              onClick={() => onChange({ ...section, items: [...section.items, { name: "", blurb: "" }] })}
            >
              <Plus className="size-4" />
              Add item
            </Button>
            <p className="text-xs text-muted-foreground">Between one and eight items.</p>
          </div>
        </div>
      );
    case "contact":
    case "hours":
      return (
        <div className="space-y-4">
          <Field id={id("heading")} label="Heading">
            <Input id={id("heading")} value={section.heading} maxLength={80} onChange={(e) => onChange({ ...section, heading: e.target.value })} />
          </Field>
          <Field id={id("note")} label="Note" hint="A line under the heading, or blank.">
            <Input id={id("note")} value={section.note} maxLength={section.type === "contact" ? 300 : 200} onChange={(e) => onChange({ ...section, note: e.target.value })} />
          </Field>
          <p className="text-xs text-muted-foreground">
            {section.type === "contact"
              ? "The phone, email and address come from the Website page's details."
              : "The hours come from the Website page's details."}
          </p>
        </div>
      );
    case "form":
      return (
        <div className="space-y-4">
          <Field id={id("heading")} label="Heading">
            <Input id={id("heading")} value={section.heading} maxLength={80} onChange={(e) => onChange({ ...section, heading: e.target.value })} />
          </Field>
          <Field id={id("note")} label="Note" hint="A line under the heading, or blank.">
            <Input id={id("note")} value={section.note} maxLength={300} onChange={(e) => onChange({ ...section, note: e.target.value })} />
          </Field>
          <Field id={id("buttonLabel")} label="Button" hint="Blank reads Send.">
            <Input id={id("buttonLabel")} value={section.buttonLabel} maxLength={40} onChange={(e) => onChange({ ...section, buttonLabel: e.target.value })} />
          </Field>
          <div className="flex items-center gap-2">
            <Switch id={id("askPhone")} checked={section.askPhone} onCheckedChange={(checked) => onChange({ ...section, askPhone: checked })} />
            <Label htmlFor={id("askPhone")}>Ask for a phone number</Label>
          </div>
          <Field id={id("thanks")} label="After sending" hint="Shown in place of the form once a message is sent.">
            <Input id={id("thanks")} value={section.thanks} maxLength={240} onChange={(e) => onChange({ ...section, thanks: e.target.value })} />
          </Field>
          <p className="text-xs text-muted-foreground">
            Name, email and message are always asked. Each message becomes a contact and a follow-up in your workspace, and is emailed to the site&apos;s email address, or to the owners when there is none.
          </p>
        </div>
      );
  }
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function CtaFields({
  idPrefix,
  cta,
  optional,
  onChange,
}: {
  idPrefix: string;
  cta: { label: string; href: string } | null;
  optional: boolean;
  onChange: (cta: { label: string; href: string } | null) => void;
}) {
  if (!cta) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => onChange({ label: "Get in touch", href: "/contact" })}>
        <Plus className="size-4" />
        Add a button
      </Button>
    );
  }
  return (
    <div className="space-y-3 rounded-xl bg-muted/50 p-3">
      <div className="flex items-center justify-between">
        <Label>Button</Label>
        {optional && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            Remove button
          </Button>
        )}
      </div>
      <Field id={`${idPrefix}-cta-label`} label="Label">
        <Input id={`${idPrefix}-cta-label`} value={cta.label} maxLength={40} onChange={(e) => onChange({ ...cta, label: e.target.value })} />
      </Field>
      <Field
        id={`${idPrefix}-cta-href`}
        label="Goes to"
        hint="A page on this site such as /contact, a full https:// address, or mailto: and tel: links."
      >
        <Input id={`${idPrefix}-cta-href`} value={cta.href} maxLength={200} className="font-mono" onChange={(e) => onChange({ ...cta, href: e.target.value })} />
      </Field>
    </div>
  );
}
