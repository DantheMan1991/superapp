# Filters and saved views

> Narrow the CRM list to the records you want, then keep that filter as a view you can open again or share with the team.
> **Route:** /dashboard/m/crm
> **Order:** 20
> **Area:** Records

Open **CRM** in the sidebar. Two controls sit above the search box: the view picker on the left, and {button:Filter|outline|filter} beside it. Click {button:Filter|outline|filter} to build a filter one line at a time, then click {button:Apply|primary}. Once the list is showing what you want, click {button:Save as view|ghost|save} to keep it. The list itself, the search box and the four buttons beside it are in [Your records](records.md).

## What you see

- **The view picker.** The button at the far left, labeled with the view you are in, such as `All records`. Click it to see every view you can open, then click a name to switch to it.
- **A `*` after the name.** It means the filter on screen is no longer the view's own filter. You added, changed or removed a line since it opened. Nothing is kept until you save it.
- **The four built-in views.** They come first in the list, in this order, and nobody can rename or delete them.
  - `All records` shows everyone, in name order.
  - `Assigned to me` shows the records that carry your name, in name order.
  - `Added recently` shows what was added in the last 30 days, newest first. It is the only built-in that is not in name order.
  - `Companies` shows companies only, in name order.
- **Your views and the shared ones.** They follow the built-ins, all together, in A to Z order by name. You see the views you made plus every view a colleague chose to share. Nothing in the list tells you which is which. The clue is that `Delete this view` only appears on a view you made.
- **A pin mark and a check mark.** In the list, a pin sits beside the view that opens by default for you, and {icon:check} beside the one you have open now.
- **{button:Filter|outline|filter}.** Opens and closes the filter panel. When at least one line is applied, a count sits on the button, such as {badge:2|secondary}.
- **{button:Save as view|ghost|save}.** Appears only while the `*` is showing. It opens the `Save this view` box.
- **{button:Update|ghost}.** Appears beside it, also only while the `*` is showing, and only on a view you made yourself. The label carries that view's own name.
- **The filter panel.** Opens under the row. With nothing in it, it reads `No filters. The list is showing everything you can see.`
- **A filter line.** Three controls and a remove button: the field, the test, and the value. Click {button:Remove filter|ghost|x} at the end of a line to drop it.
- **`Records must match all of these.`** Appears in the panel as soon as you have two lines. A record has to pass every one of them.
- **The plain sentence under the search box.** It reads back the filter that actually ran, such as `Type is Company · Added in the last 30 days`. With nothing filtered it reads `All records`. It never mentions the search box or the four buttons beside it.

## How to narrow the list

1. Click {button:Filter|outline|filter}. The panel opens with the filter that is already applied.
2. Click {button:Add filter|outline|plus}. A line appears reading `Name` `contains` and an empty box, with `Enter a value` under it in red.
3. Pick the field from the first control. Changing the field resets the test and the value, because a test that suited a date is nonsense for a name. `Type` and `Visibility` land on their first choice. Every other field is left blank.
4. Pick the test from the second control. Only the tests that suit the field are offered.
5. Fill in the value with the third control.
6. Click {button:Add filter|outline|plus} again for another line, up to ten. At ten the button turns gray.
7. Click {button:Apply|primary}. The panel closes, the list redraws and you go back to page 1. Your search text and the four buttons beside the search box stay exactly as they were. {button:Apply|primary} stays gray while any line is showing a red message.
8. Click {button:Clear all|ghost} to empty the panel and close it. It shows only while the panel has a line in it. The list goes back to the view's own filter, which is everything only on `All records`. Your search text and the four buttons are untouched.
9. To throw away a half-built filter, click {button:Filter|outline|filter} again. The panel refills from what is applied the next time you open it.

These are the eight fields you can filter on, and there are no others.

| Field | What it looks at | Tests offered | What you put in |
| --- | --- | --- | --- |
| `Name` | the name on the record | `is`, `is not`, `contains`, `does not contain`, `starts with` | Type it into the box marked `Value` |
| `Type` | person or company | `is`, `is not` | Pick `Person` or `Company` |
| `Active` | whether the record is archived | `is` only | Pick `Yes` or `No` |
| `Added` | the day the record was created | `before`, `after`, `on or before`, `on or after` | Pick a window, or a day |
| `Stage` | the stage on the record | the same five as `Name` | Type it into the box |
| `Source` | where they came from | the same five as `Name` | Type it into the box |
| `Assigned to` | who the record belongs to | the same five as `Name` | Type a sign-in id |
| `Visibility` | whether the record is restricted | `is`, `is not` | Pick `Everyone` or `Restricted` |

`Added` has no `is` test, because it holds a time of day as well as a date and nothing ever matches an instant exactly. Its value control offers `the last day`, `the last 7 days`, `the last 30 days`, `the last 90 days` and `a date…`. The four windows are counted back from right now in 24 hour blocks, so a view built on one never goes stale. Pick `a date…` and a date box appears beside it. The line reads `Not a date` until you fill it in.

Every picker also offers `Choose…`, which is not an answer. Pick it on `Type` or `Visibility` and the line reads `Not one of the choices` until you pick something real. A line you have switched to `Active` starts there too.

A typed value can be 200 characters. Nothing counts them for you. Go past 200 and the line reads `Value is too long`.

`Assigned to` has no list of people to pick from. You have to type the person's sign-in id by hand, which looks like `user_2ab…`. To find your own, open `Assigned to me` in the picker and read the id out of the sentence under the search box.

