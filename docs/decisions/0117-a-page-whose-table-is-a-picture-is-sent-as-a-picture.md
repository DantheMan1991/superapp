# 0117 — A page whose table is a picture is sent as a picture, and no other picture of the file is

- **Date:** 2026-09-29
- **Status:** Accepted
- **Amends:** [0112](0112-a-program-pdf-is-read-on-the-device-and-only-its-words-and-links-are-sent.md) — its *"only its words and links are sent"* clause, and the import screen's line that says it. Everything else in 0112 stands: the PDF is read on the device, never uploaded, and nothing of it is kept.
- **Affects:** The fitness import and "Read the PDF again" ([modules/fitness.md](../modules/fitness.md), F4b):
  `read-program-pdf.ts` (`pictureOf`), `core/draft.ts` (`pointsToPicture`,
  `pictureFits`, `draftRequestSchema.pictures`), `draft-model.ts` (the image
  blocks), `draftProgramAction` and `readAgainAction`, the privacy line on both
  screens.

## Context

F4b makes a program's side self-assessment something the app can run: the
tests, how many must agree, and which side each result points to. In the
founder's program those tests are in two places only: a table on one page, and
the video that shows them being done. The table is an image. The page's words
say to follow the table and stop; its rows and cells are pixels. ADR 0112
sends only a page's words and links, so no draft could see the tests, however
it was asked.

He chose how to get them: read them from his PDF, the table's picture
included, over typing them in by hand or a list of tests built into the app.

A picture of one page is a different thing from the file. The page that holds
the tests is one page of 59, and the reason 0112 kept the file on the device
(somebody else's book, bought by the person, and 19 MB over a phone
connection) holds for the book, not for one table.

## Decision

**A page whose words point to a table or chart, and that draws an image, is
rendered on the device and sent as a JPEG with the words. No other picture of
the file is sent.** `pointsToPicture` decides from the page's words: "table",
"tables", "chart" or "charts", but not "table top", the position on hands and
knees. `drawsImage` asks the page's drawing operations whether it paints an
image at all, and `pictureOf` renders the whole page at 1,100 px wide, which
reads a table's cells. At most four pages, each at most 1.5 MB of base64 and
all of them 2.4 MB together (`pictureFits` on the device, the schema again on
the server), so the request stays under the 4 MB a server action takes. A
picture that would pass that is left on the device and the page's words still
go. The prompt says which pages the pictures are of.

Nothing of them is kept. They are in the request to Claude and nowhere else:
not the import row, not the program, not a log. Both screens say so before the
file is chosen: `The file stays on your device. Only its words and links are
sent, to draft the program, with a picture of any page that shows a table as
an image.` (the import) and the same without "to draft the program" (reading
again).

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Send every page as a picture | The whole book leaves the device as images, 59 pages of a bought program for one table, and the draft does not need them: the words and links make it |
| Send the PDF itself to Claude | As in 0112: the whole file, over the action's 4 MB, and its links, which carry every video, are still not in it |
| Read the table on the device (OCR) | A model downloaded to the phone to read one page of one program, and a worse reading of a table than Claude's |
| Pick a page by its picture alone | 38 of his 59 pages draw an image: every exercise page has its photograph. The words are what find the table |
| Have the person type the tests in | His call against it. The editor still takes them by hand, for a program whose table is not found |
| Ship a list of tests with the app | The tests are the author's, and another program has other tests. A module must not carry one program's content |

## Consequences

- A picture leaves the device where 0112 promised only words and links. It is
  of a page that points to a table, at most four of them, and both screens say
  so before a file is chosen. The line on the screen is still a promise: a
  change that sends more replaces this ADR.
- A table the words do not name ("follow the steps below") is not sent, and
  its tests are not read; the person adds them in the editor. A program that
  says "table" on four photographed pages before the real one spends the
  pictures on them.
- Each picture costs a couple of thousand input tokens, about a quarter of
  what all of his program's words cost (about 8,000). His program sends one.
- The same rule serves reading a saved program's PDF again, which is how his
  already-imported program gains its assessment without being imported again.

## Notes

What would make us revisit: a program whose exercises themselves, not only a
table, exist only as pictures, where a draft from words and links is not
enough; or a real program whose table the word rule misses.
