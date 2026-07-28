# Marketing images

Everything the public site (`/`, `/about`, `/contact`) renders as a photo or
graphic lives in this folder. Nothing here is served to signed-in app users, and
nothing here is tenant data — treat it as fully public.

## Swapping an image

1. Drop your file in this folder, **using the same filename** as the one you are
   replacing.
2. If your file's pixel dimensions differ from the table below, update the
   matching `width`/`height` in [`src/lib/site.ts`](../../src/lib/site.ts).
   `next/image` uses those numbers to reserve layout space before the file
   loads; wrong numbers give you a stretched image and a visible jump on load.
3. That's it. No other code changes.

If you want a different filename or a new slot entirely, add or edit the entry
in the `IMAGES` object in `src/lib/site.ts` — the pages read every path from
there and never hardcode one.

## The slots

| File | Where it appears | Dimensions | Aspect | Notes |
| --- | --- | --- | --- | --- |
| `hero.png` | Home page hero | 2400 × 1600 | 3:2 | A real product screenshot is the strongest thing you can put here. |
| `about-story.png` | About page, story section | 2000 × 1200 | 5:3 | A photo of real work being done beats a stock office shot. |
| `contact-aside.png` | Contact page, beside the form | 1200 × 900 | 4:3 | Optional and purely decorative — its `alt` is empty by design. |
| `team/*.jpg` | About page team grid | 800 × 800+ | 1:1 | Square headshots. Add people in the `TEAM` array in `src/lib/site.ts`; the section stays hidden while that array is empty. |

## What's in here now

The three PNGs are **generated placeholders**, not final artwork. They are
brand-coloured compositions rather than grey "image goes here" boxes, so the
site looks deliberate until you have real photography.

They are produced by [`scripts/marketing-placeholders.ts`](../../scripts/marketing-placeholders.ts)
and committed so that a clean checkout renders correctly. To regenerate them
after changing a dimension in `site.ts`:

```bash
npx tsx scripts/marketing-placeholders.ts
```

## File format and size

- **Photographs** → `.jpg`, quality ~80. Save at roughly 2× the largest size the
  image is ever displayed at.
- **Screenshots, logos, anything with hard edges** → `.png`.
- Don't pre-compress aggressively. Next.js optimizes on demand and serves WebP
  or AVIF to browsers that accept them, so it wants a high-quality source.
- Avoid SVG here. Next.js does not optimize SVGs, and an SVG from an untrusted
  source can carry script.
