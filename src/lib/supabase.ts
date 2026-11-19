import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isDemo = import.meta.env.VITE_DEMO === "1" || !url || !anonKey;

/** Null in demo mode. The anon key is public by design; RLS protects the data. */
export const supabase: SupabaseClient | null = isDemo ? null : createClient(url!, anonKey!);
