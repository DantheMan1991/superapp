/**
 * `next/font/google` under vitest. The real module is a build-time loader:
 * Next's compiler replaces each call with the fetched font's CSS, and outside
 * that compiler the exports are not callable ("Lora is not a function").
 * Tests that import a screen which imports `src/components/site/site-fonts.ts`
 * get this instead: every family is a function returning what the loader
 * would, with nothing fetched. Aliased in vitest.config.ts.
 */
interface FontStub {
  className: string;
  variable: string;
  style: { fontFamily: string };
}

function font(name: string) {
  return (): FontStub => ({
    className: `font-stub-${name}`,
    variable: `font-stub-${name}-variable`,
    style: { fontFamily: name },
  });
}

export const Geist = font("geist");
export const Geist_Mono = font("geist-mono");
export const Lora = font("lora");
export const Nunito = font("nunito");
export const Playfair_Display = font("playfair-display");
export const Source_Serif_4 = font("source-serif-4");
export const Oswald = font("oswald");
export const Source_Sans_3 = font("source-sans-3");
export const Poppins = font("poppins");
export const Cormorant_Garamond = font("cormorant-garamond");
export const Montserrat = font("montserrat");
