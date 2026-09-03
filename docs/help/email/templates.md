# Templates

> Saved replies the whole business shares, with blanks Yosher fills in for you. Write them here, then drop one into a message you are writing.
> **Route:** /dashboard/m/email?templates=1
> **Order:** 60
> **Area:** Writing

Open **Mail** in the sidebar, then click `Templates` in the row of links along the top. The list opens in the reading pane, so your folders and messages stay beside it. Opening it closes a message you were reading and a message you were writing, and anything typed into that unsent message is gone. Click {button:New template|primary|plus} to write one. Click `Close` at the top right of the pane to go back to your mail.

## What you see

- **The sharing note.** At the top of the pane, whatever you are doing: `Templates are shared with everyone in the business, so a reply somebody writes once can be used by all of you. They are stored in Yosher rather than on the mail server, which means they do not appear on your phone or in Outlook.`
- **The list.** Every template the business has, sorted by name. Capitals and extra spaces are ignored in that sort.
- **A row.** The template's name on the first line. Its subject underneath, when it has one. Click the name to open it and change it.
- **{icon:trash} on a row.** Deletes that template the moment you click it. Nothing asks you to confirm, and the template goes for everyone in the business.
- **{button:New template|primary|plus}.** Under the list. Opens an empty template for you to fill in.
- **`Close`.** Top right of the pane. Takes you back to the folder you were in.

While you have a template open, the list is hidden and the fields below take its place.

## How to write a template

1. Click {button:New template|primary|plus}.
2. Type a `Name`, such as `Payment terms`. Up to 80 characters. The name is what you read when you pick a template later, so make it say what the reply is for. Two templates cannot share a name.
3. Fill in `Subject (optional)` if the template should suggest one. Up to 200 characters. It is used only when the message has no subject yet: `Only used when the message has no subject yet, so applying a template to a reply never changes it.` Leave it empty and the template never touches the subject.
4. Write the reply in the big box below. It is the same editor you write messages in, with the same font, size, color, list, align, quote, link and emoji controls. Up to 20,000 characters.
5. Click {button:Save template|primary|save}. You see `Template saved.` and your template back in the list.

Click {button:Cancel|outline} instead and the pane goes back to the list. Anything you typed is thrown away, with nothing asking you to confirm.

There is no picture button in this editor, and a picture you paste in is dropped when you save. A picture belongs to one message, so it cannot be stored in a reply meant for many.

## How to leave a blank for Yosher to fill in

Open `Fill-in-the-blanks you can use` under the body. It lists every blank you may type, and only those. Type one anywhere in the body or in the subject. Yosher fills it in when you insert the template, so you read the finished words before you send.

These fill themselves from the message you are writing, with no question asked:

- `{{recipient.name}}` is the name on the first `To` address. When that address carries no name, you get the part before the `@`.
- `{{recipient.first_name}}` is the first word of that name.
- `{{recipient.email}}` is the first `To` address.
- `{{me.name}}` and `{{me.email}}` are the name and address you are sending from. On a shared mailbox that is the shared address.
- `{{business.name}}` is your business's name in Yosher, and `{{date.today}}` is the date you insert the template.

These come off a record, and only when the module that owns it is switched on. Using one costs you a step: you say which record when you insert the template.

- Accounting, under `From a invoice`: `{{invoice.number}}`, `{{invoice.total}}`, `{{invoice.status}}`, `{{invoice.due_date}}` and `{{invoice.customer_name}}`. A total reads `$1,234.56`, a status reads the invoice's own word such as `issued`, and a due date reads `2026-08-31`. An invoice with no due date leaves `{{invoice.due_date}}` showing, for you to type over.
- Accounting, under `From a customer`: `{{customer.name}}` and `{{customer.email}}`. A customer with no address leaves `{{customer.email}}` showing, for you to type over.
- CRM, under `From a contact`: `{{contact.name}}`, `{{contact.first_name}}` and `{{contact.last_name}}`.
- CRM, under `From a company`: `{{company.name}}` and `{{company.legal_name}}`.
- CRM, under `From a deal`: `{{deal.title}}`, `{{deal.amount}}`, `{{deal.stage}}` and `{{deal.party_name}}`.

Bills, vendors, files and folders have no blanks. Neither do CRM's own custom fields.

Type the blank in one go and leave the formatting alone in the middle of it. Bolding half of one breaks it, and Yosher refuses to save it.

## How to use a template while writing

1. Start a message. See [Writing a message](compose.md).
2. Click {button:Template|outline|file-text} in the row along the bottom, next to Send. Hovering it reads `Insert a saved reply`. The button is missing altogether when the business has no templates.
3. Pick a template from the list that opens above it. Names are in the same order as this page, with each subject underneath.
4. If the template names a record, Yosher asks first: `This template needs an Invoice. Search for the one this message is about.` The box under it reads `Search Invoices…`. Type a few words, wait for `Searching…` to pass, and click the record you meant. You get up to ten matches, each with a line of detail under it.
5. The reply goes in at your cursor, so what you have already written stays. The subject is filled only when the subject box is empty. In plain text mode the reply is added on a new line at the end instead.
6. Blanks about the person you are writing to read the `To` line as it stands right then. Type the address first and the greeting fills itself. Insert first and you see the blank.

