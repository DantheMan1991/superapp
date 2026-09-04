# A template

> Writing a template in Markdown with blanks in it, previewing it, publishing a frozen version, making a PDF from it, and archiving it.
> **Route:** /dashboard/m/documents/templates/*
> **Order:** 70

Open **Templates** in the Documents menu and click a template. Write it on the left, watch the preview on the right, save drafts as you go, and click {button:Publish|primary|send} when it is right. Documents are only ever made from a published version, with {button:Make a document|primary|file-down}.

## What you see

- **The top of the page.** `All templates` goes back to the list. The title is the template's name, with {badge:Published v2|secondary} when a version is published and {badge:Draft v3|outline} when there are unpublished changes, then {button:Save draft|outline|save} and {button:Publish|primary|send}. Once something is published, a line reads `v2 is published and can never change. Saving here keeps a separate draft; publishing it creates v3.`
- **`Published v2 is ready to use.`** A panel above the editor once a version is published, with `3 documents made so far.` and {button:Make a document|primary|file-down}.
- **The editor.** On the left, `Template — write in Markdown, and use {{field_name}} where a value goes`. On the right, `Preview`, the template as it will print, with sample values in place.
- **`Fields`.** One row for every blank in the template: its name, such as `{{payer}}`, a `Label` for the person filling it in, a `Required` box, checked to begin with, and a `Sample value (preview only)`. Under the rows: `Sample values are for the preview only — they are never saved with the template. Try typing # ACME into one: it stays text, because values are placed into the parsed document rather than into its source.`
- **`History`.** Every version, newest first: `v2`, {badge:Published [date]|secondary} or {badge:Draft|outline}, and how many fields it has.
- **{button:Archive|outline}**, or {button:Restore|outline} on an archived template, at the bottom. An archived template reads `This template is archived. It is kept so documents generated from it still name something real.`

## How to write a template

1. Write the document in the left box in Markdown: `#` for a heading, a blank line between paragraphs, `-` for a list, `**bold**` and `*italic*`.
2. Put `{{field_name}}` wherever a value goes, for example `Received from {{payer}} the sum of {{amount}}.` A name starts with a letter and uses letters, digits and underscores, up to 40 characters, and a template holds up to 60 different fields. Each one appears under `Fields` as you type.
3. Give each field a `Label`, the words the person filling it in will see, such as `Payer`. Uncheck `Required` on one that may be left blank. Type a `Sample value` to see the preview fill in.
4. Click {button:Save draft|outline|save}. You see `Saved as draft v1`. Come back and carry on any time.

A value is always placed as plain text, so a name like `# ACME` prints as `# ACME`, not as a heading. Markdown tables, strikethrough and task lists show in the preview but print as plain text in the PDF, so leave them out. Links print as their text, and pictures are dropped.

## How to publish

1. Click {button:Publish|primary|send}. What is on screen is saved and published together. You see `Published v1`.
2. A published version never changes. Saving after that keeps a draft, and publishing the draft makes the next version. Documents are always made from the newest published version.

## How to make a document

1. Click {button:Make a document|primary|file-down}. The dialog is titled with the template's name and reads `Uses the published v2. The PDF is filed in your cabinet and can be shared or emailed like any other file.`
2. Fill in each field. An optional one is marked `(optional)`. The button reads `2 fields to fill` until every required field has something in it.
3. Give it a `Title (optional)`, or leave it to be named after the template and its number, such as `Lien Waiver 14`.
4. Pick `File it into`: `Inbox (unfiled)`, or a folder.
5. Click {button:Make the PDF|primary}. You see `Created #14`. The PDF is in the Inbox or the folder you chose, named `lien-waiver-14.pdf`, with the template's name and version in its footer. Numbers run in one sequence across every template in the business.

A blank optional field prints as `[field_name]`, so a gap is never silent. The new PDF is found by its title and name at once; its contents become searchable later.

## How to archive a template

1. Click {button:Archive|outline}. You see `Template archived`. It moves under `Archived` on the list and no document can be made from it.
2. Click {button:Restore|outline} on an archived template to bring it back. You see `Template restored`.

## Messages

| Message | What it means |
| --- | --- |
| `No fields yet. Add {{like_this}} to the template and they appear here.` | The template has no blanks yet. |
| `Unfilled fields show as [name] so a gap is never silent.` | A field with no sample value shows its name in brackets in the preview. |
| `Write the template before publishing it.` | The template is empty. |
| `This template has no fields — it will generate as written.` | In the dialog: there is nothing to fill in. |
| `Fill in the required fields first.` | A required field was left blank. |
| `That template is archived — restore it before making documents from it.` | Restore it first. |
| `That folder no longer exists.` | The folder you chose was deleted or hidden. Pick another. |
| `This changed since you opened it — reload and try again.` | Somebody else archived or restored the template while your page was open. |

## Not on this page

A template's name and description cannot be changed. A published version cannot be read in full from the history, only its date and field count. A finished document cannot be made again from its recorded values; make a fresh one. There is one page size, Letter, and no letterhead. Ask us if you need any of these.

## Who can do what

Owners and staff write, publish, archive and make documents. Staff cannot file a document into an owners-only folder, because they cannot see it. Accountants can read a template, its fields and its whole history. The body and the field boxes are filled in and legible but not typeable, and {button:Save draft|outline}, {button:Publish|primary}, {button:Make a document|primary} and the archive control are not drawn for them.
