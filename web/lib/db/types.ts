// Generated from the Supabase schema (project zvcnzikpnryoduuvzyio) via
// `mcp__supabase__generate_typescript_types`. Regenerate after any migration.
// Do not edit by hand.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ad_sets: {
        Row: {
          advantage_audience: boolean
          advantage_placements: boolean
          billing_event: string
          campaign_id: string
          created_at: string
          daily_budget_cents: number | null
          destination_type: string | null
          id: string
          meta_ad_set_id: string
          name: string
          optimization_goal: string | null
          raw_spec: Json | null
          status: string
          targeting: Json | null
          updated_at: string
        }
        Insert: {
          advantage_audience?: boolean
          advantage_placements?: boolean
          billing_event?: string
          campaign_id: string
          created_at?: string
          daily_budget_cents?: number | null
          destination_type?: string | null
          id?: string
          meta_ad_set_id: string
          name: string
          optimization_goal?: string | null
          raw_spec?: Json | null
          status?: string
          targeting?: Json | null
          updated_at?: string
        }
        Update: {
          advantage_audience?: boolean
          advantage_placements?: boolean
          billing_event?: string
          campaign_id?: string
          created_at?: string
          daily_budget_cents?: number | null
          destination_type?: string | null
          id?: string
          meta_ad_set_id?: string
          name?: string
          optimization_goal?: string | null
          raw_spec?: Json | null
          status?: string
          targeting?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_sets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      ads: {
        Row: {
          ad_set_id: string
          ads_manager_url: string | null
          created_at: string
          creative_id: string | null
          effective_status: string | null
          id: string
          meta_ad_id: string
          name: string
          raw_spec: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          ad_set_id: string
          ads_manager_url?: string | null
          created_at?: string
          creative_id?: string | null
          effective_status?: string | null
          id?: string
          meta_ad_id: string
          name: string
          raw_spec?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          ad_set_id?: string
          ads_manager_url?: string | null
          created_at?: string
          creative_id?: string | null
          effective_status?: string | null
          id?: string
          meta_ad_id?: string
          name?: string
          raw_spec?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_ad_set_id_fkey"
            columns: ["ad_set_id"]
            isOneToOne: false
            referencedRelation: "ad_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "creatives"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_events: {
        Row: {
          agent_name: string
          agent_type: string
          client_id: string | null
          created_at: string
          event_type: string
          id: string
          payload: Json | null
          run_id: string | null
          summary: string | null
          tool_name: string | null
          ts: string
        }
        Insert: {
          agent_name: string
          agent_type: string
          client_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          payload?: Json | null
          run_id?: string | null
          summary?: string | null
          tool_name?: string | null
          ts?: string
        }
        Update: {
          agent_name?: string
          agent_type?: string
          client_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json | null
          run_id?: string | null
          summary?: string | null
          tool_name?: string | null
          ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_jobs: {
        Row: {
          args: Json
          claimed_at: string | null
          claimed_by: string | null
          client_id: string
          confirmed_at: string
          created_at: string
          error: string | null
          exit_code: number | null
          finished_at: string | null
          id: string
          kind: string
          landing_page_id: string | null
          operator_id: string | null
          requested_by: string
          result: Json | null
          skill: string
          started_at: string | null
          status: string
        }
        Insert: {
          args?: Json
          claimed_at?: string | null
          claimed_by?: string | null
          client_id: string
          confirmed_at?: string
          created_at?: string
          error?: string | null
          exit_code?: number | null
          finished_at?: string | null
          id?: string
          kind: string
          landing_page_id?: string | null
          operator_id?: string | null
          requested_by?: string
          result?: Json | null
          skill: string
          started_at?: string | null
          status?: string
        }
        Update: {
          args?: Json
          claimed_at?: string | null
          claimed_by?: string | null
          client_id?: string
          confirmed_at?: string
          created_at?: string
          error?: string | null
          exit_code?: number | null
          finished_at?: string | null
          id?: string
          kind?: string
          landing_page_id?: string | null
          operator_id?: string | null
          requested_by?: string
          result?: Json | null
          skill?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_jobs_landing_page_id_fkey"
            columns: ["landing_page_id"]
            isOneToOne: false
            referencedRelation: "landing_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_jobs_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      analyses: {
        Row: {
          active_entities: number
          client_id: string
          compare_window_start: string | null
          compare_window_stop: string | null
          created_at: string
          entities_analyzed: number
          id: string
          manifest_path: string | null
          objective: string | null
          overall_verdict: string
          run_finished_at: string | null
          run_started_at: string | null
          summary: string | null
          triggered_by: string
          window_start: string | null
          window_stop: string | null
        }
        Insert: {
          active_entities?: number
          client_id: string
          compare_window_start?: string | null
          compare_window_stop?: string | null
          created_at?: string
          entities_analyzed?: number
          id?: string
          manifest_path?: string | null
          objective?: string | null
          overall_verdict: string
          run_finished_at?: string | null
          run_started_at?: string | null
          summary?: string | null
          triggered_by?: string
          window_start?: string | null
          window_stop?: string | null
        }
        Update: {
          active_entities?: number
          client_id?: string
          compare_window_start?: string | null
          compare_window_stop?: string | null
          created_at?: string
          entities_analyzed?: number
          id?: string
          manifest_path?: string | null
          objective?: string | null
          overall_verdict?: string
          run_finished_at?: string | null
          run_started_at?: string | null
          summary?: string | null
          triggered_by?: string
          window_start?: string | null
          window_stop?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analyses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_findings: {
        Row: {
          analysis_id: string
          client_id: string
          confidence: string | null
          created_at: string
          diagnosis: string
          entity_name: string | null
          evidence: Json | null
          id: string
          is_significant: boolean
          level: string | null
          meta_entity_id: string | null
          metric_focus: string | null
          recommendation_type: string
          recommended_action: string | null
          severity: string
        }
        Insert: {
          analysis_id: string
          client_id: string
          confidence?: string | null
          created_at?: string
          diagnosis: string
          entity_name?: string | null
          evidence?: Json | null
          id?: string
          is_significant?: boolean
          level?: string | null
          meta_entity_id?: string | null
          metric_focus?: string | null
          recommendation_type: string
          recommended_action?: string | null
          severity: string
        }
        Update: {
          analysis_id?: string
          client_id?: string
          confidence?: string | null
          created_at?: string
          diagnosis?: string
          entity_name?: string | null
          evidence?: Json | null
          id?: string
          is_significant?: boolean
          level?: string | null
          meta_entity_id?: string | null
          metric_focus?: string | null
          recommendation_type?: string
          recommended_action?: string | null
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_findings_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analysis_findings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      autonomous_watches: {
        Row: {
          agent_job_id: string | null
          client_id: string
          closed_at: string | null
          created_at: string
          id: string
          last_event_ts: string | null
          last_narrated_milestone: string | null
          phase: string
          publish_job_id: string | null
          result: Json
          session_id: string
          started_by: string
          target_hint: string | null
          target_id: string | null
          target_kind: string
          updated_at: string
        }
        Insert: {
          agent_job_id?: string | null
          client_id: string
          closed_at?: string | null
          created_at?: string
          id?: string
          last_event_ts?: string | null
          last_narrated_milestone?: string | null
          phase?: string
          publish_job_id?: string | null
          result?: Json
          session_id: string
          started_by?: string
          target_hint?: string | null
          target_id?: string | null
          target_kind?: string
          updated_at?: string
        }
        Update: {
          agent_job_id?: string | null
          client_id?: string
          closed_at?: string | null
          created_at?: string
          id?: string
          last_event_ts?: string | null
          last_narrated_milestone?: string | null
          phase?: string
          publish_job_id?: string | null
          result?: Json
          session_id?: string
          started_by?: string
          target_hint?: string | null
          target_id?: string | null
          target_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "autonomous_watches_agent_job_id_fkey"
            columns: ["agent_job_id"]
            isOneToOne: false
            referencedRelation: "agent_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autonomous_watches_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autonomous_watches_publish_job_id_fkey"
            columns: ["publish_job_id"]
            isOneToOne: false
            referencedRelation: "agent_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          ads_manager_url: string | null
          bid_strategy: string | null
          budget_mode: string
          buying_type: string
          client_id: string
          created_at: string
          daily_budget_cents: number | null
          id: string
          meta_campaign_id: string
          name: string
          objective: string
          raw_spec: Json | null
          special_ad_categories: string[]
          status: string
          updated_at: string
        }
        Insert: {
          ads_manager_url?: string | null
          bid_strategy?: string | null
          budget_mode: string
          buying_type?: string
          client_id: string
          created_at?: string
          daily_budget_cents?: number | null
          id?: string
          meta_campaign_id: string
          name: string
          objective: string
          raw_spec?: Json | null
          special_ad_categories?: string[]
          status?: string
          updated_at?: string
        }
        Update: {
          ads_manager_url?: string | null
          bid_strategy?: string | null
          budget_mode?: string
          buying_type?: string
          client_id?: string
          created_at?: string
          daily_budget_cents?: number | null
          id?: string
          meta_campaign_id?: string
          name?: string
          objective?: string
          raw_spec?: Json | null
          special_ad_categories?: string[]
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          ad_account_id: string
          business_manager_id: string | null
          created_at: string
          currency: string
          daily_budget_cap_cents: number
          default_landing_url: string | null
          facebook_page_id: string | null
          id: string
          materials_path: string | null
          name: string
          operator_id: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          ad_account_id: string
          business_manager_id?: string | null
          created_at?: string
          currency?: string
          daily_budget_cap_cents?: number
          default_landing_url?: string | null
          facebook_page_id?: string | null
          id?: string
          materials_path?: string | null
          name: string
          operator_id?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          ad_account_id?: string
          business_manager_id?: string | null
          created_at?: string
          currency?: string
          daily_budget_cap_cents?: number
          default_landing_url?: string | null
          facebook_page_id?: string | null
          id?: string
          materials_path?: string | null
          name?: string
          operator_id?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      creatives: {
        Row: {
          call_to_action_type: string | null
          client_id: string
          created_at: string
          creative_type: string
          description: string | null
          generated_image_id: string | null
          headline: string | null
          id: string
          image_url: string | null
          link_url: string | null
          meta_creative_id: string
          meta_video_id: string | null
          name: string | null
          page_id: string | null
          primary_text: string | null
          raw_spec: Json | null
          updated_at: string
        }
        Insert: {
          call_to_action_type?: string | null
          client_id: string
          created_at?: string
          creative_type?: string
          description?: string | null
          generated_image_id?: string | null
          headline?: string | null
          id?: string
          image_url?: string | null
          link_url?: string | null
          meta_creative_id: string
          meta_video_id?: string | null
          name?: string | null
          page_id?: string | null
          primary_text?: string | null
          raw_spec?: Json | null
          updated_at?: string
        }
        Update: {
          call_to_action_type?: string | null
          client_id?: string
          created_at?: string
          creative_type?: string
          description?: string | null
          generated_image_id?: string | null
          headline?: string | null
          id?: string
          image_url?: string | null
          link_url?: string | null
          meta_creative_id?: string
          meta_video_id?: string | null
          name?: string | null
          page_id?: string | null
          primary_text?: string | null
          raw_spec?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "creatives_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creatives_generated_image_id_fkey"
            columns: ["generated_image_id"]
            isOneToOne: false
            referencedRelation: "generated_images"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_summaries: {
        Row: {
          client_id: string
          created_at: string
          generated_at: string
          id: string
          model: string | null
          structured: Json | null
          summary: string
          summary_date: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          generated_at?: string
          id?: string
          model?: string | null
          structured?: Json | null
          summary: string
          summary_date: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          generated_at?: string
          id?: string
          model?: string | null
          structured?: Json | null
          summary?: string
          summary_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_summaries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_events: {
        Row: {
          analysis_id: string
          captured_at: string
          client_id: string
          cost_per_event_cents: number | null
          count: number
          cvr_from_prev: number | null
          cvr_from_top: number | null
          date_start: string | null
          date_stop: string | null
          entity_name: string | null
          event_type: string
          id: string
          level: string
          meta_entity_id: string
          objective: string | null
          raw: Json | null
          step_order: number
          value_cents: number | null
        }
        Insert: {
          analysis_id: string
          captured_at?: string
          client_id: string
          cost_per_event_cents?: number | null
          count?: number
          cvr_from_prev?: number | null
          cvr_from_top?: number | null
          date_start?: string | null
          date_stop?: string | null
          entity_name?: string | null
          event_type: string
          id?: string
          level: string
          meta_entity_id: string
          objective?: string | null
          raw?: Json | null
          step_order: number
          value_cents?: number | null
        }
        Update: {
          analysis_id?: string
          captured_at?: string
          client_id?: string
          cost_per_event_cents?: number | null
          count?: number
          cvr_from_prev?: number | null
          cvr_from_top?: number | null
          date_start?: string | null
          date_stop?: string | null
          entity_name?: string | null
          event_type?: string
          id?: string
          level?: string
          meta_entity_id?: string
          objective?: string | null
          raw?: Json | null
          step_order?: number
          value_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "funnel_events_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_images: {
        Row: {
          aspect: string | null
          client_id: string
          cost_usd_estimate: number | null
          created_at: string
          height: number | null
          id: string
          mime_type: string | null
          model: string | null
          prompt: string | null
          storage_bucket: string
          storage_path: string
          updated_at: string
          variant_key: string | null
          width: number | null
        }
        Insert: {
          aspect?: string | null
          client_id: string
          cost_usd_estimate?: number | null
          created_at?: string
          height?: number | null
          id?: string
          mime_type?: string | null
          model?: string | null
          prompt?: string | null
          storage_bucket: string
          storage_path: string
          updated_at?: string
          variant_key?: string | null
          width?: number | null
        }
        Update: {
          aspect?: string | null
          client_id?: string
          cost_usd_estimate?: number | null
          created_at?: string
          height?: number | null
          id?: string
          mime_type?: string | null
          model?: string | null
          prompt?: string | null
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
          variant_key?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "generated_images_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_videos: {
        Row: {
          aspect: string | null
          channel: string | null
          client_id: string
          cost_credits: number | null
          created_at: string
          credits_used: number | null
          duration_seconds: number | null
          generate_audio: boolean | null
          id: string
          mime_type: string | null
          mode: string | null
          model: string | null
          prompt: string | null
          public_url: string | null
          quality_tier: string | null
          resolution: string | null
          seed: number | null
          seedance_task_id: string | null
          storage_bucket: string
          storage_path: string
          updated_at: string
          variant_key: string | null
        }
        Insert: {
          aspect?: string | null
          channel?: string | null
          client_id: string
          cost_credits?: number | null
          created_at?: string
          credits_used?: number | null
          duration_seconds?: number | null
          generate_audio?: boolean | null
          id?: string
          mime_type?: string | null
          mode?: string | null
          model?: string | null
          prompt?: string | null
          public_url?: string | null
          quality_tier?: string | null
          resolution?: string | null
          seed?: number | null
          seedance_task_id?: string | null
          storage_bucket: string
          storage_path: string
          updated_at?: string
          variant_key?: string | null
        }
        Update: {
          aspect?: string | null
          channel?: string | null
          client_id?: string
          cost_credits?: number | null
          created_at?: string
          credits_used?: number | null
          duration_seconds?: number | null
          generate_audio?: boolean | null
          id?: string
          mime_type?: string | null
          mode?: string | null
          model?: string | null
          prompt?: string | null
          public_url?: string | null
          quality_tier?: string | null
          resolution?: string | null
          seed?: number | null
          seedance_task_id?: string | null
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
          variant_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "generated_videos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      landing_page_sections: {
        Row: {
          created_at: string
          enabled: boolean
          fields: Json
          id: string
          landing_page_id: string
          position: number
          type: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          fields?: Json
          id?: string
          landing_page_id: string
          position: number
          type: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          enabled?: boolean
          fields?: Json
          id?: string
          landing_page_id?: string
          position?: number
          type?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "landing_page_sections_landing_page_id_fkey"
            columns: ["landing_page_id"]
            isOneToOne: false
            referencedRelation: "landing_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      landing_pages: {
        Row: {
          cart_state: string
          checkout_url: string | null
          client_id: string
          cloudflare_project_id: string | null
          content_spec: Json
          created_at: string
          deployed_at: string | null
          draft_status: string
          fqdn: string
          id: string
          last_deploy_id: string | null
          name: string
          noindex: boolean
          price_cents: number | null
          product_id: string | null
          published_at: string | null
          published_snapshot: Json | null
          raw_spec: Json | null
          repo_path: string
          settings: Json
          ssl_status: string
          status: string
          subdomain: string
          theme: Json
          tracking: Json
          updated_at: string
          url: string
        }
        Insert: {
          cart_state?: string
          checkout_url?: string | null
          client_id: string
          cloudflare_project_id?: string | null
          content_spec?: Json
          created_at?: string
          deployed_at?: string | null
          draft_status?: string
          fqdn: string
          id?: string
          last_deploy_id?: string | null
          name: string
          noindex?: boolean
          price_cents?: number | null
          product_id?: string | null
          published_at?: string | null
          published_snapshot?: Json | null
          raw_spec?: Json | null
          repo_path: string
          settings?: Json
          ssl_status?: string
          status?: string
          subdomain: string
          theme?: Json
          tracking?: Json
          updated_at?: string
          url: string
        }
        Update: {
          cart_state?: string
          checkout_url?: string | null
          client_id?: string
          cloudflare_project_id?: string | null
          content_spec?: Json
          created_at?: string
          deployed_at?: string | null
          draft_status?: string
          fqdn?: string
          id?: string
          last_deploy_id?: string | null
          name?: string
          noindex?: boolean
          price_cents?: number | null
          product_id?: string | null
          published_at?: string | null
          published_snapshot?: Json | null
          raw_spec?: Json | null
          repo_path?: string
          settings?: Json
          ssl_status?: string
          status?: string
          subdomain?: string
          theme?: Json
          tracking?: Json
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "landing_pages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "landing_pages_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      lp_events: {
        Row: {
          ads_status: number | null
          client_id: string | null
          country: string | null
          created_at: string
          currency: string | null
          event_id: string
          event_name: string
          event_time: string
          ga_status: number | null
          has_email: boolean
          has_phone: boolean
          id: number
          landing_page_id: string | null
          meta_status: number | null
          source_url: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          value: number | null
        }
        Insert: {
          ads_status?: number | null
          client_id?: string | null
          country?: string | null
          created_at?: string
          currency?: string | null
          event_id: string
          event_name: string
          event_time: string
          ga_status?: number | null
          has_email?: boolean
          has_phone?: boolean
          id?: never
          landing_page_id?: string | null
          meta_status?: number | null
          source_url?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          value?: number | null
        }
        Update: {
          ads_status?: number | null
          client_id?: string | null
          country?: string | null
          created_at?: string
          currency?: string | null
          event_id?: string
          event_name?: string
          event_time?: string
          ga_status?: number | null
          has_email?: boolean
          has_phone?: boolean
          id?: never
          landing_page_id?: string | null
          meta_status?: number | null
          source_url?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lp_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lp_events_landing_page_id_fkey"
            columns: ["landing_page_id"]
            isOneToOne: false
            referencedRelation: "landing_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      lp_tracking_secrets: {
        Row: {
          created_at: string
          id: string
          landing_page_id: string
          provider: string
          public_id: string
          secret: Json
          test_event_code: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          landing_page_id: string
          provider: string
          public_id: string
          secret?: Json
          test_event_code?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          landing_page_id?: string
          provider?: string
          public_id?: string
          secret?: Json
          test_event_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lp_tracking_secrets_landing_page_id_fkey"
            columns: ["landing_page_id"]
            isOneToOne: false
            referencedRelation: "landing_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_snapshots: {
        Row: {
          analysis_id: string
          captured_at: string
          client_id: string
          conversion_rate_ranking: string | null
          cost_per_result_cents: number | null
          cpc_cents: number | null
          cplpv_cents: number | null
          cpm_cents: number | null
          ctr: number | null
          date_start: string | null
          date_stop: string | null
          engagement_rate_ranking: string | null
          entity_name: string | null
          frequency: number | null
          id: string
          impressions: number | null
          landing_page_views: number | null
          level: string
          link_clicks: number | null
          meta_entity_id: string
          outbound_ctr: number | null
          quality_ranking: string | null
          raw: Json | null
          reach: number | null
          results: number | null
          spend_cents: number | null
        }
        Insert: {
          analysis_id: string
          captured_at?: string
          client_id: string
          conversion_rate_ranking?: string | null
          cost_per_result_cents?: number | null
          cpc_cents?: number | null
          cplpv_cents?: number | null
          cpm_cents?: number | null
          ctr?: number | null
          date_start?: string | null
          date_stop?: string | null
          engagement_rate_ranking?: string | null
          entity_name?: string | null
          frequency?: number | null
          id?: string
          impressions?: number | null
          landing_page_views?: number | null
          level: string
          link_clicks?: number | null
          meta_entity_id: string
          outbound_ctr?: number | null
          quality_ranking?: string | null
          raw?: Json | null
          reach?: number | null
          results?: number | null
          spend_cents?: number | null
        }
        Update: {
          analysis_id?: string
          captured_at?: string
          client_id?: string
          conversion_rate_ranking?: string | null
          cost_per_result_cents?: number | null
          cpc_cents?: number | null
          cplpv_cents?: number | null
          cpm_cents?: number | null
          ctr?: number | null
          date_start?: string | null
          date_stop?: string | null
          engagement_rate_ranking?: string | null
          entity_name?: string | null
          frequency?: number | null
          id?: string
          impressions?: number | null
          landing_page_views?: number | null
          level?: string
          link_clicks?: number | null
          meta_entity_id?: string
          outbound_ctr?: number | null
          quality_ranking?: string | null
          raw?: Json | null
          reach?: number | null
          results?: number | null
          spend_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "metric_snapshots_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_snapshots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      operation_logs: {
        Row: {
          action: string
          actor: string
          client_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          meta_entity_id: string | null
          summary: string | null
        }
        Insert: {
          action: string
          actor?: string
          client_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          meta_entity_id?: string | null
          summary?: string | null
        }
        Update: {
          action?: string
          actor?: string
          client_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          meta_entity_id?: string | null
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operation_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      operators: {
        Row: {
          connectors_status: Json
          created_at: string
          display_name: string | null
          fly_app_name: string | null
          id: string
          runner_status: string
          status: string
          updated_at: string
        }
        Insert: {
          connectors_status?: Json
          created_at?: string
          display_name?: string | null
          fly_app_name?: string | null
          id: string
          runner_status?: string
          status?: string
          updated_at?: string
        }
        Update: {
          connectors_status?: Json
          created_at?: string
          display_name?: string | null
          fly_app_name?: string | null
          id?: string
          runner_status?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          brief: Json
          brief_path: string | null
          client_id: string
          created_at: string
          default_subdomain: string | null
          id: string
          name: string
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          brief?: Json
          brief_path?: string | null
          client_id: string
          created_at?: string
          default_subdomain?: string | null
          id?: string
          name: string
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          brief?: Json
          brief_path?: string | null
          client_id?: string
          created_at?: string
          default_subdomain?: string | null
          id?: string
          name?: string
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      ultron_narrations: {
        Row: {
          created_at: string
          id: string
          image_path: string | null
          kind: string
          session_id: string
          spoken_at: string | null
          text: string
          ts: string
          watch_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_path?: string | null
          kind?: string
          session_id: string
          spoken_at?: string | null
          text: string
          ts?: string
          watch_id: string
        }
        Update: {
          created_at?: string
          id?: string
          image_path?: string | null
          kind?: string
          session_id?: string
          spoken_at?: string | null
          text?: string
          ts?: string
          watch_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ultron_narrations_watch_id_fkey"
            columns: ["watch_id"]
            isOneToOne: false
            referencedRelation: "autonomous_watches"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_agent_job:
        | {
            Args: { p_worker_id: string }
            Returns: {
              args: Json
              claimed_at: string | null
              claimed_by: string | null
              client_id: string
              confirmed_at: string
              created_at: string
              error: string | null
              exit_code: number | null
              finished_at: string | null
              id: string
              kind: string
              landing_page_id: string | null
              operator_id: string | null
              requested_by: string
              result: Json | null
              skill: string
              started_at: string | null
              status: string
            }[]
            SetofOptions: {
              from: "*"
              to: "agent_jobs"
              isOneToOne: false
              isSetofReturn: true
            }
          }
        | {
            Args: { p_operator_id: string; p_worker_id: string }
            Returns: {
              args: Json
              claimed_at: string | null
              claimed_by: string | null
              client_id: string
              confirmed_at: string
              created_at: string
              error: string | null
              exit_code: number | null
              finished_at: string | null
              id: string
              kind: string
              landing_page_id: string | null
              operator_id: string | null
              requested_by: string
              result: Json | null
              skill: string
              started_at: string | null
              status: string
            }[]
            SetofOptions: {
              from: "*"
              to: "agent_jobs"
              isOneToOne: false
              isSetofReturn: true
            }
          }
      claim_autonomous_watch: {
        Args: { p_worker_id: string }
        Returns: {
          agent_job_id: string | null
          client_id: string
          closed_at: string | null
          created_at: string
          id: string
          last_event_ts: string | null
          last_narrated_milestone: string | null
          phase: string
          publish_job_id: string | null
          result: Json
          session_id: string
          started_by: string
          target_hint: string | null
          target_id: string | null
          target_kind: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "autonomous_watches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      operator_owns_client: { Args: { p_client_id: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

// ---------------------------------------------------------------------------
// Convenience Row aliases (hand-maintained — NOT emitted by the generator above).
// Keep in sync when tables are added. Used by the read services and Ultron tools.
// ---------------------------------------------------------------------------
type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"]

export type Operator = Row<"operators">
export type Client = Row<"clients">
export type Campaign = Row<"campaigns">
export type AdSet = Row<"ad_sets">
export type Ad = Row<"ads">
export type Creative = Row<"creatives">
export type GeneratedImage = Row<"generated_images">
export type OperationLog = Row<"operation_logs">
export type Analysis = Row<"analyses">
export type MetricSnapshot = Row<"metric_snapshots">
export type AnalysisFinding = Row<"analysis_findings">
export type FunnelEvent = Row<"funnel_events">
export type DailySummary = Row<"daily_summaries">
export type AgentEvent = Row<"agent_events">
export type AgentJob = Row<"agent_jobs">
export type Product = Row<"products">
export type LandingPage = Row<"landing_pages">
export type LandingPageSection = Row<"landing_page_sections">
