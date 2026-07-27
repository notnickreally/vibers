# vibers.tv

A wall of live coding streams. Paste a YouTube URL, it joins your wall with its
real title and channel, and you can watch the whole wall at once or open one
stream on a clean player.

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
The grid runs 2, 3 or 4 across. Your wall persists in this browser.

**Watching.** `/watch/[videoId]` plays one stream with YouTube's control bar
turned off, driven through the IFrame Player API with our own controls
underneath — play/pause, mute, volume, fullscreen, and a *jump to live* button
that only appears on streams confirmed live. Space and `M` work as shortcuts.
The title, channel and description sit under the picture.

**Chat.** Under the picture, in two tabs. **Live chat** is the stream's real
one, carried in YouTube's own embedded `live_chat` frame — no API key, no
quota, and vibers.tv never holds a message. Reading needs no account; posting
needs a YouTube sign-in, inside their frame. **Notes** is your own transcript
against the video, kept in this browser and sent nowhere, live across your own
tabs. It's what works on a VOD, where there is no chat to carry.

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

## Architecture notes

- **Next.js 16 App Router**, React 19, Tailwind CSS v4, TypeScript.
- `lib/stream.ts` is the store — plain localStorage, no backend yet. That's the
  one real limitation: a wall doesn't sync between devices or browsers. Swapping
  it for a database is a contained change, since every read goes through that
  module.
- `lib/youtube.ts` parses URLs and builds embed URLs; `components/player/`
  wraps the IFrame Player API; `components/wall/` is the wall and watch view.
- No `Math.random()` or `Date.now()` during render, so server and client always
  agree on the first paint.

## Design

Broadcast control room. Aubergine ink, sodium-lamp amber for actions, signal
teal for links out. **Tally red is reserved for one thing: a stream YouTube
confirmed is live right now** — nothing else uses it. Type is Bricolage
Grotesque, Instrument Sans and JetBrains Mono.

## Not built yet

Accounts and a shared/public wall. Both need a backend. So does a chat of our own — the live chat you see is YouTube's,
rendered by YouTube; the notes tab is the local stand-in for the half that
would be ours.
