# Browse

> Your folders and files: the list and the two grid layouts, uploading and dragging files, making folders, and everything in a folder's menu: rename, share, move, email address, owners-only, delete.
> **Route:** /dashboard/m/documents/browse, /dashboard/m/documents/browse/*
> **Order:** 10

Open **Browse** in the Documents menu. The top of Browse shows your top-level folders and, under them, the files in the Inbox that are not filed yet. Click a folder to go into it. To upload into the folder you are in, click {button:Upload|outline|upload} or drop files anywhere on the page. To make a folder inside it, click {button:New folder|primary|folder-plus}. What you can do with one file is in [A file](file.md).

## What you see

- **The title and the trail.** The folder's name, or `Documents` at the top. Under it, the trail: `All folders`, then each folder above this one, then this folder. Click any name in the trail to go there.
- **{badge:Owners only|secondary}** or **{badge:Inherited|secondary}** in the title row, for owners, when the folder is hidden from staff by its own setting or by a folder above it.
- **The layout switch.** Three buttons, `List`, `Icons` and `Thumbnails`. Your choice is remembered in this browser.
- **Folders first, then files.** Folders in the order they were set up, then by name. Files newest first, fifty at a time, with {button:Load more|outline} at the bottom when there are more. Clicking it shows the next fifty in place of these.
- **A folder row.** Its name, {badge:Owners|secondary} or {badge:Inherited|secondary} when it is hidden from staff, and its menu, {icon:more-horizontal}.
- **A file row.** Its title, or its file name when it has no title. Under it, the size, such as `1.2 MB`, then `· v3` when it has more than one version, then `· from Receipts` for a receipt captured by Accounting, and its tags. At the right, the date it was added and its menu, {icon:more-horizontal}. Click the name to open the file.
- **Icons and Thumbnails.** Tiles instead of rows, folders first. A folder tile reads `Folder`. A file tile shows its kind, such as `PDF`, `Image`, `Excel` or `Word`, and its size. In Thumbnails, a photo shows the photo and a PDF shows its first page once it scrolls into view. Tiles do not show versions, tags or dates.
- **Tags.** In the list, each tag on a file is a chip such as {badge:As-built|outline}. Click one to see every file carrying it.

## How to upload files

1. Go into the folder the files belong in, or stay at the top to put them in the Inbox.
2. Click {button:Upload|outline|upload} and pick one or more files, or drag them from your desktop onto the page. `Drop to upload here` appears while you hold them over it, and `Uploading…` while they go up. Drop them onto a folder row to put them straight into that folder.
3. Each file goes up in turn. You see `File uploaded`, or `3 files uploaded`. A file that looks like one you already have is still uploaded, with the note `[file name] looks like a file you already have`.

A file can be up to 100 MB. Photos (JPEG, PNG, WebP, GIF, TIFF), PDFs, plain text, CSV and Markdown, Word, Excel and PowerPoint, zip files and whole emails are accepted. Web pages and SVG images are not. A file whose contents can be read is searchable as soon as it lands. A large PDF can take a few seconds to go up.

## How to make a folder

1. Click {button:New folder|primary|folder-plus}. The dialog reads `Folders can be nested up to ten levels deep.`
2. Type a `Name`, such as `Job photos`. No slashes, and 120 characters at most. Two folders in the same place cannot share a name.
3. Owners can turn on `Owners only`: `Hidden from staff, including everything filed inside it.`
4. Click {button:Create|primary}. You see `Folder created`.

## How to move files and folders by dragging

1. Drag a file row or tile onto a folder row, a folder tile, or a name in the trail, and drop it. You see `Moved`. Dropping it on `All folders` sends it back to the Inbox, unfiled.
2. Owners can drag a folder the same way. You see `Folder moved`. A folder cannot be dropped inside itself.
3. The row moves once the page refreshes. Dragging works with a mouse, one item at a time, on this page only. Everything drag does, the menus do too.

## How to use a folder's menu

Click {icon:more-horizontal} on the folder.

1. `Rename` opens `Rename folder`. Change the `Name` and click {button:Save|primary}. You see `Folder renamed`.
2. `Share link…` makes a link for someone outside the business. See [Shared links](shares.md). It is not offered on an owners-only folder.
3. `Move to…`, owners only, opens `Move folder`, `Everything inside moves with it.` Pick the `New location`, `Top level` or a folder, and click {button:Move|primary}. You see `Folder moved`. A folder moved under an owners-only folder becomes owners-only too.
4. `Email files here…`, owners only. See below.
5. `Make owners only`, owners only, hides the folder and everything in it from staff at once, with no confirmation. You see `Folder is owners only`. `Make visible to everyone` reverses it. A folder inside that is owners-only in its own right stays hidden.
6. `Delete`, owners only, asks `Delete “[name]”?` and reads `Anything inside moves up one level rather than being deleted — files are never destroyed here.` Click {button:Delete folder|destructive}. You see `Folder deleted`. Files in a deleted top-level folder go to the Inbox.

## How to give a folder an email address

1. Owners: open the folder's menu and click `Email files here…`. The dialog reads `Give this address to a subcontractor or supplier and anything they attach lands straight in this folder. Nobody needs a login.` and, before an address exists, `No address yet. Anyone who has the address can put files in this folder, so only share it with people who should be able to.`
2. Click {button:Create address|primary}. You see `Address created`, and the address appears.
3. Click {button:Copy|outline|copy} and give the address to the people who should be able to send files in. Everything they attach arrives in this folder already filed, up to 100 files an hour. Nobody is told when a file arrives, so check the folder.
4. To stop it, open the dialog again and click {button:Turn off|destructive}. You see `Address turned off`. The note reads `Turning this off stops delivery immediately. Switching it on again issues a different address — the old one stops working.`

An owners-only folder cannot have an address, and delivery to a folder stops if it is made owners-only.

## Messages

| Message | What it means |
| --- | --- |
| `This folder is empty. Drop files here to upload them.` | Nothing is in this folder yet. |
| `[file name]: that type or size isn't accepted (up to 100MB)` | The file is a kind Documents does not take, or is over 100 MB. |
| `Give the folder a name` | The name was blank. |
| `That folder name can't be used — no slashes, and 120 characters at most.` | Change the name. |
| `A folder with that name is already here.` | Two folders in the same place cannot share a name. Deleting a folder can say this too, when a subfolder moving up would clash with one already there. |
| `Folders can be nested ten levels deep.` | The folder, or a folder being moved with its subfolders, would go past ten levels. |
| `A folder can't be moved inside itself.` | Pick a location outside the folder. |
| `That folder no longer exists.` | The folder was deleted or hidden while your page was open. Reload. |
| `This changed since you opened it — reload and try again.` | Somebody else changed the folder while your dialog was open. |
| `Email receiving isn't configured — add INBOUND_EMAIL_DOMAIN. See SETUP.md.` | Email-in is not set up for your deployment. Ask us. |
| `Owners-only files and folders can't be shared outside the business. Move it somewhere shared first, or turn off owners-only.` | An owners-only folder cannot have an address or a share link. |

## Not on this page

There is no sorting, no filter and no search on this page; use Search. Nothing selects several files at once. Dragging does not work by touch or keyboard; the menus do the same things.

## Who can do what

Everyone can browse, open files, upload, and make and rename folders. Owners alone move and delete folders, make them owners-only or visible again, and give them an email address. Accountants can browse, open and download; every other button answers `Accountant access is read-only — reviews, sign-offs and exports only.`
