# Local dev server — the site runs on localhost:3000

**The vibers.tv website works on `http://localhost:3000`.** That is the address to
open (and to point screenshot/QA tooling at) when running the app locally.

## Why 3000

`package.json` has no port flag anywhere:

    "dev":   "next dev",     # → http://localhost:3000
    "start": "next start",   # → http://localhost:3000

Both fall through to Next.js's default port, `3000`. Nothing in `next.config.ts`
or the environment overrides it, so 3000 is the port by omission rather than by
declaration — if someone later adds `--port` or a `PORT` env var, this note is
what goes stale first.

Start it with `pnpm dev` from the repo root, then open `http://localhost:3000`.
Route-level entry points hang off that origin the usual way (e.g.
`http://localhost:3000/watch/<videoId>`).

## The caveat: 3000 is not guaranteed

Next.js does **not** fail when 3000 is taken — it silently increments to 3001,
3002, … and prints the real URL in its startup log. Fredrin runs many ticket
worktrees of this same repo side by side, and each one's dev server wants 3000,
so a second server started while another is up will land somewhere else entirely.

Two failure modes follow from that:

- You open `localhost:3000` and see **another branch's build**, mistaking it for
  your own changes.
- Automated capture (Playwright, screenshot harnesses) hardcodes `:3000` and
  screenshots the wrong app.

So: `localhost:3000` is where the site runs, but **read the dev server's log line
for the port you actually got**, and pass `--port` explicitly when it matters
(parallel worktrees, before/after captures, anything scripted).

## Related

- `README.md` states the same address in its quickstart (`pnpm dev  #
  http://localhost:3000`). This note is the fuller version: *why* it is 3000, and
  when it won't be.
- The app is on `main` as of 2026-07-25 (PR #1 and #4 merged), so a fresh ticket
  worktree can `pnpm install && pnpm dev` directly. Earlier worktrees had to merge
  the app branch in first — that no longer applies.
