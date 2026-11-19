// Where rank faces are saved: Supabase Storage for real profiles, this
// browser's IndexedDB in demo mode (so the demo can show your real face).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Mood } from "./types";

export interface FaceStore {
  /** Display URLs of the saved faces. */
  load(): Promise<Partial<Record<Mood, string>>>;
  save(mood: Mood, blob: Blob, ext: string): Promise<void>;
}

const COLUMN = { first: "gif_first", second: "gif_second", third: "gif_third" } as const;
const MOODS: Mood[] = ["first", "second", "third"];

export function supabaseFaceStore(sb: SupabaseClient, userId: string): FaceStore {
  return {
    async load() {
      const { data } = await sb.from("profiles").select("gif_first, gif_second, gif_third").eq("id", userId).single();
      const row = (data ?? {}) as Record<string, string | null>;
      const out: Partial<Record<Mood, string>> = {};
      for (const mood of MOODS) {
        const path = row[COLUMN[mood]];
        if (!path) continue;
        const { data: signed } = await sb.storage.from("gifs").createSignedUrl(path, 3600);
        if (signed) out[mood] = signed.signedUrl;
      }
      return out;
    },

    async save(mood, blob, ext) {
      const column = COLUMN[mood];
      const { data } = await sb.from("profiles").select(column).eq("id", userId).single();
      const old = ((data ?? {}) as Record<string, string | null>)[column] ?? null;
      // New filename every time so nobody sees a cached old face.
      const path = `${userId}/${mood}-${Date.now()}.${ext}`;
      const up = await sb.storage.from("gifs").upload(path, blob, { contentType: blob.type || `image/${ext}` });
      if (up.error) throw new Error(up.error.message);
      const upd = await sb.from("profiles").update({ [column]: path }).eq("id", userId);
      if (upd.error) throw new Error(upd.error.message);
      if (old) await sb.storage.from("gifs").remove([old]);
    },
  };
}

// ------------------------------------------------------------ demo (IndexedDB)

const DB = "bot-race-demo";
const STORE = "faces";

interface Saved {
  blob: Blob;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
    });
  } finally {
    db.close();
  }
}

// Object URLs are reused until the face changes, so the GIF doesn't restart on every tick.
const urlCache = new Map<Mood, { savedAt: number; url: string }>();

/** Faces saved in demo mode, as object URLs. Empty if storage is unavailable. */
export async function loadDemoFaces(): Promise<Partial<Record<Mood, string>>> {
  const out: Partial<Record<Mood, string>> = {};
  try {
    for (const mood of MOODS) {
      const saved = await withStore<Saved | undefined>("readonly", (s) => s.get(mood));
      if (!saved) continue;
      const cached = urlCache.get(mood);
      if (cached?.savedAt === saved.savedAt) {
        out[mood] = cached.url;
        continue;
      }
      if (cached) URL.revokeObjectURL(cached.url);
      const url = URL.createObjectURL(saved.blob);
      urlCache.set(mood, { savedAt: saved.savedAt, url });
      out[mood] = url;
    }
  } catch {
    /* private mode or blocked storage: demo falls back to emoji */
  }
  return out;
}

export const demoFaceStore: FaceStore = {
  load: loadDemoFaces,
  async save(mood, blob) {
    await withStore("readwrite", (s) => s.put({ blob, savedAt: Date.now() } satisfies Saved, mood));
  },
};