If the conversation you are replying to is already attached to exactly one record of that kind, you are not asked. Yosher uses it and names it: `Filled in from Invoice INV-1042.` Attached to two of them, it asks anyway. A message you start from scratch has no conversation, so it always asks. See [Attaching an email to your records](records.md).

To skip the question, press {kbd:Escape} or click `Insert without filling it in`. The template still goes in, with the blanks showing as they were typed.

Type over any blank still showing before you send. Yosher refuses to send a message whose body has one left in it, and your draft stays open until you fix it. Only the body is checked, so read the subject line yourself before you send.

## How to change or delete a template

1. Click the template's name in the list. The fields open with what it holds now.
2. Change what you need and click {button:Save template|primary|save}. You see `Template saved.`
3. To delete one, click {icon:trash} on its row. It goes at once, with no confirmation and no way back. You see `Deleted "Payment terms".`

Anyone in the business can change or delete any template, including one a colleague wrote.

## Messages

| Message | What it means |
| --- | --- |
| `No templates yet. Save the reply you find yourself writing over and over.` | Nobody has written one. Click {button:New template|primary|plus}. |
| `Template saved.` | The template is stored and is in the list. |
| `Give the template a name.` | The `Name` box holds nothing but spaces. |
| `The template is empty. Write the message it should insert.` | The body has no words in it. A body of only blank lines counts as empty. |
| `Yosher doesn't know {{cusotmer}}.` followed by every blank you may use | You typed a blank that is not on the list, or one belonging to a module your business does not have. Copy the right one from `Fill-in-the-blanks you can use`. |
| `{{recipient.name}} has formatting inside it, so it can't be filled in. Delete it and type it again without changing the formatting part-way through.` | The formatting changes part-way through the blank, so Yosher cannot match it. Delete it and retype it in one go. |
| `A template called "Payment terms" already exists. Pick another name, or edit that one.` | Names have to be different. Capitals and extra spaces do not count as a difference. |
| `Deleted "Payment terms".` | The template is gone for everyone. |
| `That template no longer exists.` | Somebody else deleted it while your page was open. Click `Close` and open `Templates` again. |
| `Invalid input` | The `Name` box is empty, or the reply is longer than 20,000 characters. `Name` and `Subject (optional)` stop you typing past their own limits, so a long body is the usual cause. |
| `Nothing matching. You can insert the template anyway and fill it in by hand.` | No record matched what you typed in the record box. Try fewer words, or click `Insert without filling it in`. |
| `Filled in from this conversation's record.` | The record came from the conversation and Yosher could not name it. Read the filled-in words before you send. |
| `{{recipient.name}} still needs filling in.` | One blank could not be filled. It is showing in the message. Type over it. |
| `3 placeholders still need filling in.` | More than one blank could not be filled. All of them are showing in the message. |
| `This message still has {{recipient.name}} in it. Fill those in before sending — a template was inserted before there was anything to fill them from.` | Nothing was sent. Replace the blanks the message names, then send again. A blank inside the quoted reply underneath does not count. |
| `Accountant access is read-only — reviews, sign-offs and exports only.` | You are signed in as the outside accountant, who has no mail. |
| `Something went wrong. Please try again.` | The save or the delete did not go through. Try it again. |

## Not on this page

A template that names two kinds of record only asks about the first one. The second kind's blanks go in unfilled, and the message is then refused when you send it. Fill those in by hand, or write one template per record.

A template written while a module was on keeps its blanks after the module is switched off. You are not asked which record, no message warns you, and the send is refused. Delete those blanks by hand.

A blank you spell wrong in `Subject (optional)` is never checked. It saves, nothing fills it, and it reaches your customer exactly as you typed it. Read the subject before you send.

`Templates` is missing from the top of the screen on a phone, so the list can only be reached on a wider screen.

There are no folders or categories, no search box and no sort control. Nothing duplicates a template or previews one. A template cannot be kept private to you, cannot carry a file or a picture, and cannot be used from your phone or Outlook. Ask us if you need one of these.

Three near neighbors are set up elsewhere. The rest of the writing pane is in [Writing a message](compose.md), the sign-off that goes on every message is in [Your signature](signature.md), and pinning a conversation to an invoice or a customer is in [Attaching an email to your records](records.md).

## Who can do what

Owners and staff can do everything on this page, and both can change and delete a template anyone wrote. A shared mailbox changes nothing here, because a template belongs to the business rather than to a mailbox. Accountants have no access to Mail at all.
