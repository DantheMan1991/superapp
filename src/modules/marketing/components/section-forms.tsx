"use client";
import { useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ImagePlus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FORM_FIELD_KINDS, newFormField } from "@/lib/sites/enquiry-schema";
import { iconLabel, moveItem, paragraphsToText, textToParagraphs } from "@/lib/sites/pages";
import {
  CARD_ICON_NAMES,
  CARDS_MAX,
  FORM_FIELDS_MAX,
  GALLERY_ITEMS_MAX,
  type Card,
  type FormField,
  type FormFieldKind,
  type Section,
} from "@/lib/sites/schema";
import { secondsLabel, SLIDESHOW_SECONDS } from "@/lib/sites/slides";
import type { SitePhotoView } from "../image-actions";
import { memberPhotoSrc, PhotoField, PhotoLibraryDialog } from "./photo-picker";

type GalleryItem = Extract<Section, { type: "gallery" }>["items"][number];
type PhotoProps = { tenantId: string; library: SitePhotoView[]; onLibraryChange: (next: SitePhotoView[]) => void };

/**
 * One form per kind of section. Each edits the section it is given and hands
 * back a whole new one; the editor owns the list. Every field's limit is the
 * content model's, so what the form allows is what the save will accept.
 */
export function SectionForm({
  section,
  onChange,
  idPrefix,
  photos,
}: {
  section: Section;
  onChange: (next: Section) => void;
  idPrefix: string;
  /** The site's photo library and how to change it, for the kinds that take a photo. */
  photos: { tenantId: string; library: SitePhotoView[]; onLibraryChange: (next: SitePhotoView[]) => void };
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
          <PhotoField
            idPrefix={id("photo")}
            label="Photo beside the headline"
            hint="Optional. A landscape photo sits to the right of the words on a wide screen and under them on a phone."
            tenantId={photos.tenantId}
            value={section.image}
            onChange={(image) => onChange({ ...section, image })}
            library={photos.library}
            onLibraryChange={photos.onLibraryChange}
          />
        </div>
      );
    case "columns":
      return (
        <div className="space-y-4">
          <Field id={id("heading")} label="Heading" hint="Optional.">
            <Input id={id("heading")} value={section.heading} maxLength={80} onChange={(e) => onChange({ ...section, heading: e.target.value })} />
          </Field>
          <Field id={id("intro")} label="Line under it" hint="A sentence or two, or blank.">
            <Input id={id("intro")} value={section.intro} maxLength={300} onChange={(e) => onChange({ ...section, intro: e.target.value })} />
          </Field>
          <div className="space-y-2">
            <Label>Columns</Label>
            <div className="flex gap-2">
              {([2, 3, 4] as const).map((n) => (
                <Button key={n} type="button" variant={section.columns === n ? "default" : "outline"} size="sm" aria-pressed={section.columns === n} onClick={() => onChange({ ...section, columns: n })}>
                  {n}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">On a wide screen. A phone stacks them.</p>
          </div>
          {section.columns === 2 && (
            <div className="space-y-2">
              <Label>Widths</Label>
              <div className="flex gap-2">
                {(["equal", "wide-left", "wide-right"] as const).map((w) => (
                  <Button key={w} type="button" variant={section.widths === w ? "default" : "outline"} size="sm" aria-pressed={section.widths === w} onClick={() => onChange({ ...section, widths: w })}>
                    {w === "equal" ? "Equal" : w === "wide-left" ? "Wide left" : "Wide right"}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label>Look</Label>
            <div className="flex gap-2">
              <Button type="button" variant={section.look === "cards" ? "default" : "outline"} size="sm" aria-pressed={section.look === "cards"} onClick={() => onChange({ ...section, look: "cards" })}>
                Cards
              </Button>
              <Button type="button" variant={section.look === "plain" ? "default" : "outline"} size="sm" aria-pressed={section.look === "plain"} onClick={() => onChange({ ...section, look: "plain" })}>
                Plain
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Cards sit in white panels on a tinted band; plain stacks them on the page.</p>
          </div>
          <CardsFields
            idPrefix={idPrefix}
            cards={section.cards}
            onChange={(cards) => onChange({ ...section, cards })}
            photos={photos}
          />
        </div>
      );
    case "slideshow":
      return (
        <div className="space-y-4">
          <Field id={id("heading")} label="Heading" hint="Optional.">
            <Input id={id("heading")} value={section.heading} maxLength={80} onChange={(e) => onChange({ ...section, heading: e.target.value })} />
          </Field>
          <div className="space-y-2">
            <Label>Moves on by itself</Label>
            <div className="flex flex-wrap gap-2">
              {SLIDESHOW_SECONDS.map((s) => (
                <Button
                  key={s}
                  type="button"
                  variant={section.seconds === s ? "default" : "outline"}
                  size="sm"
                  aria-pressed={section.seconds === s}
                  onClick={() => onChange({ ...section, seconds: s })}
                >
                  {secondsLabel(s)}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              It pauses while a visitor&apos;s pointer is on it, and never moves for a visitor whose device asks for less motion. Arrows and dots always work.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Width</Label>
            <div className="flex gap-2">
              <Button type="button" variant={section.layout === "inset" ? "default" : "outline"} size="sm" aria-pressed={section.layout === "inset"} onClick={() => onChange({ ...section, layout: "inset" })}>
                In the text column
              </Button>
              <Button type="button" variant={section.layout === "wide" ? "default" : "outline"} size="sm" aria-pressed={section.layout === "wide"} onClick={() => onChange({ ...section, layout: "wide" })}>
                Full width
              </Button>
            </div>
          </div>
          <GalleryFields
            items={section.items}
            onChange={(items) => onChange({ ...section, items })}
            photos={photos}
          />
        </div>
      );
    case "gallery":
      return (
        <div className="space-y-4">
          <Field id={id("heading")} label="Heading" hint="Optional.">
            <Input id={id("heading")} value={section.heading} maxLength={80} onChange={(e) => onChange({ ...section, heading: e.target.value })} />
          </Field>
          <div className="space-y-2">
            <Label>Photos per row</Label>
            <div className="flex gap-2">
              {([2, 3, 4] as const).map((n) => (
                <Button
                  key={n}
                  type="button"
                  variant={section.columns === n ? "default" : "outline"}
                  size="sm"
                  aria-pressed={section.columns === n}
                  onClick={() => onChange({ ...section, columns: n })}
                >
                  {n}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">On a wide screen. A phone always shows two.</p>
          </div>
          <GalleryFields
            items={section.items}
            onChange={(items) => onChange({ ...section, items })}
            photos={photos}
          />
        </div>
      );
    case "image":
      return (
        <div className="space-y-4">
          <PhotoField
            idPrefix={id("photo")}
            label="Photo"
            tenantId={photos.tenantId}
            value={section.image}
            onChange={(image) => onChange({ ...section, image })}
            library={photos.library}
            onLibraryChange={photos.onLibraryChange}
          />
          <Field id={id("caption")} label="Caption" hint="A line under the photo, or blank.">
            <Input id={id("caption")} value={section.caption} maxLength={240} onChange={(e) => onChange({ ...section, caption: e.target.value })} />
          </Field>
          <div className="space-y-2">
            <Label>Width</Label>
            <div className="flex gap-2">
              <Button type="button" variant={section.layout === "inset" ? "default" : "outline"} size="sm" aria-pressed={section.layout === "inset"} onClick={() => onChange({ ...section, layout: "inset" })}>
                In the text column
              </Button>
              <Button type="button" variant={section.layout === "wide" ? "default" : "outline"} size="sm" aria-pressed={section.layout === "wide"} onClick={() => onChange({ ...section, layout: "wide" })}>
                Full width
              </Button>
            </div>
          </div>
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
          {section.type === "about" && (
            <PhotoField
              idPrefix={id("photo")}
              label="Photo beside the text"
              hint="Optional. Sits to the right of the paragraphs on a wide screen and under them on a phone."
              tenantId={photos.tenantId}
              value={section.image}
              onChange={(image) => onChange({ ...section, image })}
              library={photos.library}
              onLibraryChange={photos.onLibraryChange}
            />
          )}
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
          <QuestionsFields
            idPrefix={idPrefix}
            fields={section.fields}
            onChange={(fields) => onChange({ ...section, fields })}
          />
          <p className="text-xs text-muted-foreground">
            Name, email and message are always asked. Each message becomes a contact and a follow-up in your workspace, and is emailed to the site&apos;s email address, or to the owners when there is none.
          </p>
        </div>
      );
  }
}

/** Six characters of base 36: matches the content model's id shape and is made once. */
function makeFieldId(): string {
  return Math.random().toString(36).slice(2, 8).padEnd(6, "0");
}

/**
 * The business's own questions on the form: label, kind, whether it must
 * be answered, and for "Pick one" the choices, one input each — a textarea
 * of lines cannot be typed into while every keystroke re-splits it.
 */
function QuestionsFields({
  idPrefix,
  fields,
  onChange,
}: {
  idPrefix: string;
  fields: FormField[];
  onChange: (fields: FormField[]) => void;
}) {
  const update = (i: number, patch: Partial<FormField>) =>
    onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="space-y-3">
      <Label>Questions</Label>
      {fields.map((field, i) => {
        const qid = `${idPrefix}-q-${field.id}`;
        return (
          <div key={field.id} className="space-y-2 rounded-xl bg-muted/50 p-3">
            <div className="flex items-center gap-2">
              <Input
                aria-label={`Question ${i + 1}`}
                value={field.label}
                maxLength={80}
                placeholder="The question"
                onChange={(e) => update(i, { label: e.target.value })}
              />
              <select
                aria-label={`Question ${i + 1} kind`}
                className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
                value={field.kind}
                onChange={(e) => {
                  const kind = e.target.value as FormFieldKind;
                  update(i, {
                    kind,
                    options: kind === "choice" ? (field.options.length > 0 ? field.options : newFormField(field.id, "choice").options) : [],
                  });
                }}
              >
                {FORM_FIELD_KINDS.map((k) => (
                  <option key={k.kind} value={k.kind}>
                    {k.label}
                  </option>
                ))}
              </select>
              <Button type="button" variant="ghost" size="sm" aria-label={`Move question ${i + 1} up`} disabled={i === 0} onClick={() => onChange(moveItem(fields, i, i - 1))}>
                ↑
              </Button>
              <Button type="button" variant="ghost" size="sm" aria-label={`Move question ${i + 1} down`} disabled={i === fields.length - 1} onClick={() => onChange(moveItem(fields, i, i + 1))}>
                ↓
              </Button>
              <Button type="button" variant="ghost" size="sm" aria-label={`Remove question ${i + 1}`} onClick={() => onChange(fields.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
            {field.kind === "choice" && (
              <div className="space-y-2 pl-1">
                {field.options.map((option, k) => (
                  <div key={k} className="flex items-center gap-2">
                    <Input
                      aria-label={`Question ${i + 1} choice ${k + 1}`}
                      value={option}
                      maxLength={60}
                      placeholder="A choice"
                      onChange={(e) => update(i, { options: field.options.map((o, m) => (m === k ? e.target.value : o)) })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove choice ${k + 1} of question ${i + 1}`}
                      disabled={field.options.length <= 1}
                      onClick={() => update(i, { options: field.options.filter((_, m) => m !== k) })}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={field.options.length >= 12}
                  onClick={() => update(i, { options: [...field.options, ""] })}
                >
                  <Plus className="size-4" />
                  Add a choice
                </Button>
                <p className="text-xs text-muted-foreground">Between one and twelve choices, each with a name.</p>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch id={`${qid}-required`} checked={field.required} onCheckedChange={(checked) => update(i, { required: checked })} />
              <Label htmlFor={`${qid}-required`}>Must be answered</Label>
            </div>
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={fields.length >= FORM_FIELDS_MAX}
        onClick={() => onChange([...fields, newFormField(makeFieldId(), "text")])}
      >
        <Plus className="size-4" />
        Add a question
      </Button>
      <p className="text-xs text-muted-foreground">
        Up to six, asked between the phone number and the message. Answers arrive with the message, in the follow-up and in the email.
      </p>
    </div>
  );
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

/**
 * A gallery's photos: one row each with the picture, its description, a
 * caption, order and removal. Adding or changing one opens the same library
 * dialog a single placement uses; a pick appends or replaces.
 */
function GalleryFields({
  items,
  onChange,
  photos,
}: {
  items: GalleryItem[];
  onChange: (items: GalleryItem[]) => void;
  photos: PhotoProps;
}) {
  // Null: closed. A number: replacing that item. "add": appending.
  const [picking, setPicking] = useState<number | "add" | null>(null);
  const update = (i: number, patch: Partial<GalleryItem>) =>
    onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  return (
    <div className="space-y-3">
      <Label>Photos</Label>
      {items.map((item, i) => (
        <div key={`${item.image.id}-${i}`} className="flex flex-wrap items-start gap-3 rounded-xl bg-muted/50 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={memberPhotoSrc(item.image.id)} alt="" className="h-20 w-28 rounded-lg object-cover" />
          <div className="min-w-0 flex-1 space-y-2">
            <Input
              aria-label={`Photo ${i + 1} description`}
              value={item.image.alt}
              maxLength={160}
              placeholder="What is in the picture, for people who can't see it"
              onChange={(e) => update(i, { image: { ...item.image, alt: e.target.value } })}
            />
            <Input
              aria-label={`Photo ${i + 1} caption`}
              value={item.caption}
              maxLength={120}
              placeholder="Caption, or blank"
              onChange={(e) => update(i, { caption: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" aria-label={`Change photo ${i + 1}`} onClick={() => setPicking(i)}>
              <ImagePlus className="size-4" />
            </Button>
            <Button type="button" variant="ghost" size="sm" aria-label={`Move photo ${i + 1} up`} disabled={i === 0} onClick={() => onChange(moveItem(items, i, i - 1))}>
              ↑
            </Button>
            <Button type="button" variant="ghost" size="sm" aria-label={`Move photo ${i + 1} down`} disabled={i === items.length - 1} onClick={() => onChange(moveItem(items, i, i + 1))}>
              ↓
            </Button>
            <Button type="button" variant="ghost" size="sm" aria-label={`Remove photo ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" disabled={items.length >= GALLERY_ITEMS_MAX} onClick={() => setPicking("add")}>
        <Plus className="size-4" />
        Add a photo
      </Button>
      <p className="text-xs text-muted-foreground">Up to twelve. The same photo can appear more than once.</p>
      <PhotoLibraryDialog
        open={picking !== null}
        onOpenChange={(next) => !next && setPicking(null)}
        tenantId={photos.tenantId}
        library={photos.library}
        onLibraryChange={photos.onLibraryChange}
        selectedId={typeof picking === "number" ? (items[picking]?.image.id ?? null) : null}
        onPick={(id) => {
          if (typeof picking === "number") update(picking, { image: { ...items[picking].image, id } });
          else onChange([...items, { image: { id, alt: "" }, caption: "" }]);
          setPicking(null);
        }}
        onRemoved={(id) => onChange(items.filter((it) => it.image.id !== id))}
      />
    </div>
  );
}

/**
 * A Columns section's cards: a sortable list (drag the handle, or the
 * arrows), each card a panel of heading, text, icon, photo and button.
 * Its own DndContext, named after the section, so it never collides with
 * the editor's list of sections around it.
 */
function CardsFields({
  idPrefix,
  cards,
  onChange,
  photos,
}: {
  idPrefix: string;
  cards: Card[];
  onChange: (cards: Card[]) => void;
  photos: PhotoProps;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const update = (i: number, patch: Partial<Card>) => onChange(cards.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = cards.findIndex((c) => c.id === active.id);
    const to = cards.findIndex((c) => c.id === over.id);
    if (from >= 0 && to >= 0) onChange(arrayMove(cards, from, to));
  }
  return (
    <div className="space-y-3">
      <Label>Cards</Label>
      <DndContext id={`cards-${idPrefix}`} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-3">
            {cards.map((card, i) => (
              <SortableCard
                key={card.id}
                idPrefix={idPrefix}
                card={card}
                index={i}
                count={cards.length}
                photos={photos}
                onChange={(patch) => update(i, patch)}
                onMove={(to) => onChange(moveItem(cards, i, to))}
                onRemove={() => onChange(cards.filter((_, j) => j !== i))}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={cards.length >= CARDS_MAX}
        onClick={() => onChange([...cards, { id: makeFieldId(), image: null, icon: "", heading: "", body: [], cta: null }])}
      >
        <Plus className="size-4" />
        Add a card
      </Button>
      <p className="text-xs text-muted-foreground">Up to twelve. Cards fill the columns left to right, row by row; drag one to move it.</p>
    </div>
  );
}

function SortableCard({
  idPrefix,
  card,
  index,
  count,
  photos,
  onChange,
  onMove,
  onRemove,
}: {
  idPrefix: string;
  card: Card;
  index: number;
  count: number;
  photos: PhotoProps;
  onChange: (patch: Partial<Card>) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const id = (name: string) => `${idPrefix}-card-${card.id}-${name}`;
  return (
    <li ref={setNodeRef} style={style} className={`space-y-3 rounded-xl bg-muted/50 p-3 ${isDragging ? "opacity-70 shadow-elevation-1" : ""}`}>
      <div className="flex items-center gap-2">
        <button type="button" className="cursor-grab touch-none text-muted-foreground" aria-label={`Drag to move card ${index + 1}`} {...attributes} {...listeners}>
          <GripVertical className="size-4" />
        </button>
        <span className="flex-1 text-sm font-medium">Card {index + 1}</span>
        <Button type="button" variant="ghost" size="sm" aria-label={`Move card ${index + 1} up`} disabled={index === 0} onClick={() => onMove(index - 1)}>
          ↑
        </Button>
        <Button type="button" variant="ghost" size="sm" aria-label={`Move card ${index + 1} down`} disabled={index === count - 1} onClick={() => onMove(index + 1)}>
          ↓
        </Button>
        <Button type="button" variant="ghost" size="sm" aria-label={`Remove card ${index + 1}`} onClick={onRemove}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      <Field id={id("heading")} label="Heading">
        <Input id={id("heading")} value={card.heading} maxLength={80} onChange={(e) => onChange({ heading: e.target.value })} />
      </Field>
      <Field id={id("body")} label="Text" hint="A line or two. A blank line starts a new paragraph, up to four.">
        <Textarea id={id("body")} value={paragraphsToText(card.body)} rows={3} onChange={(e) => onChange({ body: textToParagraphs(e.target.value, 4) })} />
      </Field>
      <Field id={id("icon")} label="Icon" hint="Shown above the heading when the card has no photo.">
        <select
          id={id("icon")}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={card.icon}
          onChange={(e) => onChange({ icon: e.target.value })}
        >
          <option value="">{iconLabel("")}</option>
          {CARD_ICON_NAMES.map((name) => (
            <option key={name} value={name}>
              {iconLabel(name)}
            </option>
          ))}
        </select>
      </Field>
      <PhotoField
        idPrefix={id("photo")}
        label="Photo"
        hint="Optional. Sits above the heading in place of the icon."
        tenantId={photos.tenantId}
        value={card.image}
        onChange={(image) => onChange({ image })}
        library={photos.library}
        onLibraryChange={photos.onLibraryChange}
      />
      <CtaFields idPrefix={id("cta")} cta={card.cta} optional onChange={(cta) => onChange({ cta })} />
    </li>
  );
}
