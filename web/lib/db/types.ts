// Generated from the Supabase schema (project zvcnzikpnryoduuvzyio) via
// `mcp__supabase__generate_typescript_types`. Regenerate after any migration.
// Do not edit by hand.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      ad_sets: {
        Row: {
          advantage_audience: boolean;
          advantage_placements: boolean;
          billing_event: string;
          campaign_id: string;
          created_at: string;
          daily_budget_cents: number | null;
          destination_type: string | null;
          id: string;
          meta_ad_set_id: string;
          name: string;
          optimization_goal: string | null;
          raw_spec: Json | null;
          status: string;
          targeting: Json | null;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      ads: {
        Row: {
          ad_set_id: string;
          ads_manager_url: string | null;
          created_at: string;
          creative_id: string | null;
          effective_status: string | null;
          id: string;
          meta_ad_id: string;
          name: string;
          raw_spec: Json | null;
          status: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      analyses: {
        Row: {
          active_entities: number;
          client_id: string;
          compare_window_start: string | null;
          compare_window_stop: string | null;
          created_at: string;
          entities_analyzed: number;
          id: string;
          manifest_path: string | null;
          objective: string | null;
          overall_verdict: string;
          run_finished_at: string | null;
          run_started_at: string | null;
          summary: string | null;
          triggered_by: string;
          window_start: string | null;
          window_stop: string | null;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      analysis_findings: {
        Row: {
          analysis_id: string;
          client_id: string;
          confidence: string | null;
          created_at: string;
          diagnosis: string;
          entity_name: string | null;
          evidence: Json | null;
          id: string;
          is_significant: boolean;
          level: string | null;
          meta_entity_id: string | null;
          metric_focus: string | null;
          recommendation_type: string;
          recommended_action: string | null;
          severity: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      campaigns: {
        Row: {
          ads_manager_url: string | null;
          bid_strategy: string | null;
          budget_mode: string;
          buying_type: string;
          client_id: string;
          created_at: string;
          daily_budget_cents: number | null;
          id: string;
          meta_campaign_id: string;
          name: string;
          objective: string;
          raw_spec: Json | null;
          special_ad_categories: string[];
          status: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      clients: {
        Row: {
          ad_account_id: string;
          business_manager_id: string | null;
          created_at: string;
          currency: string;
          daily_budget_cap_cents: number;
          default_landing_url: string | null;
          facebook_page_id: string | null;
          id: string;
          materials_path: string | null;
          name: string;
          slug: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      agent_events: {
        Row: {
          agent_name: string;
          agent_type: string;
          client_id: string | null;
          created_at: string;
          event_type: string;
          id: string;
          payload: Json | null;
          run_id: string | null;
          summary: string | null;
          tool_name: string | null;
          ts: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      daily_summaries: {
        Row: {
          client_id: string;
          created_at: string;
          generated_at: string;
          id: string;
          model: string | null;
          structured: Json | null;
          summary: string;
          summary_date: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      creatives: {
        Row: {
          call_to_action_type: string | null;
          client_id: string;
          created_at: string;
          description: string | null;
          generated_image_id: string | null;
          headline: string | null;
          id: string;
          image_url: string | null;
          link_url: string | null;
          meta_creative_id: string;
          name: string | null;
          page_id: string | null;
          primary_text: string | null;
          raw_spec: Json | null;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      generated_images: {
        Row: {
          aspect: string | null;
          client_id: string;
          cost_usd_estimate: number | null;
          created_at: string;
          height: number | null;
          id: string;
          mime_type: string | null;
          model: string | null;
          prompt: string | null;
          storage_bucket: string;
          storage_path: string;
          updated_at: string;
          variant_key: string | null;
          width: number | null;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      metric_snapshots: {
        Row: {
          analysis_id: string;
          captured_at: string;
          client_id: string;
          conversion_rate_ranking: string | null;
          cost_per_result_cents: number | null;
          cpc_cents: number | null;
          cplpv_cents: number | null;
          cpm_cents: number | null;
          ctr: number | null;
          date_start: string | null;
          date_stop: string | null;
          engagement_rate_ranking: string | null;
          entity_name: string | null;
          frequency: number | null;
          id: string;
          impressions: number | null;
          landing_page_views: number | null;
          level: string;
          link_clicks: number | null;
          meta_entity_id: string;
          outbound_ctr: number | null;
          quality_ranking: string | null;
          raw: Json | null;
          reach: number | null;
          results: number | null;
          spend_cents: number | null;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      operation_logs: {
        Row: {
          action: string;
          actor: string;
          client_id: string | null;
          created_at: string;
          entity_id: string | null;
          entity_type: string;
          id: string;
          meta_entity_id: string | null;
          summary: string | null;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicTables = Database["public"]["Tables"];
export type Row<T extends keyof PublicTables> = PublicTables[T]["Row"];

export type Client = Row<"clients">;
export type Campaign = Row<"campaigns">;
export type AdSet = Row<"ad_sets">;
export type Ad = Row<"ads">;
export type Creative = Row<"creatives">;
export type GeneratedImage = Row<"generated_images">;
export type OperationLog = Row<"operation_logs">;
export type Analysis = Row<"analyses">;
export type MetricSnapshot = Row<"metric_snapshots">;
export type AnalysisFinding = Row<"analysis_findings">;
export type DailySummary = Row<"daily_summaries">;
export type AgentEvent = Row<"agent_events">;
