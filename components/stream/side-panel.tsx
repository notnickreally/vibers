"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { CHAT, CO_PROMPTS } from "@/lib/mock/data";
import type { ChatMessage, CoPrompt } from "@/lib/mock/types";

/**
 * The right rail: Chat, Co-prompt and the Wire.
 *
 * Chat and Co-prompt are locally interactive — you can send a message and file
 * a prompt suggestion, and they land in the list. There is no server here, so
 * everything you add lives for as long as the tab does.
 */

type Tab = "chat" | "coprompt" | "wire";

const KIND_STYLE: Record<ChatMessage["kind"], string> = {
  chat: "",
  assist: "border-l-2 border-teal bg-teal/8 pl-2",
  raid: "border-l-2 border-amber bg-amber/8 pl-2",
  ship: "border-l-2 border-add bg-add/8 pl-2",
};

const KIND_TAG: Partial<Record<ChatMessage["kind"], string>> = {
  assist: "ASSIST",
  raid: "RAID",
  ship: "SHIP",
};

export function SidePanel({ wireSlot, handle }: { wireSlot: ReactNode; handle: string }) {
  const [tab, setTab] = useState<Tab>("chat");

  // Chat starts with the first four messages and fills in after mount, so the
  // server and client agree on the first paint.
  const [messages, setMessages] = useState<ChatMessage[]>(CHAT.slice(0, 4));
  const [draft, setDraft] = useState("");
  const [prompts, setPrompts] = useState<CoPrompt[]>(CO_PROMPTS);
  const [promptDraft, setPromptDraft] = useState("");
  const [voted, setVoted] = useState<Record<string, boolean>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const nextIndex = useRef(4);

  useEffect(() => {
    const id = setInterval(() => {
      const source = CHAT[nextIndex.current % CHAT.length];
      nextIndex.current += 1;
      setMessages((prev) => {
        const next = [...prev, { ...source, id: `${source.id}-${nextIndex.current}` }];
        return next.length > 60 ? next.slice(-60) : next;
      });
    }, 3200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, tab]);

  function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setMessages((prev) => [
      ...prev,
      { id: `you-${prev.length}`, handle: "you", hue: 32, text, kind: "chat" },
    ]);
    setDraft("");
  }

  function fileCoPrompt(e: React.FormEvent) {
    e.preventDefault();
    const text = promptDraft.trim();
    if (!text) return;
    setPrompts((prev) => [
      { id: `you-${prev.length}`, handle: "you", hue: 32, text, votes: 1, status: "pending" },
      ...prev,
    ]);
    setPromptDraft("");
    setTab("coprompt");
  }

  function toggleVote(id: string) {
    setVoted((v) => ({ ...v, [id]: !v[id] }));
    setPrompts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, votes: p.votes + (voted[id] ? -1 : 1) } : p)),
    );
  }

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: "chat", label: "Chat" },
    { id: "coprompt", label: "Co-prompt", count: prompts.filter((p) => p.status === "pending").length },
    { id: "wire", label: "Wire" },
  ];

  return (
    // Sized so the panel and the vibe meter below it both fit a sticky viewport.
    <div className="panel flex h-[640px] flex-col lg:h-[calc(100vh-17rem)] lg:min-h-[420px]">
      <div className="flex shrink-0 border-b border-edge-soft">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 border-r border-edge-soft px-2 py-2.5 font-mono text-[11px] tracking-[0.12em] uppercase transition-colors last:border-r-0 ${
              tab === t.id ? "bg-panel-2 text-amber" : "text-muted hover:text-bone"
            }`}
          >
            {t.label}
            {t.count ? <span className="ml-1.5 text-faint">{t.count}</span> : null}
          </button>
        ))}
      </div>

      {tab === "chat" && (
        <>
          {/* Messages hug the bottom of the panel, the way chat always has. */}
          <div ref={listRef} className="scrollbar-thin flex-1 overflow-y-auto p-3">
            <div className="flex min-h-full flex-col justify-end space-y-2">
              {messages.map((m) => (
              <p key={m.id} className={`text-[13px] leading-snug ${KIND_STYLE[m.kind]}`}>
                {KIND_TAG[m.kind] && (
                  <span className="mr-1.5 font-mono text-[9px] tracking-[0.14em] text-teal">
                    {KIND_TAG[m.kind]}
                  </span>
                )}
                <span
                  className="font-mono text-[12px]"
                  style={{ color: `hsl(${m.hue} 60% 70%)` }}
                >
                  {m.handle}
                </span>
                <span className="mx-1 text-faint">:</span>
                <span className="text-bone/90">{m.text}</span>
              </p>
              ))}
            </div>
          </div>
          <form onSubmit={sendMessage} className="shrink-0 border-t border-edge-soft p-2">
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Say something to @${handle}`}
                aria-label="Chat message"
                className="min-w-0 flex-1 border border-edge bg-ink px-2.5 py-2 font-mono text-[12px] text-bone placeholder:text-faint focus:border-teal focus:outline-none"
              />
              <button
                type="submit"
                className="border border-edge px-3 font-mono text-[11px] tracking-[0.1em] text-muted uppercase transition-colors hover:border-amber hover:text-amber"
              >
                Send
              </button>
            </div>
          </form>
        </>
      )}

      {tab === "coprompt" && (
        <>
          <div className="scrollbar-thin flex-1 overflow-y-auto">
            <p className="border-b border-edge-soft px-3 py-2.5 text-[12px] leading-relaxed text-muted">
              Write the prompt you think should go next. Top-voted suggestions surface in
              the viber&apos;s composer — if one gets adopted, it&apos;s credited to you.
            </p>
            <ul className="divide-y divide-edge-soft">
              {prompts.map((p) => (
                <li key={p.id} className="flex gap-3 p-3">
                  <button
                    type="button"
                    onClick={() => toggleVote(p.id)}
                    aria-pressed={!!voted[p.id]}
                    className={`flex h-11 w-9 shrink-0 flex-col items-center justify-center border font-mono text-[10px] transition-colors ${
                      voted[p.id]
                        ? "border-amber bg-amber/12 text-amber"
                        : "border-edge text-muted hover:border-amber hover:text-amber"
                    }`}
                  >
                    <span aria-hidden>▲</span>
                    <span className="tabular-nums">{p.votes}</span>
                  </button>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2">
                      <span
                        className="font-mono text-[11px]"
                        style={{ color: `hsl(${p.hue} 60% 70%)` }}
                      >
                        @{p.handle}
                      </span>
                      {p.status === "adopted" && (
                        <span className="border border-add/40 bg-add/10 px-1 font-mono text-[9px] tracking-[0.12em] text-add">
                          ADOPTED
                        </span>
                      )}
                      {p.status === "declined" && (
                        <span className="border border-edge px-1 font-mono text-[9px] tracking-[0.12em] text-faint">
                          DECLINED
                        </span>
                      )}
                    </p>
                    <p className="mt-1 font-mono text-[12px] leading-snug text-bone/90">{p.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <form onSubmit={fileCoPrompt} className="shrink-0 border-t border-edge-soft p-2">
            <textarea
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              rows={2}
              placeholder="Suggest the next prompt…"
              aria-label="Suggest a prompt"
              className="w-full resize-none border border-edge bg-ink px-2.5 py-2 font-mono text-[12px] text-bone placeholder:text-faint focus:border-teal focus:outline-none"
            />
            <button
              type="submit"
              className="mt-2 w-full bg-amber px-3 py-2 font-mono text-[11px] font-semibold tracking-[0.12em] text-ink uppercase transition-colors hover:bg-bone"
            >
              File co-prompt
            </button>
          </form>
        </>
      )}

      {tab === "wire" && <div className="scrollbar-thin flex-1 overflow-y-auto">{wireSlot}</div>}
    </div>
  );
}
