# vibers.tv

A wall of live coding streams. Paste a YouTube URL, it joins the wall with its
real title and channel, and you can watch the whole wall at once or open one
stream on a clean player. One wall, shared by everyone — what you put up is
what the next visitor sees.

```bash
pnpm install
pnpm dev        # http://localhost:3000
```

No fixture data, no invented people, no fake counts. Everything on screen either
came from YouTube or you put it there.

## How it works

**Add a stream.** Paste any YouTube URL on the wall — `watch?v=`, `youtu.be`,
`/live/`, `/embed/`, `/shorts/`, or a bare 11-character id, with `?t=`
timestamps honoured. The title, channel and thumbnail are fetched from YouTube
rather than typed in, so nothing can be misattributed.

**The wall.** Two tabs and two views. **Live** is the wall proper; a broadcast
that finishes moves to **Ended**, where the tiles go quiet and grey and never
take a player — a grid of finished VODs all restarting from 0:00 is not a
monitor wall. Liveness is re-asked once on load, batched fifty ids to a call,
so a stream that ends while it is up actually moves. Within a tab, **Posters**
shows thumbnails — cheap and quiet — and **Monitors** swaps every tile for a
live muted player, so the whole wall plays at once like a gallery of screens.
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

**Chat.** Under the picture, in two tabs. **Live chat** is the stream's real
one, carried in YouTube's own embedded `live_chat` frame — no API key, no
quota, and vibers.tv never holds a message. Reading needs no account. **Notes**
is your own transcript against the video, kept in this browser and sent nowhere,
live across your own tabs. It's what works on a VOD, where there is no chat to
carry.

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

## Auto-sourcing, and the one number it lives inside

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

Video is never re-hosted. Every stream plays through YouTube's own embedded
player, so the only copy lives on YouTube, ads and all. Channels that disable
embedding simply don't play here — their choice, enforced automatically.

Every stream links back to its video and channel, and `/report` takes a takedown
without an account. A stream comes off the wall as soon as a report names it,
before anyone judges it.

## Routes

| Route | What's there |
| --- | --- |
| `/` | The wall — add streams, posters/monitors view, grid sizing |
| `/watch/[id]` | One stream on the clean player, with title, channel, description, and the chat panel |
| `/report` | Takedown path for a creator |
| `/api/youtube?v=` | Metadata lookup (oEmbed, plus Data API when a key is set) |
| `/api/youtube/status?ids=` | Batched liveness for the whole wall at once |
| `/api/youtube/discover` | Keyword auto-sourcing — takes no input, by design |
| `/api/streams` | The shared wall: `GET` it, `POST {v}` to put one up, `DELETE ?v=` / `?sourced=1` to take one off |
| `/api/streams/refresh` | Re-asks liveness for the whole wall and writes it back |
| `/api/streams/source` | Runs discovery and folds what it finds into the wall |

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
- **Streams go up by id.** `POST /api/streams` takes a YouTube id or URL and
  nothing else, and looks the video up itself. A client-supplied title would be
  arbitrary text and a client-supplied thumbnail an arbitrary `img src`, on
  everyone's wall, from anyone who can reach the route.
- `lib/youtube.ts` parses URLs and builds embed URLs; `components/player/`
  wraps the IFrame Player API; `components/wall/` is the wall and watch view.
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
The two tables (`streams`, `dismissed_streams`) are created on first use, which
means every preview deployment's own Neon branch works without a migration
step. There is no local database and no local fallback: without `DATABASE_URL`
the wall's routes answer 503 and the page says so.

## Not built yet

Accounts. The wall is shared but anonymous — anyone can put a stream up and
anyone can take one down, and nothing records who did which. So is a chat of
our own: the live chat you see is YouTube's, rendered by YouTube, and the notes
tab is a local, per-browser stand-in for the half that would be ours.
