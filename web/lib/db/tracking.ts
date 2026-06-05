import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/lib/db/types";
import { db } from "@/lib/db/client";

// Local typing for the Phase-2 tracking tables (ADR 0021 / SPEC-015 §7.4), created by
// supabase/migrations/20260605000001_add_lp_tracking_secrets.sql and ..02_add_lp_events.sql.
// `web/lib/db/types.ts` is regenerated from the live schema and won't know these tables until
// the migration is applied + types regenerated; this module gives the server code precise types
// in the meantime WITHOUT hand-editing the generated file. Same underlying service-role client
// (bypasses RLS) — see client.ts. When types.ts gains these tables, drop this and use db().
type TrackingTables = {
  lp_tracking_secrets: {
    Row: {
      id: string;
      landing_page_id: string;
      provider: string;
      public_id: string;
      secret: Json;
      test_event_code: string | null;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      landing_page_id: string;
      provider: string;
      public_id: string;
      secret: Json;
      test_event_code?: string | null;
    };
    Update: {
      secret?: Json;
      test_event_code?: string | null;
    };
    Relationships: [];
  };
  lp_events: {
    Row: {
      id: number;
      event_id: string;
      landing_page_id: string | null;
      client_id: string | null;
      event_name: string;
      event_time: string;
      source_url: string | null;
      utm_source: string | null;
      utm_medium: string | null;
      utm_campaign: string | null;
      utm_content: string | null;
      utm_term: string | null;
      country: string | null;
      value: number | null;
      currency: string | null;
      meta_status: number | null;
      ga_status: number | null;
      ads_status: number | null;
      has_email: boolean;
      has_phone: boolean;
      created_at: string;
    };
    Insert: Record<string, never>; // written by the Worker (service role), not the web app
    Update: Record<string, never>;
    Relationships: [];
  };
};

type TrackingDatabase = {
  public: {
    Tables: TrackingTables;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

/** The shared service-role client, typed for the Phase-2 tracking tables. */
export function trackingDb(): SupabaseClient<TrackingDatabase> {
  return db() as unknown as SupabaseClient<TrackingDatabase>;
}
