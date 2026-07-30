# vibers.tv

A wall of live coding streams. Paste a YouTube or Twitch URL, it joins the wall
with its real title and channel, and you can watch the whole wall at once or open
one stream on a clean player. One wall, shared by everyone — what you put up is
what the next visitor sees.

```bash
pnpm install
pnpm dev        # http://localhost:3000
```

No fixture data, no invented people, no fake counts. Everything on screen either
came from the platform it plays on or you put it there.

## How it works

**Add a stream.** Paste any YouTube URL on the wall — `watch?v=`, `youtu.be`,
`/live/`, `/embed/`, `/shorts/`, or a bare 11-character id, with `?t=`
timestamps honoured — or any Twitch one: a channel (`twitch.tv/someone`), a VOD
(`/videos/123`, `/someone/v/123`), or a clip (`clips.twitch.tv/Slug`,
`/someone/clip/Slug`). The title, channel and thumbnail are fetched from the
platform rather than typed in, so nothing can be misattributed. See
[Twitch](#twitch) for what a channel entry means.

**The wall.** One feed, three tabs and two views. The wall reads top to bottom:
what is **live** first, and everything that has **ended** stacked underneath it,
so a finished broadcast is a scroll away rather than behind a tab. The tab bar
filters that feed — **All**, **Live**, **Ended** — rather than being the only
route to half of it. Ended tiles go quiet and grey and never take a player in
any view; a grid of finished VODs all restarting from 0:00 is not a monitor
wall, and it is also why stacking both halves costs no more than the live half
alone did. Liveness is re-asked once on load, batched fifty ids to a call, so a
stream that ends while it is up actually moves. Across all of it, **Posters**
shows thumbnails — cheap and quiet — and **Monitors** swaps every live tile for
a muted player, so the whole wall plays at once like a gallery of screens.
The grid runs 2, 3 or 4 across. The wall lives in Postgres, so it is the same
wall on every device and it is still there tomorrow — and taking a stream off
takes it off for everyone, which is the other half of what shared means.

**Auto-sourcing.** The wall can also go and find streams itself. It searches
YouTube for a list of keywords — `vibecoding live`, `using claude code` and
friends — and puts what it finds up, but only after a second call has confirmed
each one is *actually* on air. That second call is the point: `eventType=live` is
a query against a search index with no freshness guarantee, and the "is it live"
field that comes back inside those results says `live` because `live` is what you
asked for. The video resource is the only thing that knows. A **Sourced** mark
tells you which tiles you chose and which the site did; taking one off is
remembered, so it doesn't come back on your next visit.

**Watching.** `/watch/[videoId]` plays one stream with YouTube's control bar
turned off, driven through the IFrame Player API with our own controls
underneath — play/pause, mute, volume, fullscreen, and a *jump to live* button
that only appears on streams confirmed live. Space and `M` work as shortcuts.
The title, channel and description sit under the picture.

**Chat.** Beside the picture, in two tabs. **Live chat** is the stream's real
one, carried in YouTube's own embedded `live_chat` frame — no API key, no
quota, and vibers.tv never holds a message. Reading needs no account. **Notes**
is your own transcript against the video, kept in this browser and sent nowhere,
live across your own tabs. It's what works on a VOD, where there is no chat to
carry. A Twitch channel brings its own chat into the same tab, with its own
sign-in inside the frame — and none of the window dance below, which is Google's
problem rather than a general one.

**Where the chat sits is a question about room.** Given room it takes the column
to the **left** of the picture and runs the full height of it; where there is no
room it drops back **under** the picture, which is where it has always been. The
page is capped at 1600px like every other page here, so the left column only
fits from 1536px up — a 340px chat plus the wall's 320px rail still leave the
picture ~810px there, and below it they wouldn't. The switch is grid placement
and nothing else: the panel is the same element on both sides, moved between two
grid areas, because re-parenting it would remount the `live_chat` frame and drop
whatever session it had signed into. Nothing is measured, so the first paint is
already right, before any JavaScript runs.

**Posting.** *Sign in to post* opens a real window on YouTube's own
`/signin?next=…` redirector, landing you in that stream's pop-out chat with a
composer. It has to be a window: `accounts.google.com` answers `X-Frame-Options:
DENY`, so the **Sign in** button inside the embedded chat is a dead end no
matter what the page does around it. Going through YouTube's redirector rather
than a hand-built Google URL is what keeps an already-signed-in viewer from
being asked again (`passive=true`) and what establishes the *YouTube* session on
the way back, not merely the Google one. vibers.tv never sees a credential — the
whole exchange happens on Google's origin, and the panel offers a plain link
beside the button for anyone whose browser blocks the window.

**Posting keeps happening in that window, and the panel says so.** Safari's ITP
and Firefox's Total Cookie Protection partition YouTube's cookies inside our
frame, so a session established up there does not necessarily reach down here,
and reloading cannot move it between jars — the call that would,
`requestStorageAccess()`, belongs to YouTube's document rather than ours. So the
*Reload chat* button is offered as a maybe and worded as one. Nothing in the
panel ever claims you are signed in: the window is cross-origin, so whether
anyone signed in — and whether that account even has a channel to post from —
is unreadable from here.

The frame is opaque to us by design, which has one honest consequence: when it
comes up empty — the stream isn't live, the channel turned chat off, or the
browser blocks YouTube's cookies, as Safari does by default — the page cannot
tell that apart from a chat that is simply quiet. So it never guesses. It names
those cases under the frame and always offers **Open chat on YouTube ↗**, which
is the one fallback that works in every case.

## Metadata

`app/api/youtube/route.ts` resolves a video in two steps:

- **oEmbed** — no key, no quota, always on. Title, channel, channel URL,
  thumbnail. This is what makes the app work with zero setup.
- **YouTube Data API** — only when `YOUTUBE_API_KEY` is set. Adds the
  **description**, whether the stream is genuinely **live**, and the
  **concurrent viewer count**.

```bash
# .env.local
YOUTUBE_API_KEY=your-key-here
```

Without the key you get titles and channels but no descriptions, and streams are
never labelled LIVE — because we can't confirm it, and guessing would be
inventing. Anything unresolved stays undefined rather than being filled in. The
chat panel says so on the stream itself rather than leaving a dark tally lamp
unexplained.

The live chat needs none of this. It rides YouTube's own frame, so it works
with zero setup whether or not a key is set.

## Twitch

Twitch works with **zero setup**, same as YouTube's baseline. The title, channel
and preview come off the channel page's own Open Graph tags — no key, no quota —
and the picture is Twitch's own player under `player.twitch.tv`.

```bash
# .env.local — optional, and only for the tally lamp and viewer counts
TWITCH_CLIENT_ID=your-client-id
TWITCH_CLIENT_SECRET=your-client-secret
```

With those two set, `lib/twitch-api.ts` mints an app token (client credentials,
server-side only, cached until it expires) and asks Helix who is actually on air
— a hundred channels to a call, matching how the YouTube side batches. Without
them a Twitch tile still plays; it just never lights the tally lamp, exactly as
an un-keyed YouTube stream doesn't.

Three things about Twitch are worth knowing before reading the code:

- **A live stream has no id of its own.** What is on air is addressed by
  *channel*, so a live Twitch entry on the wall is a channel login, and it is the
  one kind of wall entry whose content changes underneath it. VODs and clips have
  ids and behave like YouTube videos — including going **Ended** on the wall,
  because a recording was never on air.
- **`parent` is the whole gate on framing.** `player.twitch.tv` and
  `twitch.tv/embed/<login>/chat` answer `frame-ancestors <your parent>`, and
  refuse outright without one. It takes the bare hostname, exactly — the same
  bargain YouTube's `live_chat` makes through `embed_domain`. A hostname only
  exists in a browser, so a Twitch frame is never built during a server render;
  the first paint is the poster at the picture's exact size.
- **Only a channel has chat.** Twitch keeps none against a VOD or a clip, so the
  panel says that rather than framing a rectangle that will never fill.

The Twitch player keeps **Twitch's own control bar**, unlike the YouTube one.
There is no Twitch counterpart to the IFrame Player API work behind our own
controls, and hiding a control bar without replacing it would leave a picture
nobody can drive.

## Auto-sourcing, and the one number it lives inside

YouTube only, for now — a Twitch stream goes up because someone pasted it.

```bash
# .env.local
YOUTUBE_API_KEY=your-key-here
YOUTUBE_DISCOVER_ENABLED=1
YOUTUBE_DISCOVER_KEYWORDS=vibecoding live,using claude code
```

The API itself is free — there is no paid tier and no per-call charge. What there
is instead is a hard allowance: **`search.list` permits 100 calls a day, per
Google Cloud project**, resetting at midnight Pacific. Per *project*, which is to
say per key — so production, a preview deployment and a laptop running `pnpm dev`
all spend the same hundred while each keeps a separate cache. That is why
discovery is off unless `YOUTUBE_DISCOVER_ENABLED` is set, and why a serious
deployment wants its own Cloud project per environment.

Three things follow from the allowance, and they are the whole architecture:

- **The keyword list is the deployment's, never the browser's.** There is no `?q=`
  on `/api/youtube/discover`. A search term arriving from outside would let any
  visitor spend a scarce site-wide resource that costs them nothing and cannot be
  topped up.
- **The budget is half the allowance, and the cache TTL is derived from it**
  rather than picked to sit beside it — `DISCOVER_TTL = 86400 × keywords / 50`.
  Adding a keyword lengthens the interval instead of quietly overspending.
- **Searching is cached for hours; confirming is not.** Confirmation comes from a
  different allowance — one unit per fifty videos out of ten thousand a day — so
  it is re-asked every minute. The candidate list goes stale, the liveness never
  does, and a stream that ended in between is filtered out before it reaches the
  wall.

Sharing the cache across visitors is a property of a managed, single-region data
cache, not of the framework. On a host that scales to zero with a disposable
filesystem, each cold start pays for its own round of searches — so the route
also keeps an in-process floor, which bounds the overspend to the number of live
instances rather than the number of requests.

Sourced streams are capped at twelve, swept after a day, and never evict a stream
you added yourself.

## The clean picture — what's possible and what isn't

The frame is just the video: `controls=0`, no annotations, no keyboard capture,
no related-video overlay, and every control rendered in this site's own
language below the player.

What is deliberately **not** done: YouTube's branding is not covered or removed,
and nothing is drawn over the frame. Hovering the picture still surfaces
YouTube's title and logo. There is no supported parameter to remove that, and
faking it — an overlay, or blocking pointer events — is against YouTube's terms
and would also break a viewer's ability to interact with an ad. That attribution
is what makes carrying other people's streams defensible, so it stays.

## Rights

Video is never re-hosted. Every stream plays through its own platform's embedded
player, so the only copy lives on YouTube or Twitch, ads and all. Channels that
disable embedding simply don't play here — their choice, enforced automatically.

Every stream links back to its video and channel, and `/report` takes a takedown
without an account. A stream comes off the wall as soon as a report names it,
before anyone judges it.

## Routes

| Route | What's there |
| --- | --- |
| `/` | The wall — add streams, posters/monitors view, grid sizing |
| `/watch/[id]` | One stream on the clean player, with title, channel, description, and the chat panel — left of the picture where there's room, under it where there isn't |
| `/report` | Takedown path for a creator |
| `/api/lookup?v=` | Metadata lookup for either platform — takes a pasted link or a stored key |
| `/api/youtube?v=` | The YouTube-only lookup (oEmbed, plus Data API when a key is set) |
| `/api/youtube/status?ids=` | Batched liveness for the whole wall at once |
| `/api/youtube/discover` | Keyword auto-sourcing — takes no input, by design |
| `/api/streams` | The shared wall: `GET` it, `POST {v}` to put one up, `DELETE ?v=` / `?sourced=1` to take one off |
| `/api/streams/refresh` | Re-asks liveness for the whole wall and writes it back |
| `/api/streams/source` | Runs discovery and folds what it finds into the wall |
| `/admin` | The panel — the wall with moderation, and which environment variables are set |
| `/admin/login` | The gate: the Slate, the Patch Bay, the Vectorscope |
| `/admin/signup` | Make an operator account, using the deployment's signup password |
| `/api/admin/login` | One layer at a time. `POST {layer, …}`; progress rides a signed stage cookie |
| `/api/admin/signup` | `GET` how many seats are left, `POST` to take one |
| `/api/admin/logout` | Clears both cookies |
| `/api/admin/streams` | The same three wall actions, behind the gate |

## Architecture notes

- **Next.js 16 App Router**, React 19, Tailwind CSS v4, TypeScript.
- **The wall is one shared wall, in Neon Postgres.** `lib/wall.ts` is the store
  and runs server-side; `lib/db.ts` holds the connection and creates the two
  tables on first use, so a fresh Neon branch needs no migration step. The
  browser reaches all of it through `app/api/streams`, and `lib/stream.ts` is
  now two halves: pure functions that decide (`shelf`, `partition`,
  `mergeStatuses`, `mergeSourced`), and async `fetch` calls that ask. There is
  no local fallback — if the database can't be reached the wall says so rather
  than rendering an empty grid that looks exactly like an empty wall.
- **Streams go up by id.** `POST /api/streams` takes a link or an id and nothing
  else, and looks it up itself. A client-supplied title would be arbitrary text
  and a client-supplied thumbnail an arbitrary `img src`, on everyone's wall,
  from anyone who can reach the route.
- **`lib/source.ts` is the seam between the platforms**, and the key format is
  the compatibility promise: a YouTube id stays a bare id — every row already in
  Neon and every `/watch/<id>` link already shared still resolves — and anything
  else carries its provider in front of it, today `twitch:channel:<login>`. A new
  platform adds a prefix and a branch, never a migration. Everything upstream
  asks `lib/source.ts` what a stored key is and gets back an embed, a poster, a
  link out and a label without naming a platform itself.
- `lib/youtube.ts` and `lib/twitch.ts` parse URLs and build embed URLs;
  `components/player/` wraps the IFrame Player API for YouTube and frames
  Twitch's own player; `components/wall/` is the wall and watch view.
- No `Math.random()` or `Date.now()` during render, so server and client always
  agree on the first paint.

## Design

Broadcast control room. Aubergine ink, sodium-lamp amber for actions, signal
teal for links out. **Tally red is reserved for one thing: a stream YouTube
confirmed is live right now** — nothing else uses it. Type is Bricolage
Grotesque, Instrument Sans and JetBrains Mono.

## The database

The wall needs one environment variable:

```bash
# .env.local
DATABASE_URL=postgres://…
```

Neon, provisioned through the Vercel Marketplace — the integration sets
`DATABASE_URL` on the project itself, so a deployment needs no further setup.
The tables (`streams`, `dismissed_streams`, `admins`) are created on first use,
which means every preview deployment's own Neon branch works without a migration
step. There is no local database and no local fallback: without `DATABASE_URL`
the wall's routes answer 503 and the page says so.

## The admin panel

`/admin` is the wall with moderation on it: take a stream off for everyone,
clear every auto-sourced one, re-ask both platforms what is still live. Plus a
read-out of which environment variables this deployment has — booleans only,
because a panel that printed an API key to help you debug it would be the leak
it was meant to prevent.

**It checks itself every five minutes.** Both of those checks used to be
buttons, which meant a panel left open on a screen showed whatever was true when
it loaded — the one thing a board of live streams cannot afford. Now one cycle
runs on its own: sweep the watched channels, then re-ask liveness for every URL
on the wall, then refresh the page behind both so the counts, the roster and the
environment read-out are as current as the lists. It is the same two calls the
buttons send, so the automatic path and the manual one can't disagree. The cycle
has a second trigger: **adding a watched username runs it immediately**, because
a name typed in is a name somebody wants an answer about now, not at the next
tick — and a run restarts the clock, so the two triggers never stack. A line
under the wall says when the last cycle ran and what it checked; an automatic
thing with no moment needs one.

Getting in takes three layers, and two of them are not passwords:

1. **The Slate** — a handle and a passphrase, drawn as a clapperboard. This is
   the layer that carries the entropy.
2. **The Patch Bay** — three cables between six sources and six destinations.
   Drag them, click them, or tab to them. Order doesn't matter; 2400 sets do.
3. **The Vectorscope** — three notches out of twelve on a dial, in order. 1728
   combinations.

Layers two and three are puzzles, not passwords, and the code says so out loud.
What makes them cost anything is that every layer is decided on the server —
the browser is never sent the expected patch set or the combination — and that
three wrong answers start a doubling lockout, capped at fifteen minutes. Progress
between layers rides an HttpOnly, SameSite=Lax, HMAC-signed stage cookie naming
which layer you actually reached, so answering layer three correctly without
having passed layer two is a 401 rather than a sign-in.

Two more variables, and neither has a fallback:

```bash
# .env.local
ADMIN_SESSION_SECRET=…   # 32+ characters, signs the cookies
ADMIN_SIGNUP_PASSWORD=…  # what makes signing up privileged
```

Unset either one and the panel answers 503 and refuses to open. A default for
either would be a published credential — the kind that ships to production
because it worked locally. Signing up is capped at eight accounts per deployment
and does **not** sign you in: the account exists, and the gate is still the gate.

## Not built yet

A chat of our own: the live chat you see is YouTube's, rendered by YouTube, and
the notes tab is a local, per-browser stand-in for the half that would be ours.

The public wall routes are still anonymous, deliberately — anyone can put a
stream up and anyone can take one down, because the wall is meant to be
everybody's. `/admin` adds a place where the same actions happen behind a
sign-in; it does not yet record who did which.
