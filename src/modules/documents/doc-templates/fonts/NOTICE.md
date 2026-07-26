# Fonts shipped with document generation

**Noto Sans** — `NotoSans-Regular.ttf`, `NotoSans-Bold.ttf`

- Copyright © The Noto Project Authors (Google).
- Licensed under the **SIL Open Font License, Version 1.1**.
- Canonical source: <https://github.com/notofonts/latin-greek-cyrillic>
- License text: <https://openfontlicense.org/open-font-license-official-text/>

## Why these files are in the repository at all

PDF's built-in Helvetica is WinAnsi (cp1252) only. That is fine for most
English text and even covers `ñ`, but it silently mangles anything outside the
codepage — `Nguyễn`, `Łukasz`, `Öztürk`. Those are ordinary names on an
ordinary crew list, and a generated lien waiver that misspells the payee is a
defective document. Noto Sans covers Latin, Greek and Cyrillic, so the common
cases render correctly.

The files are read from disk at request time and registered with
`@react-pdf/renderer` as buffers, which is why `next.config.ts` traces this
directory into the serverless bundle.

## ⚠️ Before this ships to anyone outside the business

The OFL requires the **full license text to be distributed with the font**. A
pointer is not sufficient. Vendor `OFL.txt` verbatim from the upstream Noto
repository into this directory — it was deliberately not reproduced here from
memory, because getting a licence text subtly wrong is worse than obviously
lacking one.
