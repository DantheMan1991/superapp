# 0112 — A program PDF is read on the device, and only its words and links are sent

- **Date:** 2026-09-27
- **Status:** Accepted
- **Affects:** The fitness import ([modules/fitness.md](../modules/fitness.md),
  F1): `read-program-pdf.ts`, `draftProgramAction`, `fitness_imports`. The
  pdfjs loader it shares with Documents (`src/lib/pdf/browser.ts`).

## Context

The founder's workout program is a PDF he bought: 59 pages, 19.3 MB. The
program is in its words, and every exercise video is a link annotation on the
exercise's page, which Documents' extracted text drops. Claude turns the words
and the links into a draft program in about a minute.

The path the platform already has is Documents': upload the file to Blob
storage and read it on the server. Two facts argue against it here. The
file is somebody else's copyrighted book that the person paid for, and keeping
a copy on our side makes us the keeper of both the book and the purchase, for
no gain: the draft needs the words and links, not the file. And it is large.
A server action takes 4 MB (`serverActions.bodySizeLimit`), so the only way
to get it to the server would be a direct upload to Blob storage, which puts a
19 MB upload on a phone connection before anything happens.

## Decision

**The browser reads the PDF, and only its words and links leave the device.**
pdfjs on the person's device takes each page's text and the URLs of its link
annotations (`readProgramPdf`). Anything that cannot be a program is refused
there, before a word is sent: over 150 pages, over 300,000 characters, or no
words at all (a scan) (`draftTextProblem`, which the server asks again). The
draft action receives the file's name, its page count and the pages' words
and links, and nothing else. **Nothing of the file
is kept**: the import row holds the name, the counts and the draft, and the
draft is dropped once the program is saved. The import screen says so, in
those words: `The file stays on your device. Only its words and links are
sent, to draft the program.`

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Upload to Blob storage and read it on the server, as Documents does | A stored copy of a bought book, and a 19 MB upload over a phone connection, for a draft that needs about 150 KB of words. Documents keeps files because keeping the file is its job; here the file is only a source |
| Upload it, read it on the server, and delete it straight after | No copy is kept, but the book still travels to and is opened on our side, the upload is the same 19 MB, and "deleted after" is a harder promise to state and to check than "never sent" |
| Send the PDF itself to Claude as a document | The whole file leaves the device, it is still over the 4 MB an action takes, and the videos are link annotations, which are not in the page's printed text or its image. The links are the half of the program a person cannot type back in |

## Consequences

- The book is never on our side. Its words pass through once, to Claude, to
  make the draft, and are not stored.
- A scanned PDF cannot be imported: it has no words to send, and reading
  pictures of pages (OCR) is not built. The import says so and offers hand
  entry.
- The reading costs the person's device a few seconds for a 59-page PDF. The
  page count is checked before any page is read, so a 400-page book is
  refused at once.
- The pdfjs loader moved out of Documents into `src/lib/pdf/browser.ts`, which
  both use, since a core module may not import another.
- The line on the import screen is a promise. A change that uploads the file
  replaces this ADR; it does not quietly break it.

## Notes

What would make us revisit: a program that exists only as scans, where the
words have to be read from pictures (on the device, or with this ADR
superseded); or a program whose content is mostly in its pictures, where the
words and links are not enough for a draft.
