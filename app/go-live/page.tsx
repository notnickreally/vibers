import type { Metadata } from "next";
import { GoLiveComposer } from "@/components/stream/go-live-composer";
import { SectionHead } from "@/components/ui/bits";

export const metadata: Metadata = {
  title: "Go live",
  description: "Declare a goal, point the wire at your repo, and hit the tally.",
};

const RULES = [
  {
    slate: "Bring your own picture",
    body: "Point the run at the YouTube URL you're already broadcasting to. vibers.tv wraps it in the Prompt-Cam, the Wire and chat — it doesn't re-encode your video.",
  },
  {
    slate: "Goal first",
    body: "A run needs a stated goal before the tally goes on, and it is locked for the duration. Runs without one are unlisted.",
  },
  {
    slate: "Losses count",
    body: "Ending a run without shipping does not hurt your standing. Deleting the run log does — abandoned runs stay on your profile.",
  },
  {
    slate: "Credit is automatic",
    body: "Adopt a co-prompt and the author is credited on the transcript and on their assist board. You cannot turn that off.",
  },
  {
    slate: "Secrets never hit the wire",
    body: "The Wire reads diffs, not files. Anything matched by your ignore rules is stripped before it leaves the machine.",
  },
];

const WIRE_SETUP = `# point the wire at the repo you're about to break
npx vibers wire link ./my-repo

# stream prompts + diffs while you work
npx vibers run start \\
  --goal "rip out the ORM" \\
  --tool claude-code \\
  --feed https://www.youtube.com/live/YOUR_STREAM`;

export default function GoLivePage() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6">
      <SectionHead
        slate="Broadcast"
        title="Start a run"
        meta="Setup takes about ninety seconds"
      />

      <GoLiveComposer />

      <section className="mt-16">
        <SectionHead slate="Setup" title="Point the wire at your repo" />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* min-w-0: the setup snippet is pre-formatted and would widen the grid. */}
          <div className="min-w-0">
            <p className="text-[15px] leading-relaxed text-muted">
              Video stays on YouTube — stream there as you normally would and give the run
              its URL. The wire is a separate local process: it watches your repo for
              commits, test runs and deploys and forwards the diff stat — never file
              contents — to the run page. The Prompt-Cam hooks your coding tool and mirrors
              each prompt as you send it.
            </p>
            <pre className="scrollbar-thin mt-5 overflow-x-auto border border-edge-soft bg-ink p-4 font-mono text-[12px] leading-relaxed text-bone/90">
              {WIRE_SETUP}
            </pre>
            <p className="mt-3 font-mono text-[11px] text-faint">
              Works with Claude Code, Cursor, Codex, Zed and Windsurf. Everything else can
              still stream a screen, just without the Prompt-Cam.
            </p>
          </div>

          <div className="grid min-w-0 gap-px border border-edge-soft bg-edge-soft sm:grid-cols-2">
            {RULES.map((rule) => (
              <div key={rule.slate} className="bg-ink p-5">
                <p className="eyebrow text-amber">{rule.slate}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted">{rule.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
