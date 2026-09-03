# Connecting your mailbox

> How an address on your company domain becomes mail you can read here: connecting it, reconnecting it when the permission runs out, and disconnecting it again.
> **Route:** /dashboard/m/email?setup=1
> **Order:** 120
> **Area:** Setting up

Open **Mail** in the sidebar. Until you connect an address, this page is as far as Mail goes. Find your address in the list and click {button:Connect|outline}, then approve it at your own mail server. Owners make the addresses themselves in [Email setup](../settings/email-setup.md). Once a mailbox is connected, Mail opens straight into the reader, so type `/dashboard/m/email?setup=1` in your browser's address bar to come back to this page.

## What you see

- **`Mail`**, with `Your business mailbox, beside the work it's about.` under it. Click {icon:circle-question-mark} at the right for this guide.
- **One card at a time.** You get whichever of the four below fits how far your business has got. Only the last one has buttons on it.
- **`Reading mail isn't switched on yet`.** Reading mail is not turned on for your business at all. The card reads `This business's mail server hasn't been connected to Yosher. Nothing is wrong with your mailbox — it keeps receiving mail exactly as it does today, and you can still read it on your phone or in Outlook.` and `Your administrator sets this up once, for everyone.` Nothing on it is clickable. Ask us.
- **`No mailboxes yet`.** Your business has no addresses on its own domain. The card reads `Mail reads the addresses on your own domain. This business doesn't have any set up yet.` An owner also gets a link, `Email setup`, straight to [Email setup](/dashboard/email). Everyone else reads `The business owner creates these. Ask them for an address on the company domain, and it will appear here.`
- **`No mailbox for you yet`.** The card reads `This business has mailboxes, but none of them is yours and none is shared with everyone.` and `Ask the business owner for an address on the company domain.` Read it as addresses that are not ready. No address is ever handed to one person, so what you are seeing is a set that is still being made, or that the mail host turned down.
- **`Your mailboxes`.** The list you connect from. Under the title: `Connecting sends you to your mail server to authorize Yosher. Your password never passes through this app — you approve it there, and we keep a token we can revoke.`
- **A row.** The address in a fixed-width font. Under it the name on the mailbox, or `—` when it has none. Rows run A to Z by the part before the @, and that order decides which mailbox Mail reads.
- **Only addresses that are ready.** An address the mail host has not finished making is left out of the list, so you never click {button:Connect|outline} on one that cannot answer.
- **`Shared`** on the second line of a row. Nobody owns that address personally, so it is offered to everybody in the business. Connect it the same way you connect any other address.
- **{badge:Connected|primary}.** Yosher can read that address right now.
- **{badge:Needs reconnecting|secondary}.** The permission ran out. Click {button:Reconnect|primary}.
- **A row carrying {button:Reconnect|primary} but no badge.** Something else is wrong with that connection: whoever runs the mail server withdrew your access. Reconnecting does not mend that one, and nothing on the row says so.
- **{button:Connect|outline}.** Sends you to your mail server to approve Yosher. Shown while you have never connected that address.
- **{button:Disconnect|ghost}.** Stops Yosher reading that address. Shown on every address you have connected, whatever state it is in.
- **`Connections without a mailbox`.** A card of its own, below the list, when an address you had connected has since been removed from the business. It reads `These addresses were removed from the business, but the connection is still here. Clearing it changes nothing else.`
- **The line under the list.** Once anything is connected you get `Reading mail inside Yosher arrives in the next update. Until then this connection is stored and ready — your mail keeps working on your phone and in Outlook exactly as it does now.` Ignore it. Reading mail inside Yosher works today, and you reach it by dropping `?setup=1` from the address.

## How to connect a mailbox

1. Find your address in `Your mailboxes` and click {button:Connect|outline}.
2. You leave Yosher for your mail server's own sign-in page. Sign in there, as that address, and approve the request. Your password stays on that server and never reaches Yosher.
3. Finish inside ten minutes. Leave it longer and the attempt is thrown away, and you start again.
4. You land back on Mail. When it worked, Mail opens the reader on your inbox. See [Your mailbox](mailbox.md).
5. To check the connection instead of guessing, come back to `/dashboard/m/email?setup=1`. The row carries {badge:Connected|primary}.

You can connect a second address from the same list, and the same round trip runs again. It lands you in the reader on whichever address comes first alphabetically, since that is the only one Mail opens.

Connecting a shared address takes one thing more. Whoever runs the mail server has to have granted your own sign-in access to that address first, and nobody can grant it from inside Yosher. Without it you come back to Mail with nothing connected and nothing said. The reason is written into your browser's address bar, after `mailError=`, and it starts `You signed in as`.

## How to reconnect a mailbox

