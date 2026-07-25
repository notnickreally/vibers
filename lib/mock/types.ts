/**
 * The vocabulary of vibers.tv.
 *
 * A `Run` is the unit of broadcast: one vibecoder, one stated goal, one
 * session. It has an outcome, not just an ending. Everything else on the site
 * — prompts, diffs, clips, feed posts — hangs off a run.
 */

export type Tool =
  | "Claude Code"
  | "Cursor"
  | "Codex"
  | "v0"
  | "Windsurf"
  | "Zed"
  | "Copilot";

export type Stack =
  | "Next.js"
  | "Swift"
  | "Rust"
  | "Supabase"
  | "Godot"
  | "Python"
  | "Solidity"
  | "React Native"
  | "Go"
  | "Three.js";

export type RunStatus = "live" | "ended" | "scheduled";

/** How a run actually finished. The site never pretends every run ships. */
export type RunOutcome = "shipped" | "abandoned" | "rabbit-hole" | "running";

export type PromptOutcome =
  | "shipped"
  | "reverted"
  | "rabbit-hole"
  | "running"
  | "clean";

export interface Viber {
  handle: string;
  name: string;
  pronouns: string;
  bio: string;
  location: string;
  joined: string;
  tools: Tool[];
  stacks: Stack[];
  followers: number;
  /** Runs that ended in a deploy. The only vanity metric that means anything. */
  ships: number;
  /** Times a co-prompt of theirs was adopted on someone else's run. */
  assists: number;
  /** Consecutive weeks with at least one shipped run. */
  streak: number;
  hue: number;
  live: boolean;
}

export interface DiffStat {
  files: number;
  added: number;
  removed: number;
}

export interface Run {
  id: string;
  /** Broadcast-style run identifier, shown everywhere a timecode is shown. */
  code: string;
  handle: string;
  /** The stated goal. Every run declares one before it goes live. */
  goal: string;
  status: RunStatus;
  outcome: RunOutcome;
  tool: Tool;
  model: string;
  stacks: Stack[];
  /** Seconds elapsed at the frozen "now" of this mock dataset. */
  elapsed: number;
  viewers: number;
  peakViewers: number;
  /** Audience read, 0–100. Low is not bad — low is honest. */
  vibe: number;
  prompts: number;
  diff: DiffStat;
  /** Deterministic poster tone so cards look composed, never random. */
  tone: 0 | 1 | 2 | 3 | 4;
  startedLabel: string;
  /** Only present on scheduled runs. */
  scheduledFor?: string;
}

export interface PromptEvent {
  /** Seconds into the run. */
  t: number;
  text: string;
  outcome: PromptOutcome;
  /** Present when the prompt came from the audience and was adopted. */
  adoptedFrom?: string;
  tokens: number;
}

export type WireKind = "commit" | "deploy" | "test-pass" | "test-fail" | "revert";

export interface WireEvent {
  t: number;
  kind: WireKind;
  file: string;
  message: string;
  added: number;
  removed: number;
}

export type ChatKind = "chat" | "assist" | "raid" | "ship";

export interface ChatMessage {
  id: string;
  handle: string;
  hue: number;
  text: string;
  kind: ChatKind;
}

export interface CoPrompt {
  id: string;
  handle: string;
  hue: number;
  text: string;
  votes: number;
  status: "pending" | "adopted" | "declined";
}

export interface Clip {
  id: string;
  title: string;
  handle: string;
  runCode: string;
  seconds: number;
  views: number;
  tone: 0 | 1 | 2 | 3 | 4;
  /** What the clip captured. Clips here are events, not just funny moments. */
  kind: "ship" | "rescue" | "rabbit-hole" | "one-shot";
}

export type FeedKind = "ship" | "clip" | "prompt" | "milestone" | "raid" | "run";

export interface FeedPost {
  id: string;
  kind: FeedKind;
  handle: string;
  when: string;
  body: string;
  /** Structured payload rendered as the post's card. */
  runCode?: string;
  diff?: DiffStat;
  clipId?: string;
  promptText?: string;
  likes: number;
  replies: number;
}

/**
 * A **relay**: a YouTube stream someone pointed the network at, rather than a
 * run someone is broadcasting here. The URL is the only required part — every
 * other field is optional, and whatever is filled in is credited to the person
 * who relayed it, never presented as something the creator declared.
 *
 * Free-form strings rather than the `Tool`/`Stack` unions: this is user input
 * arriving from a query string, and pretending otherwise would be a lie to the
 * type system.
 */
export interface Relay {
  videoId: string;
  start?: number;
  title?: string;
  note?: string;
  tool?: string;
  stacks?: string[];
  /** The vibers.tv account that put it on the network. */
  relayedBy?: string;
}

export interface Project {
  name: string;
  blurb: string;
  url: string;
  runs: number;
  shipped: string;
}
