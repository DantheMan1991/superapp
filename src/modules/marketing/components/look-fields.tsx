"use client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { siteFonts } from "@/components/site/site-fonts";
import { foregroundOn, type HexColor } from "@/lib/brand/core";
import {
  BRAND_LOOKS,
  BUTTON_SHAPE_SPECS,
  BUTTON_SHAPES,
  FONT_PAIRING_SPECS,
  FONT_PAIRINGS,
  isBrandLook,
  isButtonShape,
  isFontPairing,
  LOOK_SPECS,
  resolveLook,
  type BrandLook,
  type ButtonShape,
  type FontPairing,
} from "@/lib/brand/looks";
import { cn } from "@/lib/utils";

/**
 * The look block of the brand kit form: a look, the fonts, the buttons, and
 * a sample that reads as the website will. Every choice is a preset from
 * `src/lib/brand/looks.ts`; `''` is "as the look says" on the business kit
 * and "as your brand's" on a company's.
 */
export interface LookValues {
  look: string;
  fontPairing: string;
  buttonShape: string;
}

/** What `''` falls back to on a company kit: the business kit's answers. Null on the business kit itself. */
export interface LookInherits {
  look: BrandLook | null;
  fontPairing: FontPairing | null;
  buttonShape: ButtonShape | null;
}

function Row<T extends string>({
  label,
  value,
  options,
  caption,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  caption: string;
  onChange: (next: T) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {options.map(([v, text]) => (
          <Button
            key={v}
            type="button"
            variant={value === v ? "default" : "outline"}
            size="sm"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
          >
            {text}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}

export function LookFields({
  values,
  inherits,
  sampleName,
  primary,
  onChange,
}: {
  values: LookValues;
  inherits: LookInherits | null;
  /** The heading of the sample: the business name as it stands in the form. */
  sampleName: string;
  primary: HexColor | null;
  onChange: (patch: Partial<LookValues>) => void;
}) {
  const fallbackWord = inherits ? "Your brand's" : "As the look";
  const effective = resolveLook({
    look: isBrandLook(values.look) ? values.look : (inherits?.look ?? null),
    fontPairing: isFontPairing(values.fontPairing) ? values.fontPairing : (inherits?.fontPairing ?? null),
    buttonShape: isButtonShape(values.buttonShape) ? values.buttonShape : (inherits?.buttonShape ?? null),
  });
  const fonts = siteFonts(effective.fontPairing);
  const colour: HexColor = primary ?? "#1f2937";

  // The business kit shows `''` as Modern, which is what `''` means there; a
  // company kit has a real "your brand's" to show instead.
  const lookOptions: ReadonlyArray<readonly [string, string]> = [
    ...(inherits ? [["", fallbackWord] as const] : []),
    ...BRAND_LOOKS.map((look) => [look, LOOK_SPECS[look].name] as const),
  ];
  const lookValue = values.look || (inherits ? "" : "modern");
  const fontSpec = FONT_PAIRING_SPECS[effective.fontPairing];

  return (
    <div className="space-y-4">
      <Row
        label="Look"
        value={lookValue}
        options={lookOptions}
        caption={
          values.look || !inherits
            ? LOOK_SPECS[effective.look].note
            : `${LOOK_SPECS[effective.look].name}, from your brand.`
        }
        onChange={(look) => onChange({ look })}
      />
      <Row
        label="Fonts"
        value={values.fontPairing}
        options={[["", fallbackWord] as const, ...FONT_PAIRINGS.map((p) => [p, FONT_PAIRING_SPECS[p].name] as const)]}
        caption={`${fontSpec.heading} over ${fontSpec.body}. ${fontSpec.note}`}
        onChange={(fontPairing) => onChange({ fontPairing })}
      />
      <Row
        label="Buttons"
        value={values.buttonShape}
        options={[["", fallbackWord] as const, ...BUTTON_SHAPES.map((s) => [s, BUTTON_SHAPE_SPECS[s].name] as const)]}
        caption={values.buttonShape ? `${BUTTON_SHAPE_SPECS[effective.buttonShape].name} buttons on every page.` : `${BUTTON_SHAPE_SPECS[effective.buttonShape].name}, as the look says.`}
        onChange={(buttonShape) => onChange({ buttonShape })}
      />
      <div
        className={cn("border border-divider bg-white p-4 text-neutral-900", fonts.className)}
        style={{ borderRadius: effective.radius }}
        aria-label="How your website reads"
      >
        <p className="text-xs text-neutral-500">How your website reads</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight" style={{ fontFamily: fonts.heading, color: colour }}>
          {sampleName}
        </p>
        <p className="mt-1 text-sm text-neutral-700" style={{ fontFamily: fonts.body }}>
          Open Saturday from eight. Call ahead for large orders.
        </p>
        <span
          className="mt-3 inline-block px-5 py-2 text-sm font-medium shadow-sm"
          style={{ borderRadius: effective.buttonRadius, backgroundColor: colour, color: foregroundOn(colour), fontFamily: fonts.body }}
        >
          Get in touch
        </span>
      </div>
    </div>
  );
}
