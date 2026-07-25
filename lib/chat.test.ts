import { beforeEach, describe, expect, it } from "vitest";
import {
  chatKey,
  clearMessages,
  isChatKey,
  listMessages,
  loadHandle,
  MAX_BODY,
  MAX_HANDLE,
  MAX_MESSAGES,
  mintHandle,
  normalizeBody,
  normalizeHandle,
  parseMessages,
  saveHandle,
  sendMessage,
  stamp,
} from "./chat";

/**
 * The store takes its `Storage`, so none of this needs a DOM — the suite runs
 * in vitest's default node environment, same as `player-time.test.ts`.
 */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  /** Set to make every write throw, standing in for a full quota. */
  full = false;

  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    if (this.full) throw new Error("QuotaExceededError");
    this.map.set(key, value);
  }
}

const VIDEO = "dQw4w9WgXcQ";
let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
});

function send(body: string, at = 1_700_000_000_000, handle = "gagik") {
  return sendMessage(VIDEO, { handle, body, id: `id-${at}`, sentAt: at }, storage);
}

describe("sendMessage", () => {
  it("appends a message and reads it back", () => {
    const result = send("first light");
    expect(result.ok).toBe(true);
    expect(listMessages(VIDEO, storage)).toEqual([
      { id: "id-1700000000000", handle: "gagik", body: "first light", sentAt: 1_700_000_000_000 },
    ]);
  });

  it("keeps transcripts apart per video", () => {
    send("here");
    sendMessage("jNQXAC9IVRw", { handle: "a", body: "there", id: "x", sentAt: 1 }, storage);
    expect(listMessages(VIDEO, storage)).toHaveLength(1);
    expect(listMessages("jNQXAC9IVRw", storage)[0].body).toBe("there");
  });

  it("refuses an empty or whitespace-only message without touching the store", () => {
    send("real one");
    const result = send("   \n  ");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(listMessages(VIDEO, storage)).toHaveLength(1);
  });

  it("reports a full quota rather than silently dropping the message", () => {
    storage.full = true;
    const result = send("this one is lost");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/full/i);
    expect(result.messages).toEqual([]);
  });

  it("caps history at MAX_MESSAGES, dropping the oldest first", () => {
    for (let i = 0; i < MAX_MESSAGES + 10; i++) send(`m${i}`, 1_700_000_000_000 + i);
    const kept = listMessages(VIDEO, storage);
    expect(kept).toHaveLength(MAX_MESSAGES);
    expect(kept[0].body).toBe("m10");
    expect(kept[kept.length - 1].body).toBe(`m${MAX_MESSAGES + 9}`);
  });

  it("normalizes the handle and body it stores", () => {
    sendMessage(
      VIDEO,
      { handle: "  ", body: "  spaced   out  ", id: "i", sentAt: 5 },
      storage,
    );
    expect(listMessages(VIDEO, storage)[0]).toMatchObject({
      handle: "anon",
      body: "spaced out",
    });
  });
});

describe("parseMessages", () => {
  it("returns nothing for missing or corrupt JSON", () => {
    expect(parseMessages(null)).toEqual([]);
    expect(parseMessages("not json")).toEqual([]);
    expect(parseMessages('{"a":1}')).toEqual([]);
  });

  it("drops malformed entries and keeps the good ones", () => {
    const good = { id: "a", handle: "h", body: "b", sentAt: 1 };
    const raw = JSON.stringify([good, { id: 1 }, null, "nope", { ...good, sentAt: "soon" }]);
    expect(parseMessages(raw)).toEqual([good]);
  });

  it("survives a stored array longer than the cap", () => {
    const many = Array.from({ length: MAX_MESSAGES + 5 }, (_, i) => ({
      id: `a${i}`,
      handle: "h",
      body: `b${i}`,
      sentAt: i,
    }));
    const parsed = parseMessages(JSON.stringify(many));
    expect(parsed).toHaveLength(MAX_MESSAGES);
    expect(parsed[parsed.length - 1].body).toBe(`b${MAX_MESSAGES + 4}`);
  });
});

describe("clearMessages", () => {
  it("removes only this video's transcript", () => {
    send("gone");
    sendMessage("jNQXAC9IVRw", { handle: "a", body: "stays", id: "x", sentAt: 1 }, storage);
    clearMessages(VIDEO, storage);
    expect(listMessages(VIDEO, storage)).toEqual([]);
    expect(listMessages("jNQXAC9IVRw", storage)).toHaveLength(1);
  });
});

describe("isChatKey", () => {
  it("matches this video's key only", () => {
    expect(isChatKey(chatKey(VIDEO), VIDEO)).toBe(true);
    expect(isChatKey(chatKey("jNQXAC9IVRw"), VIDEO)).toBe(false);
    expect(isChatKey("vibers:wall", VIDEO)).toBe(false);
  });

  it("treats a whole-storage clear (null key) as a change", () => {
    expect(isChatKey(null, VIDEO)).toBe(true);
  });
});

describe("normalizing", () => {
  it("collapses newlines and truncates a long body", () => {
    expect(normalizeBody("a\n\nb")).toBe("a b");
    expect(normalizeBody("x".repeat(MAX_BODY + 50))).toHaveLength(MAX_BODY);
  });

  it("strips whitespace from a handle and falls back to anon", () => {
    expect(normalizeHandle(" ga gik ")).toBe("gagik");
    expect(normalizeHandle("")).toBe("anon");
    expect(normalizeHandle("h".repeat(MAX_HANDLE + 9))).toHaveLength(MAX_HANDLE);
  });
});

describe("handle identity", () => {
  it("round-trips through storage", () => {
    expect(loadHandle(storage)).toBeNull();
    saveHandle("nick", storage);
    expect(loadHandle(storage)).toBe("nick");
  });

  it("mints a stable handle from a seed", () => {
    expect(mintHandle(0.4242)).toBe("viber-4242");
    expect(mintHandle(0.0001)).toBe("viber-0001");
    expect(mintHandle(0)).toBe("viber-0000");
  });
});

describe("stamp", () => {
  it("is a zero-padded wall clock", () => {
    const at = new Date(2026, 0, 2, 9, 5).getTime();
    expect(stamp(at)).toBe("09:05");
  });
});

describe("without any storage at all", () => {
  it("reads empty and refuses to send rather than throwing", () => {
    // No `storage` argument and no global `localStorage` under node — the same
    // path a server render takes.
    expect(listMessages(VIDEO)).toEqual([]);
    const result = sendMessage(VIDEO, { handle: "h", body: "hi", id: "i", sentAt: 1 });
    expect(result.ok).toBe(false);
    expect(loadHandle()).toBeNull();
  });
});