1. Come back to `/dashboard/m/email?setup=1`. The row reads {badge:Needs reconnecting|secondary}.
2. Click {button:Reconnect|primary} and approve it again, exactly as you did the first time.
3. The new permission replaces the old one. You do not end up with two connections to one address.

If you were reading mail when it ran out, the whole reader turns into one line of text, such as `This mailbox needs to be reconnected.`, with {button:Reconnect this mailbox|primary} under it. That button does the same job. Nothing else is on that page, so use your browser's back button to get anywhere else.

One state {button:Reconnect|primary} cannot mend: `You no longer have access to this mailbox. Ask whoever administers it to grant it again.` Your access to a shared address was withdrawn at the mail server. Signing in again succeeds and changes nothing. Ask whoever runs the mail server to grant it back.

## How to disconnect a mailbox

1. Click {button:Disconnect|ghost} on the row.
2. Read the dialog, `Disconnect this mailbox?`. It reads `Yosher stops reading` your address, then `Nothing is deleted — the mailbox keeps receiving mail, and you can still open it on your phone or in Outlook. Connect it again whenever you like.`
3. Click {button:Disconnect|primary} to go ahead, or {button:Cancel|outline} to keep it.
4. You see `Mailbox disconnected` and the row loses its badge. {button:Connect|outline} comes back in its place.

Disconnecting stops Yosher reading that address, and nothing else. No mail is deleted, at either end. Mail keeps arriving in the mailbox, and you keep opening it on your phone or in Outlook. On a shared address it drops only your own connection, so a colleague reading the same address is untouched. Yosher does not sign itself out at the mail server, so withdraw the permission there too if you want it gone for good.

## How to clear a connection whose address has gone

1. Look at the `Connections without a mailbox` card. Each row reads `Mailbox no longer exists`, because the address behind it was removed from the business.
2. Click {button:Disconnect|ghost}. The dialog names `this mailbox` rather than an address, since there is no longer an address to name.
3. Click {button:Disconnect|primary}. You see `Mailbox disconnected` and the row goes.

Clearing one of these changes nothing else. There is nothing left at the far end to stop.

## Messages

| Message | What it means |
| --- | --- |
| `Mailbox disconnected` | It worked. Yosher has stopped reading that address. |
| `That mailbox isn't connected.` | The connection had already gone, or it was never yours. Reload the page. |
| `This mailbox needs to be reconnected.` | The permission ran out. Click {button:Reconnect|primary}. |
| `That sign-in took too long or was already used. Try connecting again.` | You took more than ten minutes at your mail server, or you used the same link twice. Start again from {button:Connect|outline}. |
| `That authorization has expired or already been used. Try connecting again.` | The permission cannot be renewed. Connect the address again from the start. |
| `You no longer have access to this mailbox. Ask whoever administers it to grant it again.` | Your access to a shared address was withdrawn. Reconnecting will not bring it back. |
| `Couldn't reach the mail server.` | The mail server did not answer. Your mail is safe. Try again shortly. |
| `No mailbox specified.` or `That mailbox doesn't exist.` | A short line of plain text instead of the sign-in page. The address was removed while your page was open. Go back and reload. |
| `This mail server can't keep a connection alive. Ask your administrator.` | Plain text again. Your mail server cannot hold a connection open long enough to be worth storing. Ask us. |
| `Reading mail isn't set up yet — add STALWART_BASE_URL and STALWART_CLIENT_ID. See SETUP.md.` | Reading mail is not turned on for this business yet. Ask us. |
| `Accountant access is read-only — reviews, sign-offs and exports only.` | Accountants have no mail in Yosher. |
| `Something went wrong. Please try again.` | Try once more. Tell us if it keeps happening. |

## Not on this page

Mail reads one address only: the connected one whose part before the @ comes first alphabetically. Connect two and the second is stored and never opened, and there is no picker and no way to switch. Nothing links back to this page once a mailbox is connected, so keep the address `/dashboard/m/email?setup=1`. A connection that fails sends you back to Mail saying nothing at all, so check the list yourself rather than waiting to be told. A successful one says nothing either. No row tells you when you connected or when Yosher last read the mailbox. An address cannot be given to one person, so every address the business makes is offered to everyone. Granting somebody access to a shared address is done by whoever runs the mail server, never here. You cannot make an address or a sending domain from this page either, and only an owner can, in [Email setup](../settings/email-setup.md). Reading, sorting and answering the mail once it arrives is in [Your mailbox](mailbox.md). Ask us if you need any of this.

## Who can do what

Owners and staff both connect their own mailboxes, because reading the address you were given is not an administrative act. Your list holds your own connections only. You cannot see, connect or disconnect a colleague's, even on an address you share. Only an owner creates or deletes the addresses themselves, in [Email setup](/dashboard/email). Accountants have no mail at all: no unread count in the sidebar, and {button:Disconnect|ghost} answers `Accountant access is read-only — reviews, sign-offs and exports only.`
