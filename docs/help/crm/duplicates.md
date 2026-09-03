# Duplicates

> Pairs of records that look like the same business or person entered twice, and the tool that joins two of them into one.
> **Route:** /dashboard/m/crm/duplicates
> **Order:** 150
> **Area:** Duplicates

Open **Duplicates** in the CRM menu. Yosher compares your records and lists the pairs that look like one business or person entered twice. Nothing is joined until you say so. Click {button:Review|outline} on a pair, choose which of the two records you keep, then click {button:Merge|primary}. Only owners see this page, because a merge cannot be undone.

## What you see

- **The heading.** `Duplicates`, and under it `Records that look like the same business or person. Nothing is merged until you choose which one to keep.`
- **The CRM menu.** `Records`, `Follow-ups`, `Board`, `Pipelines`, `Fields`, `Reports`, `Automations` and `Duplicates`. Click any of them to move around the module.
- **The list.** One row for each pair, strongest match at the top. It is all on one page. There are no page buttons and no sorting.
- **The two names.** The first record's name, the word `and` in gray, then the second record's name. Neither name is a link, and nothing on the row tells you which kind of record either one is.
- **The reason line.** Small gray text under the names, saying why the pair is here. `both use accounts@probe.example` for a shared email address, `both use 555 0100` for a shared phone number, and `same name`. A pair matching two ways shows both reasons with a dot between them. A shared number is shown as it was typed on the record, not tidied up.
- **{button:Review|outline}.** At the right of each row. It opens the merge dialog. Opening it changes nothing.
- **The empty state.** With no pairs found you get `No likely duplicates. Records are compared on shared email addresses and phone numbers, and on identical names.`
- **Nothing updates on its own.** The list is worked out fresh each time the page loads. Reload to look again after you have added records.

## How to read the list

1. A pair is here because the two records share an email address, share a phone number, or have exactly the same name. Those three checks are the only ones run.
2. Email addresses match whatever the capitals, so `Bob@Probe.example` and `bob@probe.example` are one address.
3. Phone numbers match on their digits, so brackets, spaces and dashes make no difference. A country code in front of one number and not the other means the two do not match. A `+` typed on one number and not the other stops the match as well.
4. Names match once capitals and extra spaces are ignored, and nothing else is ignored. `Probe Ltd` and `Probe Inc` are never paired, and neither are `Probe` and `Probe Construction`.
5. Website addresses are never compared. Two records sharing only a website are not offered here.
6. The strongest pairs come first. A shared email address counts for most, a shared phone number next, the same name least. A shared phone number is often a switchboard rather than a duplicate, and two businesses can honestly share a trading name.
7. The reasons add up. A shared email address and the same name outranks a shared email address on its own. A shared phone number and the same name still sits below a shared email address.
8. Two shared email addresses count once, not twice. Both are still on the reason line, because sharing two addresses is a stronger story than sharing one.
9. Pairs that match equally strongly keep the same order every time the page loads.
10. At most 50 pairs are listed, and each of the two checks stops after 500 matches. Nothing on screen says it stopped. Work through the top of the list, merge what belongs together, then reload to see what was behind it.

## How to compare the two records

1. This page gives you two names and the detail they share. It does not show the type, the stage, who the record is assigned to, or any other contact detail.
2. Open [Records](/dashboard/m/crm) in a second browser tab and search for the name.
3. Read both records before you decide. What one record holds is in [One record](record.md).
4. Come back to this tab and click {button:Review|outline} once you know which one you are keeping.

## How to merge two records

1. Click {button:Review|outline} on the pair. The dialog `Merge these records` opens, and under the title it reads `One record is kept and the other is removed. This cannot be undone.`
2. Under `Which one do you keep?` sit two buttons, one per record name. The first one is picked for you and carries {badge:keep|primary}. That pick is not a recommendation, only the order the two arrived in. Click the other name to keep that one instead.
3. You see `Working out what moves…` while Yosher works out what the merge would do. Change your pick and it works it out again, because the answer is different each way round.
4. Read the panel that appears. Its first line is the name of the record that goes, an arrow, then in bold the name of the record you keep.
5. When money records would move you get an amber box with a warning triangle, reading for example `2 invoices, 1 bill will be moved onto the customer or supplier record you are keeping. Totals and the ledger are unchanged.`
6. The next line lists everything else, such as `Moving 3 deals, 2 follow-ups, 1 person with access.` With nothing else to carry across it reads `Nothing else to move.`
7. `Notes from both records are kept, one after the other.` appears when both records have been used in the CRM. You get this line even when neither record has a word of notes on it.
8. `4 duplicate details already on the record you are keeping will not be copied again.` appears when something on the record that goes is already on the record you keep. A connection between the two records is counted there as well.
9. Click {button:Merge|primary}. It reads `Merging…` while it runs. You see `Records merged`, the dialog closes, and the list comes back without that pair.
10. Click {button:Cancel|ghost} to close with nothing changed. The {icon:x} at the top right of the dialog, {kbd:Esc}, and clicking outside the dialog all do the same. {button:Cancel|ghost} is grayed out while a merge is running.

