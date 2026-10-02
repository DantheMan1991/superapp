/**
 * WHAT THE LISTENER CAN HEAR (docs/modules/voice-commands.md; ADR 0124).
 *
 * The keyword spotter knows no words, only sounds: each phrase is written in
 * the model's own tokens, the ARPAbet phones of the CMU pronouncing dictionary
 * (its `en.phone` lexicon), vowels carrying their stress. A phrase is heard
 * when the sounds go by in that order, so one phrase may carry several
 * pronunciations: the dictionary's, and the ones people (and the spike's
 * recorded voices) actually say, like "nex step" for "next step".
 *
 * Every pronunciation here was measured before it went in: Deepgram's four
 * recorded voices saying each phrase, fed to the spotter, and seven sentences
 * of ordinary kitchen talk that must fire nothing (the D1c spike, in
 * docs/modules/voice-commands.md). Add a phrase the same way, never by
 * guessing at its phones.
 *
 * Shared, because a tool's words are its own but the sounds are not: Food's
 * cook mode says "next step", and Workouts (F6) will say "next" and "done".
 * A tool maps phrases to its own commands with `keywordsFor`.
 */

/** The model's English tokens: 39 ARPAbet phones, each vowel with stress 0, 1 or 2. */
export const MODEL_PHONES: ReadonlySet<string> = new Set(
  (
    "AA0 AA1 AA2 AE0 AE1 AE2 AH0 AH1 AH2 AO0 AO1 AO2 AW0 AW1 AW2 AY0 AY1 AY2 B CH D DH " +
    "EH0 EH1 EH2 ER0 ER1 ER2 EY0 EY1 EY2 F G HH IH0 IH1 IH2 IY0 IY1 IY2 JH K L M N NG " +
    "OW0 OW1 OW2 OY0 OY1 OY2 P R S SH T TH UH0 UH1 UH2 UW0 UW1 UW2 V W Y Z ZH"
  ).split(" "),
);

/**
 * The phrases, each with its pronunciations. Measured 2026-10-02 against four
 * voices: "next step", "repeat", "start timer" and "stop timer" heard from all
 * four; "go back" and "ingredients" from two, so each has a longer alternate,
 * "previous step" and "show ingredients", heard from three.
 */
export const PHRASES = {
  "next step": ["N EH1 K S T S T EH1 P", "N EH1 K S S T EH1 P", "N EH1 K S T EH1 P"],
  "go back": ["G OW1 B AE1 K", "G AH0 B AE1 K", "G OW0 B AE1 K"],
  "previous step": ["P R IY1 V IY0 AH0 S S T EH1 P", "P R IY1 V IY0 AH0 S T EH1 P"],
  repeat: ["R IH0 P IY1 T", "R IY0 P IY1 T", "R IY1 P IY1 T"],
  "start timer": ["S T AA1 R T T AY1 M ER0", "S T AA1 R T AY1 M ER0", "S T AA1 R D AY1 M ER0"],
  "stop timer": ["S T AA1 P T AY1 M ER0", "S T AA1 P AY1 M ER0"],
  ingredients: [
    "IH2 N G R IY1 D IY0 AH0 N T S",
    "IH0 N G R IY1 D IY0 AH0 N T S",
    "IH2 N G R IY1 D IY0 IH0 N T S",
    "IH0 N G R IY1 D Y AH0 N T S",
  ],
  "show ingredients": ["SH OW1 IH2 N G R IY1 D IY0 AH0 N T S", "SH OW1 IH0 N G R IY1 D IY0 AH0 N T S"],
} as const satisfies Record<string, readonly string[]>;

export type PhraseKey = keyof typeof PHRASES;

/** One thing the listener listens for, as the engine takes it. */
export interface Keyword {
  /** Returned unchanged when it is heard: the tool's own command. */
  label: string;
  matches: { tokens: string[] }[];
}

/**
 * The keywords for the commands a screen is listening for now: each command
 * hears every pronunciation of every phrase it is given. The engine refuses a
 * vocabulary in which two pronunciations are the same sounds, so a phrase
 * belongs to one command at a time.
 */
export function keywordsFor<C extends string>(
  commands: Readonly<Record<C, readonly PhraseKey[]>>,
  listening: readonly C[],
): Keyword[] {
  return listening.map((command) => ({
    label: command,
    matches: commands[command].flatMap((phrase) => PHRASES[phrase].map((sounds) => ({ tokens: sounds.split(" ") }))),
  }));
}
