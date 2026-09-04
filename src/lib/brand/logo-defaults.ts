import { foregroundOn } from "./core";
import {
  normalizeSpec,
  paletteFor,
  type LogoBrief,
  type LogoSpec,
} from "./logo-spec";

/**
 * The standard set: six candidates drawn from the catalogue by rule, with no
 * model in the loop. Two jobs — the whole set when the assistant is not
 * available (no key on this deployment, a failed call), and padding when it
 * returns fewer valid candidates than the screen shows. Pure.
 */
export function standardLogoSpecs(brief: LogoBrief): LogoSpec[] {
  const colors = paletteFor(brief);
  const words = brief.name.trim().split(/\s+/);
  // A long name stacks better than it stretches: "Hilltop Farm Supply" reads
  // as two lines, "Hilltop" as one.
  const canStack = words.length >= 2;
  const line1 = canStack ? words.slice(0, Math.ceil(words.length / 2)).join(" ") : brief.name;
  const line2 = canStack ? words.slice(Math.ceil(words.length / 2)).join(" ") : "";
  const onText = { text: colors.text, mark: colors.mark, markText: colors.markText };
  const inverted = { text: colors.text, mark: colors.text, markText: foregroundOn(colors.text) };

  const set: LogoSpec[] = [
    {
      layout: "wordmark",
      line1: brief.name,
      line2: "",
      initials: brief.initials,
      weight: "bold",
      textCase: "upper",
      tracking: 0.14,
      mark: "none",
      colors: onText,
      rationale: "Spaced capitals: sturdy and easy to read small.",
    },
    {
      layout: "wordmark",
      line1: brief.name,
      line2: "",
      initials: brief.initials,
      weight: "regular",
      textCase: "title",
      tracking: 0,
      mark: "bar",
      colors: onText,
      rationale: "The name as written, with a rule in the brand colour.",
    },
    {
      layout: canStack ? "stacked" : "wordmark",
      line1,
      line2,
      initials: brief.initials,
      weight: "bold",
      textCase: "upper",
      tracking: 0.08,
      mark: "none",
      colors: onText,
      rationale: canStack ? "Two lines, so it sits well in a square space." : "Bold capitals, tightly set.",
    },
    {
      layout: "monogram",
      line1: brief.name,
      line2: "",
      initials: brief.initials,
      weight: "bold",
      textCase: "upper",
      tracking: 0.02,
      mark: "circle",
      colors: onText,
      rationale: "Initials in a circle: works as an icon and a stamp.",
    },
    {
      layout: "mark-left",
      line1: brief.name,
      line2: brief.tagline.slice(0, 28),
      initials: brief.initials,
      weight: "bold",
      textCase: "title",
      tracking: 0,
      mark: "rounded",
      colors: onText,
      rationale: "A mark beside the name, the shape most apps and signs use.",
    },
    {
      layout: "mark-above",
      line1: brief.name,
      line2: "",
      initials: brief.initials,
      weight: "regular",
      textCase: "upper",
      tracking: 0.2,
      mark: "leaf",
      colors: inverted,
      rationale: "A leaf over spaced capitals, quiet and natural.",
    },
  ];
  return set.map(normalizeSpec);
}
