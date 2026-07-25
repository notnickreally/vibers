# vibers.tv

A live-streaming social network for vibecoders. The stream is not a face cam —
it's the loop: **prompt in, diff out, ship or revert.**

This repository is the front-end prototype. Every screen is real and navigable;
the data behind it is hand-authored fixture data, so the whole thing runs from a
fresh clone with no database, no auth and no media server.

```bash
pnpm install
pnpm dev        # http://localhost:3000
```

## The idea

Watching someone code has always been an awkward format — a face in a corner and
a wall of text nobody can read. vibers.tv puts the thing people actually came for
on screen instead.

A **run** is the unit of broadcast: one viber, one declared goal, one session,
one outcome. Goals are locked before the tally light goes on, and a run that
ends without shipping stays on the profile. Losing runs are half the network's
appeal, and the product refuses to hide them.

### Six surfaces a run puts on screen

| Surface | What it does |
| --- | --- |
| **Prompt-Cam** | Every prompt appears as it's typed, with token counts. The prompt is the performance. |
| **The Wire** | Commits, test runs, reverts and deploys stream out of the editor as they land — per run, and network-wide as a ticker. |
| **Co-prompt** | Chat files prompt suggestions and votes them up. The viber adopts or declines; an adopted prompt is credited to its author permanently and counts toward their assists. |
| **Ship moment** | A green deploy clips itself, lights the wire and writes its own feed post. |
| **Vibe meter** | The audience read, from *locked in* to *cooked*. Struggling runs are not down-ranked. |
| **Rabbit-hole alert** | Repeated prompts against the same stack trace flag the run and open a rescue slot for chat. |

Runs are filed by **stack and tool** (Next.js, Rust, Claude Code, Cursor…),
not by game. The boards rank ships, assists and one-shots — never followers.

## Routes

| Route | What's there |
| --- | --- |
| `/` | Live grid, the signature Prompt→Diff console, stacks, clips, boards |
| `/browse` | Every live run, filtered by stack/tool, sorted four ways |
| `/watch/[handle]` | The run page: canvas, Prompt-Cam transcript, wire, chat + co-prompt, vibe meter |
| `/u/[handle]` | Profile: stats, shipped projects, the full run log including losses, clips |
| `/feed` | Ship moments, prompts, clips, raids and post-mortems |
| `/clips` | Clips typed by what happened — ship, rescue, rabbit hole, one-shot |
| `/leaderboard` | Ships, assists, one-shots, streaks |
| `/go-live` | The broadcaster side: declare a goal, pick surfaces, wire setup |
| `/states` | Reference gallery of the six UI states the run list ships with |

## Design system

Broadcast control room, not a code editor. Aubergine ink (`--color-ink`),
sodium-lamp amber as the brand accent, signal teal for interaction. **Tally red
is reserved for one thing only: something is live right now** — nothing else on
the site is allowed to use it. Diff mint and rose appear only inside code.

Timecodes (`01:26:37`) and run IDs (`RUN-4821`) are the structural device rather
than decorative numbering — they carry real information about when in a run
something happened.

Type: Bricolage Grotesque (display), Instrument Sans (body), JetBrains Mono
(code, data and every utility label).

## UI states

Every list surface designs for six states, all reachable in the running app and
catalogued at `/states`:

- **Success** — `/browse`
- **Loading** — `/browse?state=loading` (and the route-level `loading.tsx`)
- **Partial / slow** — `/browse?state=partial`
- **Empty** — `/browse?stack=Godot&tool=Codex`, or `/browse?state=empty`
- **Error** — `/browse?state=error`
- **Overflow** — `/browse?state=overflow`

## Architecture notes

- **Next.js 16 App Router**, React 19, Tailwind CSS v4, TypeScript. Fixture data
  in `lib/mock/`, UI primitives in `components/ui/`, run surfaces in
  `components/stream/`, shared state components in `components/states/`.
- **No `Math.random()` or `Date.now()` during render.** Fixture data is frozen at
  a single moment so server and client always agree; live behaviour (typing,
  clocks, drifting viewer counts, arriving chat) starts after mount.
- The hero console and stream canvas render a real first frame server-side and
  then continue forward, so there is no hydration flash and no-JS visitors still
  see something true.
- Chat, co-prompting, voting and the vibe meter are locally interactive — state
  lives as long as the tab does.

## Not built yet

Real streaming transport (WebRTC/HLS), auth, persistence, and the `vibers wire`
local agent that would feed real diffs into a run.
