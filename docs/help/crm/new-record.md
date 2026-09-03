# Add a record

> Add a company or a person to the CRM: the type, the names, the stage, where they came from, your notes, your own fields, and the owners-only switch.
> **Route:** /dashboard/m/crm/records/new
> **Order:** 30
> **Area:** Records

Click {button:Add a record|primary} at the top right of the records list to get here. This page adds a company or a person the business does not have yet. Check they are not here already before you fill anything in. Then fill in the form and click {button:Add record|primary}, and you land on the new record's own page.

## What you see

- **{icon:chevron-left} `All records`.** The link above the title. Click it to go back to the records list. Nothing you have typed is saved. What that list can do is in [Your records](records.md).
- **The title `Add a record`.** Under it, a line reminding you to search first, because anyone Accounting has already invoiced or paid is here.
- **The row of tabs.** `Records`, `Follow-ups`, `Board`, `Pipelines`, `Fields`, `Reports`, `Automations` and `Duplicates`. None of them is highlighted while you are adding a record. Click one and you leave this page, and what you typed is gone.
- **`Type`.** A menu holding `Company` and `Person`, and it starts on `Company`. Pick `Person` to change two of the labels and add a row of name boxes.
- **`Name`, called `Display name` for a person.** What the business gets called everywhere in the app. The box reads `Their business name` for a company and `Built from the names below` for a person. Up to 200 characters. Repeated spaces are collapsed and the ends trimmed when you save.
- **`First name` and `Last name`.** Only for a person. Up to 100 characters each. Leave `Display name` empty and the two are joined with a space to make it.
- **`Legal name`, called `Formal name` for a person.** The registered name when it is not the one you use day to day. The company box reads `Registered name, if different`. Up to 200 characters. Left empty, nothing is stored.
- **`Stage`.** Where they stand with you, in your own words. The box reads `Lead, active, dormant…`. Up to 60 characters. There is no list to choose from, so agree on your words and spell them the same way every time. A saved view looking for `Stage` `is` `Lead` will not find a record you typed as `lead`.
- **`Where they came from`.** How you got them. The box reads `Referral, website, walk-in…`. Up to 60 characters.
- **`Notes`.** A five line box for anything worth remembering. Up to 4,000 characters, stored exactly as you type it.
- **`Your fields`.** A bordered block holding the fields your business set up for records. It only appears when there is at least one. To its right it reads `Set up under Fields in this module.`
- **`Restrict this record`.** A switch owners see and staff do not. It starts off.
- **{button:Add record|primary}.** Saves the record. A spinner appears in front of the label while it saves.
- **{button:Cancel|ghost}.** Goes back to the records list and saves nothing. Both buttons gray out while a save is running.

## How to check they are not here already

Everyone you have invoiced or paid through Accounting is a record already, whether or not the CRM has ever been asked about them. Adding them again gives you two of the same business.

1. Click {icon:chevron-left} `All records`.
2. Type their name in the box that reads `Search by name` and press {kbd:Enter}. It looks at the name you use for them and at the registered name, and at nothing else.
3. Click `Archived` above the list as well, so records somebody has archived are included. Leave it off and they stay hidden.
4. You see `Nothing matches that` when there is nobody. Come back here and add them.
5. Found them? A line reading `Not worked in CRM yet` under the name in the list means nobody has given them a stage yet, usually because Accounting created them and the CRM has never been asked about them. Click the row to open their page.
6. Click {button:Add to CRM|outline} on their page. You see `Added to CRM` and the stage, notes and the rest are yours to fill in. Do not add a second record for them.

## How to add a company

1. Leave `Type` on `Company`.
2. Type the name you use for them in `Name`. This is the only thing a company must have.
3. Fill in `Legal name` when the registered name differs from the one you use.
4. Fill in `Stage` and `Where they came from` if you know them. Both can wait.
5. Add anything worth remembering in `Notes`.
6. Click {button:Add record|primary}. You see `Record added` and the new record opens.

## How to add a person

1. Set `Type` to `Person`. `First name` and `Last name` appear, and `Legal name` becomes `Formal name`.
2. Type `First name` and `Last name`, and leave `Display name` empty. The two are joined with a space to make it, so `Sam` and `Ellis` becomes `Sam Ellis`.
3. Type `Display name` yourself when they go by something else. What you type wins, and editing the first or last name later never changes it back.
4. Fill in `Formal name`, `Stage`, `Where they came from` and `Notes` the same way as for a company.
5. Click {button:Add record|primary}. You see `Record added`. A person needs at least one of `Display name`, `First name` and `Last name`, so all three empty stops you with `Give the record a name`.

