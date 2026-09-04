# Everything outstanding

> Every piece of work, as a list ordered by what is due or as a board ordered by where it has got to.
> **Route:** /dashboard/m/work
> **Order:** 10

Open **Work** in the sidebar. The heading reads `Everything outstanding, across the whole business.` {button:Lists|outline} takes you to where lists are made.

**It is one set of work drawn two ways.** {button:List|secondary|list} answers what to do next. {button:Board|ghost|layout-grid} answers where everything has got to. The filters apply to both.

## What you see

- **The filter row.** The two drawings, then who it is for, which list, which state, a search box, `Views`, a finished toggle and `Clear`.
- **The add row**, always there: `What needs doing?`, a due date, a list, and {button:Add|primary}.
- **The work itself**, as a list or a board.

Everything you pick is in the address, so a filtered page can be bookmarked or sent to somebody.

## The filters

- **Who it is for.** `My work` is where you start. Then `Anyone`, `Nobody`, and each person. **`Nobody` is offered to everyone**, because asking what is going spare is a fair question.
- **Which list.** `Every list`, or one of them.
- **Which state.** `Any state`, or one of the five. **This one is missing on the board**, because the board is already arranged by state.
- **Search.** Type and press Enter, or click the magnifier. It looks at titles and notes.
- **{button:Show finished|ghost}.** Finished work is hidden on the list until you ask for it. **The board always shows it**, and hides this button, because a board with two empty columns and no explanation is worse.
- **{button:Clear|ghost|x}.** Puts everything back, keeping whichever drawing you are in.

**Two things to know about the filters.** Switching from the board to the list turns finished work back on without saying so. And the list you have filtered to does not change the list the add row will file into once the page has loaded, so **check the add row's list before adding work on a filtered page**.

## The list

Work is grouped by how soon it is due, never by state or list: `Overdue`, `Today`, `This week`, `Later`, `No date`. **A group with nothing in it is not shown**, so a quiet day looks quiet rather than broken.

A row has a tick to mark it done, the title, its due date, which list it is on, and two menus for state and who it is on. Finished work is struck through.

The list badge only appears when you are looking at more than one list.

## The board

Five columns, always all five, always in this order: `To do`, `In progress`, `Blocked`, `Done`, `Cancelled`. It scrolls sideways on a narrow screen rather than squeezing.

A card carries the same things a row does, and the same three actions.

**You move work between columns with the state menu on the card, not by dragging.** That is deliberate: dragging a card between columns that do not fit on screen has no good answer on a phone.

An empty column reads `Nothing here`.

## State and status

**`State` is the fixed set** — `To do`, `In progress`, `Blocked`, `Done`, `Cancelled` — and it is what the board is arranged by and what lets the app ask whether something is finished.

There is a second, free-text label a future add-on can set, which would show on the menu button in place of the core word. **Nothing in the product writes it today**, so you will always see the five words above.

## How to add work

1. Type into `What needs doing?`
2. Set a due date if it has one.
3. Check the `List`.
4. Press Enter or click {button:Add|primary}.

Work added while you are looking at `My work` is put on you. Work added on any other view lands **unassigned**, because a list is the pile somebody picks from.

The quick add takes a title, a date and a list. Notes, a start date and everything else are set by opening the item.

## What you can do without opening anything

Mark it done or reopen it, change its state, and change who it is on. That is all.

**Reopening something cancelled puts it back in `To do`**, not wherever it was before.

There is no delete anywhere in Work. `Cancelled` is how work leaves the list, and it keeps its history.

## How to save a view

1. Set the filters you want.
2. Open {button:Views|ghost|bookmark} and click `Save this view…`
3. Give it a `Name`, such as `Overdue on site`.
4. Set `Who can use it`: `Everyone` or `Only me`.
5. Click {button:Save|primary}.

The dialog warns that `Saving over a name you have used before replaces it.`

Saved views appear in the same menu. You can delete your own. **A saved view does not reopen whatever item you had open** when you saved it.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing is on you right now.` | Nothing is assigned to you. Change who it is for to see more. |
| `Everything has somebody on it.` | Nothing is going spare. |
| `No work matches this view.` | Your filters found nothing. Click {button:Clear|ghost|x}. |
| `Nothing here` | That board column is empty. |
| `Nothing saved yet` | No saved views. |
| `Make a list first.` | You tried to add work with no list to put it on. |
| `You do not have access to do that.` | Your role cannot do that. An accountant reaching it means a write got through from an old tab; the page itself no longer offers one. |
| `That work no longer exists, or you cannot see it.` | It has gone, or it is on a list you cannot see. |
| `Invalid input` | Usually a title over 200 characters or notes over 4,000. |
| `Something went wrong.` | Something unexpected. **It also covers a start date later than the due date**, which the message does not say. Check those two before telling us. |

## Not on this page

- Nothing is deleted, ever. Cancel it instead.
- Work cannot be moved to another list once it is made.
- You cannot change a due date from a row. Open the item.
- Due dates are shown as plain dates rather than `due tomorrow`.
- Nothing can be dragged.
- **Work with a start date in the future is hidden from `My work` entirely**, with no way to show it. Change who it is for to `Anyone` to see it.
- Sub-items and checklists are not available yet. If you see a small arrow beside a title, that is a piece of work filed under another, and there is no way to reach the other from here.
- Finished work on the board is never paged, so those two columns grow forever.
- If you need any of this, ask us.

## Who can do what

Everyone can add work, change it, assign it, and save views. What you see is decided by the lists you can see, which is set on the [Lists](lists.md) page.

**Your accountant reads this page and changes nothing on it.** A line above the filters reads `Accountant access is read-only. You can see every list, every item on it and who it is on, and nothing here can be changed.` The add row and {button:Save this view|outline} are not drawn, state and assignee show as plain text instead of dropdowns, and the item sheet opens with its fields read-only and no attach box — that last one because searching for a record to attach is refused too. Filtering, searching and switching between list and board all still work. They can also never be given work.
