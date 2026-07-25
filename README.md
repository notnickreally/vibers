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

**The wall.** Two views. **Posters** shows thumbnails — cheap and quiet.
**Monitors** swaps every tile for a live muted player, so the whole wall plays
at once like a gallery of screens. The grid runs 2, 3 or 4 across. Your wall
persists in this browser.

**Watching.** `/watch/[videoId]` plays one stream with YouTube's control bar
turned off, driven through the IFrame Player API with our own controls
underneath — play/pause, mute, volume, fullscreen, and a *jump to live* button
that only appears on streams confirmed live. Space and `M` work as shortcuts.
The title, channel and description sit under the picture.

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
inventing. Anything unresolved stays undefined rather than being filled in.

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
| `/watch/[id]` | One stream on the clean player, with title, channel and description |
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

Accounts, a shared/public wall, and auto-refreshing live status. All three need
a backend.
