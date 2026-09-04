# A file

> Opening a file: the viewer and its previews, whether its contents are searchable, and everything in a file's menu: rename, file into a folder, tags, new versions and the version history, a share link, and the trash.
> **Route:** /dashboard/m/documents/browse, /dashboard/m/documents/browse/*
> **Order:** 20

Click a file's name on Browse, in the Inbox or in a search result, and it opens in a viewer over the page. Everything else you do with a file is in its menu, {icon:more-horizontal} at the right of its row. To open the file in its own tab instead, hold {kbd:Ctrl}, or {kbd:⌘} on a Mac, while you click.

## What you see

- **The viewer.** The file's title at the top, with its kind and size under it, such as `PDF · 2.3 MB · 12 pages`. A PDF shows one page at a time, with {button:Previous page|outline|chevron-left}, a `3 / 12` counter and {button:Next page|outline|chevron-right} under it. A photo shows the photo. A spreadsheet or CSV shows its first 200 rows and 40 columns as a table, with a tab per sheet, and `Showing the first 200 of 1240 rows. Download the file for everything.` when it was cut. Other kinds, Word, PowerPoint, zip, email files, TIFF images and plain text among them, show `[Kind] files open in the app on your computer — there is no way to show one accurately in a browser.` Every kind has {button:Download|outline|download} and {button:Open full page|outline|external-link}.
- **`Not searchable by content.`** A note in the viewer when Search cannot read inside this file, followed by why: `No text layer — this looks like a scan or a photo, so only its name and details are searchable.`, `This file type's contents cannot be read yet, so only its name and details are searchable.`, `Too large to read — only its name and details are searchable.`, `Its contents could not be read.`, or `Not read yet.` Nothing is shown when the contents are searchable.
- **The menu.** `Rename`, `File into…`, `Tags…`, `Upload new version…`, `Version history`, `Share link…` and `Move to trash`. A receipt captured by Accounting has no version items, because its bytes belong to the transaction that points at it.

## How to rename a file

1. Click `Rename`. The dialog reads `This sets a display title. The stored file keeps its original name, so downloads and attachments are unaffected.`
2. Type the `Title` and click {button:Save|primary}. You see `Renamed`. Clear the title and the list shows the file name again.

## How to file a file into a folder

1. Click `File into…`. The dialog reads `Filing into an owners-only folder hides the file from staff.`
2. Pick the `Folder`, or `Inbox (unfiled)` to take it out of its folder.
3. Click {button:File|primary}. You see `Filed`. A file taken out to the Inbox is visible to everyone, whatever folder it came from.

## How to tag a file

1. Click `Tags…`. Every tag in the business is a chip. Click one to put it on the file, {badge:As-built|primary}, and again to take it off, {badge:As-built|outline}. Up to 30 on one file.
2. To make a new tag, type it under `Create a tag`, such as `As-built`, and click {button:Add|outline|plus} or press {kbd:Enter}. It is created for the whole business and put on this file.
3. Click {button:Save tags|primary}. You see `Tags saved`.

## How to replace a file with a new version

1. Click `Upload new version…`. The dialog reads `This becomes the file everyone opens. The current version is kept in the history — nothing is overwritten, and any share links you have already sent will show the new version.`
2. Choose the file under `Replacing [file name]`, and say `What changed? (optional)`, such as `Revised after the site walk`.
3. Click {button:Upload version|primary}. You see `Saved as v3`. If the new file is byte for byte the old one, you see `Saved as v3, but it's identical to the version it replaced`.

The file's title stays as it was. The stored file name, size and searchable contents follow the new version.

## How to see or restore an earlier version

1. Click `Version history`. The count after it, such as `(3)`, is how many versions there are. Each row shows `v2`, {badge:Current|secondary} on the one everyone opens, {badge:Restored from v1|outline} on one that came back from the history, the file name, size and date, and the note that was written.
2. Click {icon:download} on a row to download that version.
3. Click {icon:rotate-ccw} on an earlier version to make it current again. You see `v1 restored as v4`. Restoring adds a new version pointing at the old file. The history is never rewound.

A file that has never been replaced shows one row, `v1`, and `This file has not been replaced yet. Upload a new version and the current one is kept here.`

## How to share a file outside the business

Click `Share link…` and follow [Shared links](shares.md). A link always shows the current version of the file. A file inside an owners-only folder cannot be shared: `Owners-only files and folders can't be shared outside the business. Move it somewhere shared first, or turn off owners-only.`

## How to trash a file

1. Click `Move to trash`. There is no confirmation. You see `Moved to trash`.
2. To bring it back, find it on the Trash page. It returns to the folder it was in. See [Trash](trash.md).

## Messages

| Message | What it means |
| --- | --- |
| `This is an older .xls file, which can't be previewed. Download it, then save it as .xlsx if you want a preview next time.` | The spreadsheet is in the old Excel format. |
| `This spreadsheet is too large to preview — download it to open it.` | It is over 25 MB. |
| `This sheet is empty. Pick another sheet above.` | The sheet has no rows. |
| `That type or size isn't accepted (up to 100MB)` | The replacement file is a kind Documents does not take, or too big. |
| `This changed since you opened it — reload and try again.` | Somebody else renamed the file, or uploaded a version, while your dialog was open. |
| `That file is in the trash — restore it first.` | Restore it from Trash before changing it. |
| `That file no longer exists.` | The file was trashed, or is in a folder you cannot see. |
| `Detach this file from its transactions before trashing it.` | The file is attached to a bill, invoice, payment or bank transaction in Accounting. Detach it there first. |
| `Remove this photo from the record it is on before trashing it.` | The file is a photo on a record, such as an animal or an asset. Remove it from the record first. |
| `A tag with that name already exists.`, `That's the maximum number of tags.`, `That tag name can't be used — it needs at least one letter or number.` | The new tag was refused. |

## Not on this page

The viewer shows no folder, tags, uploader or dates; those are on the row behind it. There is no zoom or rotate on a PDF, no preview for Word or PowerPoint, no comparing of two versions, and no deleting of a single version. A spreadsheet preview shows values, not formatting. Nothing is ever deleted for good.

## Who can do what

Everyone can open, preview and download. Owners and staff rename, file, tag, version, restore and trash. Accountants keep one item on the {icon:more-horizontal} menu: `Version history`, which is a read and the thing somebody reviewing a file actually wants. Rename, `File into…`, `Tags…`, `Upload new version…`, `Share link…` and `Move to trash` are not drawn for them.