## How to fill in your own fields

1. Look at the `Your fields` block. Fields sit two to a row in the order set on the Fields page, and a field that takes several choices takes a whole row.
2. Fill in what you know. A text field takes up to 2,000 characters. A number field takes whole numbers, decimals and negative numbers, and has small up and down arrows to step the figure. Zero is an answer, not a blank. Letters cannot be typed into it. A date field takes a real day. A yes or no field is a switch, and one you never touch stores nothing at all. Turn it on and back off to store a real no.
3. A one-choice field is a menu that starts on `Not set`. Pick `Not set` again to clear it.
4. A several-choice field is a row of pills. Click one to turn it on, click it again to turn it off. Turn them all off and nothing is stored.
5. A link field takes a full web address. The box reads `https://` and takes up to 2,000 characters.
6. Read the gray line under a control for whatever the person who made the field wrote there.
7. A field marked {badge:needed to change stage|outline} is not needed here. You can save without it. It is asked for later, when you move that record to another stage.

## How to keep a record away from staff

Only owners see this switch.

1. Turn on `Restrict this record`. It reads `Only owners see the stage, notes and connections. The name stays visible to staff, who can already see it in Accounting.`
2. Click {button:Add record|primary}.
3. Staff still see the name in the records list and in Accounting. What they do not see is the stage, where they came from, the notes, your own fields, the connections to other records, any deal on it and everything on its timeline.
4. On the records list the record reads `Not worked in CRM yet` to staff, exactly like a record nobody has touched yet, so a restricted record does not announce itself.
5. To let one person in later, give them access on the record itself. That is in [One record](record.md).

## How to save the record

1. Click {button:Add record|primary}. A spinner appears in the button and both buttons gray out.
2. You see `Record added` and the new record opens. You do not go back to the list.
3. Any rule set up for a new record runs at that moment. The record can arrive with a follow-up already raised, its stage already set, or somebody already assigned to it. Rules are in [Rules that run by themselves](automations.md).
4. A rule that is broken is skipped and your record is still added, so a rule can never cost you the record.
5. To leave without saving, click {button:Cancel|ghost}. You go back to the records list and nothing is kept.

## Messages

| Message | What it means |
| --- | --- |
| `Give the record a name` | Nothing was named. A company needs `Name`. A person needs `Display name`, `First name` or `Last name`. Nothing was sent. |
| `Invalid input` | One of your boxes is over its limit. Nothing tells you which one, and there is no counter, so shorten the longest thing you typed and try again. |
| `3 fields need attention.` | Something under `Your fields` was refused. Each one also gets a red line under its own control. With one field it reads `1 field need attention.` |
| `Must be a number.` | A number field holds something that is not a number. |
| `Must be a date.` | A date field holds something that is not a day at all. |
| `That date does not exist.` | A date field holds a day that is not in that month, such as the 31st of February. |
| `Must be 2000 characters or fewer.` | A text or link field is too long. |
| `Must be a full link, starting http:// or https://.` | A link field needs a whole web address. |
| `Only http:// and https:// links are allowed.` | A link field will take a web address and nothing else. |
| `Not one of the choices.` | Somebody changed that field's choices while your form was open. Reload and pick again. |
| `Accountant access to this module is read-only.` | You are signed in as the outside accountant. You can open this form and fill it in, and this is the answer when you click {button:Add record|primary}. |
| `Something went wrong. Please try again.` | Something unexpected. Nothing was saved. Try again. |

A red message under one of your own fields clears as soon as you change that field.

## Not on this page

There is no email, phone, website or address on this form. Add them on the record once it is saved, which is in [One record](record.md). Nothing here checks whether you already have this company under a slightly different name, so search the records list first and use [Duplicates](duplicates.md) if you end up with two. Changing anything you typed here afterwards is in [One record](record.md), and setting up the fields in `Your fields` is in [Your own fields](fields.md). The `Stage` box is your own word for the record and has nothing to do with the stages on the deal board. There is no keyboard shortcut that saves, so use {button:Add record|primary}. Nothing is kept while you type, so leaving the page loses the form.

## Who can do what

Owners and staff both get this form and both can add a record. Only an owner sees `Restrict this record`, and only an owner can restrict one. The outside accountant can open the form and type into it, and the save answers `Accountant access to this module is read-only.` Anybody whose business does not have CRM turned on cannot reach this page at all.