A line reading `Active` `is` `No` shows nothing on its own. The list leaves archived records out until you turn on `Archived` beside the search box, so turn that on too and you get the archived records only.

Click `Next` under the list and only the first line of your filter is carried over. With two or more lines, narrow the filter further rather than paging.

## How to save the filter you built

1. With the `*` showing, click {button:Save as view|ghost|save}.
2. The box is headed `Save this view`. Under that, the number it matches right now, such as `137 records match right now.` That counts every page, not only the one you are on.
3. Type a `Name`, such as `Chasing this quarter`. Up to 60 characters. {button:Save view|primary} stays gray until you type something.
4. Turn on `Share with the team` to let everybody see it. The note under it reads `Everyone sees the same filter, but still only the records they have access to.` Leave it off and the view is yours alone, invisible to everybody else.
5. Click {button:Save view|primary}. It reads `Saving…` while it works, then you see `View saved` and the box closes. {button:Cancel|ghost} closes the box and saves nothing.
6. The new view also becomes the one that opens by default for you. You do not have to pin it.
7. The picker keeps showing the view you started from, with its `*`, unless that was `All records`. Click the new name in the list to work in it.

Sharing a view shares the question, not the records. Two people opening the same shared view can get different lists, because each one is worked out for the person reading it. A shared view can never show somebody a record they could not already open.

## How to update a view you made

1. Open the view, change the filter and click {button:Apply|primary}. The `*` appears.
2. Click {button:Update|ghost}, which carries the view's name after it. You see `View updated` and the `*` goes.
3. Only the filter is written. The name and the sharing setting cannot be changed once a view is made.
4. A view a colleague made shows no update button, even when it is shared with you. Click {button:Save as view|ghost|save} and keep your own copy instead.

## How to choose the view that opens first

1. Open the view you want.
2. Click the picker, then `Open this one by default`. It pins the view you have open, not the one you are pointing at in the list.
3. You see `This view opens by default now` and the pin mark moves to it.
4. Open CRM from the sidebar and that view opens.
5. The choice is yours alone. Nobody else's default changes, not even on a shared view.
6. If the view you pinned is later deleted, CRM opens on `All records` rather than failing.

## How to delete a view

1. Open the view. `Delete this view` appears in the picker only for a view you made yourself.
2. Click it. There is no confirmation and no undo.
3. You see `View deleted`, the picker switches to `All records` and the page redraws.
4. A shared view you delete goes for everybody who could see it. Anybody who had it as their default lands on `All records` from then on.

## How to send a filtered list to a colleague

1. Build the filter and click {button:Apply|primary}. Everything on screen is written into the address bar: the view, every filter line, your search text, the four buttons and, once you page, the page number.
2. Copy the address out of your browser and send it. Nothing has to be saved as a view first.
3. They get the same filter run against the records they are allowed to see, so their list can be shorter than yours.
4. A filter line the address does not understand is thrown away without a word, and so is a view it does not recognize. The list is then wider than you meant, never narrower. Read the sentence under the search box, which always says what actually ran.

## Messages

| Message | What it means |
| --- | --- |
| `No filters. The list is showing everything you can see.` | The panel is empty. Click {button:Add filter|outline|plus} to start a line. |
| `Enter a value` | The box is empty. Type something. An empty box is not read as "has nothing in it". |
| `Value is too long` | Over 200 characters. Shorten it. |
| `Not one of the choices` | The picker is still on `Choose…`. Pick a real answer. |
| `Must be true or false` | Pick `Yes` or `No`. You see this the moment you switch a line to `Active`. |
| `Not a date` | The date box is empty, or the day does not exist. Pick a day, or pick one of the four windows. |
| `starts with does not apply to Added` | That test does not suit that field. Pick another test. The wording names both. |
| `You already have a view with that name.` | Two of your own views cannot share a name. Pick another. A colleague may still have a view called the same thing. |
| `Only the person who made a view can change it.` | The view is no longer there. Somebody deleted it while your page was open. Reload. |
| `Invalid input` | Something did not fit, most often a name over 60 characters. Nothing says which. Shorten it and try again. |
| `Accountant access to this module is read-only.` | You are signed in as the outside accountant. Nothing was saved. |
| `Something went wrong. Please try again.` | Nothing was saved. Try again. |

## Not on this page

There is no sort control anywhere on this screen. The order comes from the view you are in. Every view is in name order except `Added recently`, and a view you save while that one is open keeps its newest-first order. There are no column headers to click, because the list has no columns, and a view cannot choose what a row shows. Two lines are always joined by "and", so you cannot ask for one thing or the other. Your own fields cannot be filtered, sorted or searched, and neither can the `Customer`, `Vendor` or `Restricted` marks on a row. A view cannot be renamed, shared or made private again after it is saved, so save it under the right name. An owner cannot remove a colleague's shared view from here, so ask us when somebody leaves. Nothing selects several records at once and nothing exports a view. Reports that count and group records are in [Reports](reports.md).

## Who can do what

Owners and staff get exactly the same controls here. Everyone can build a filter, save a view, share it, pin one as their default and delete their own. Your private views are yours alone and nobody else sees them in the picker. `Visibility` `is` `Restricted` only answers for an owner, because the CRM side of a restricted record never reaches staff, so a staff member filtering on it gets an empty list. The outside accountant can filter, page and read every shared view, but saving, updating, pinning and deleting all answer `Accountant access to this module is read-only.`
