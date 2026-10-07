import { Bricolage_Grotesque } from "next/font/google";

/**
 * FOOD'S DISPLAY FACE (ADR 0132): Bricolage Grotesque, for the greeting, the
 * card titles and the big numbers only; the body stays Geist. Declared here
 * rather than in the root layout so that only a page drawing Food preloads it
 * (Next's advice for a face one part of an app uses). Its variable goes on
 * `FoodPage` and on Food's dialogs, which are portalled out of the page;
 * `font-food-display` (globals.css) reads it. The optical-size axis is the
 * design's: the face tightens as it grows.
 */
export const foodDisplay = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-bricolage",
  display: "swap",
});