Two counts in that panel are spelled wrong for more than one. You get `2 timeline entrys` and `2 recurring entrys`. The wording is a slip on our side and the numbers themselves are right.

The plan is worked out again at the moment you click {button:Merge|primary}, from the records as they stand then. A record somebody edited while your dialog was open is merged as it is, not as it was. Here is where everything ends up.

| What | Where it ends up |
| --- | --- |
| Notes | Both are kept. The notes on the record you keep come first, then a line reading `--- merged from a duplicate record ---`, then the other record's notes. Two identical notes are not written out twice. |
| Stage, source, and who the record is assigned to | The values on the record you keep. One left blank there is filled from the other record. |
| Who can see it | The stricter of the two wins. If either record was restricted, so is the merged one. A merge can never widen who can see a record. |
| Your own fields | The answers on the record you keep stand. Any it left blank are filled from the other record. `No` and `0` count as answers, not blanks. Answers against a field you have archived are kept from both sides. |
| Person or company | Whatever the record you keep is. Merging a person into a company is allowed and nothing warns you. |
| Contact details | They move across with their labels. One the kept record already has is dropped. An arriving email or phone loses its {badge:Main|secondary} mark when the kept record already has a main one of that kind, and the panel does not mention that. |
| Connections | They move across. One that would point the merged record at itself goes. One the kept record already has, still running, goes. A connection with an end date is history and is kept. A moved one can quietly lose its {badge:Primary|secondary} mark. |
| Deals and deal contacts | They move across, both where the record is the deal's own and where it is named on the deal. A deal contact for a deal the kept record is already on is dropped. |
| Timeline entries and follow-ups | They move across, and every follow-up points at the merged record afterwards. |
| People with access | Their access moves across, so nobody loses access. Somebody who already had access to the kept record keeps the one they had. |
| Filed emails | Conversations filed against the record that goes move onto the one you keep. A conversation filed against both stays filed once. |
| Invoices, bills and recurring entries | When only one of the two is a customer or a supplier, that whole side moves and no posted record is touched. When both are, the invoices, bills and recurring entries move onto the surviving customer or supplier and the emptied one goes. Totals, the ledger, and every document filed against an invoice or bill are unchanged. |

The record you did not keep is deleted. Its page stops working, and any link anybody saved to it is dead.

## Messages

| Message | What it means |
| --- | --- |
| `No likely duplicates. Records are compared on shared email addresses and phone numbers, and on identical names.` | Nothing in your records looks like a duplicate on those three checks. |
| `Working out what moves…` | The dialog is asking what the merge would do. {button:Merge|primary} stays gray until the answer comes back. |
| `Records merged` | It worked. The two records are one, and the list is worked out again without that pair. |
| `That record could not be found.` | One of the two records was merged or removed while your dialog was open. Close the dialog and reload the page. |
| `Something went wrong. Please try again.` | Nothing was changed. If it happened on {button:Merge|primary} the dialog stays open with your choice. If no summary panel ever appeared, {button:Merge|primary} stays gray on purpose, so close the dialog and open it again. |
| `You do not have permission to do that.` | You are not an owner. Ask an owner to do the merge. |
| `Accountant access to this module is read-only.` | You are signed in as the outside accountant. |

## Not on this page

Nothing marks a pair as not a duplicate. Two real businesses with the same trading name come back to the top of this list every time you open it, and there is no way to hide them. Ask us if you need that. Nothing undoes a merge, here or anywhere else in Yosher, and there is no list of merges you have done. Neither name on a row is a link and nothing shows either record's details, so you cannot compare the two from here. There is no match percentage and no score. Nothing merges three records at once, so do two and then review the result against the third. There are no page buttons and no way to look past the top 50 pairs. Nothing on this page ever merges anything on its own.

## Who can do what

Only owners see this page and only owners can merge. Staff and the outside accountant get a {icon:lock} panel headed `Owners only`, reading `Merging moves invoices and bills onto one customer and cannot be undone, so it is kept to the people who own the books.` They get no list and no way to merge. The merge is kept to owners for one reason above the rest: an owner can see everyone who has been given access to a restricted record, so a merge run by an owner carries that access across instead of quietly dropping it.
