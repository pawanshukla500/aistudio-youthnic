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
      ai_runs: {
        Row: {
          attempt_number: number | null
          batch_id: string | null
          cached_content_token_count: number | null
          cost_source: string
          cost_usd: number
          created_at: string
          error_message: string
          flow_node_id: string | null
          generation_epoch: number | null
          generation_id: string | null
          id: string
          input_fingerprint: string
          input_image_tokens: number
          input_summary: Json
          input_text_tokens: number
          input_tokens: number
          job_id: string
          latency_ms: number | null
          media_resolution: string | null
          model: string
          organization_id: string | null
          output_json: Json
          output_tokens: number
          planning_request_id: string | null
          pose_index: number | null
          prompt_version_id: string | null
          provider: string
          provider_request_id: string
          purpose: string | null
          run_kind: string
          session_id: string | null
          status: string
          thinking_level: string | null
          thoughts_token_count: number | null
          total_tokens: number
          usage_json: Json
          usage_payload: Json
        }
        Insert: {
          attempt_number?: number | null
          batch_id?: string | null
          cached_content_token_count?: number | null
          cost_source?: string
          cost_usd?: number
          created_at?: string
          error_message?: string
          flow_node_id?: string | null
          generation_epoch?: number | null
          generation_id?: string | null
          id?: string
          input_fingerprint?: string
          input_image_tokens?: number
          input_summary?: Json
          input_text_tokens?: number
          input_tokens?: number
          job_id?: string
          latency_ms?: number | null
          media_resolution?: string | null
          model?: string
          organization_id?: string | null
          output_json?: Json
          output_tokens?: number
          planning_request_id?: string | null
          pose_index?: number | null
          prompt_version_id?: string | null
          provider?: string
          provider_request_id?: string
          purpose?: string | null
          run_kind: string
          session_id?: string | null
          status?: string
          thinking_level?: string | null
          thoughts_token_count?: number | null
          total_tokens?: number
          usage_json?: Json
          usage_payload?: Json
        }
        Update: {
          attempt_number?: number | null
          batch_id?: string | null
          cached_content_token_count?: number | null
          cost_source?: string
          cost_usd?: number
          created_at?: string
          error_message?: string
          flow_node_id?: string | null
          generation_epoch?: number | null
          generation_id?: string | null
          id?: string
          input_fingerprint?: string
          input_image_tokens?: number
          input_summary?: Json
          input_text_tokens?: number
          input_tokens?: number
          job_id?: string
          latency_ms?: number | null
          media_resolution?: string | null
          model?: string
          organization_id?: string | null
          output_json?: Json
          output_tokens?: number
          planning_request_id?: string | null
          pose_index?: number | null
          prompt_version_id?: string | null
          provider?: string
          provider_request_id?: string
          purpose?: string | null
          run_kind?: string
          session_id?: string | null
          status?: string
          thinking_level?: string | null
          thoughts_token_count?: number | null
          total_tokens?: number
          usage_json?: Json
          usage_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ai_runs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "planning_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_runs_planning_request_id_fkey"
            columns: ["planning_request_id"]
            isOneToOne: false
            referencedRelation: "planning_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_runs_prompt_version_id_fkey"
            columns: ["prompt_version_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_cache: {
        Row: {
          cache_key: string
          cache_kind: string
          created_at: string
          expires_at: string | null
          hit_count: number
          id: string
          legacy_convex_id: string | null
          org_key: string
          organization_id: string | null
          payload: Json
          product_category: string
          sku_name: string
          updated_at: string
        }
        Insert: {
          cache_key: string
          cache_kind: string
          created_at?: string
          expires_at?: string | null
          hit_count?: number
          id?: string
          legacy_convex_id?: string | null
          org_key?: string
          organization_id?: string | null
          payload?: Json
          product_category?: string
          sku_name?: string
          updated_at?: string
        }
        Update: {
          cache_key?: string
          cache_kind?: string
          created_at?: string
          expires_at?: string | null
          hit_count?: number
          id?: string
          legacy_convex_id?: string | null
          org_key?: string
          organization_id?: string | null
          payload?: Json
          product_category?: string
          sku_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      app_audit_logs: {
        Row: {
          action: string
          actor_email: string
          actor_uid: string
          created_at: string
          id: string
          metadata: Json
          target_id: string
          target_type: string
        }
        Insert: {
          action: string
          actor_email?: string
          actor_uid?: string
          created_at?: string
          id?: string
          metadata?: Json
          target_id?: string
          target_type?: string
        }
        Update: {
          action?: string
          actor_email?: string
          actor_uid?: string
          created_at?: string
          id?: string
          metadata?: Json
          target_id?: string
          target_type?: string
        }
        Relationships: []
      }
      app_migration_archive: {
        Row: {
          destination_id: string | null
          destination_table: string | null
          migrated_at: string
          payload: Json
          source_id: string
          source_system: string
          source_table: string
        }
        Insert: {
          destination_id?: string | null
          destination_table?: string | null
          migrated_at?: string
          payload: Json
          source_id: string
          source_system?: string
          source_table: string
        }
        Update: {
          destination_id?: string | null
          destination_table?: string | null
          migrated_at?: string
          payload?: Json
          source_id?: string
          source_system?: string
          source_table?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string
          value?: Json
        }
        Relationships: []
      }
      app_system_settings: {
        Row: {
          id: string
          settings: Json
          updated_at: string
        }
        Insert: {
          id?: string
          settings?: Json
          updated_at?: string
        }
        Update: {
          id?: string
          settings?: Json
          updated_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_email: string
          actor_member_id: string | null
          created_at: string
          id: string
          legacy_convex_id: string | null
          metadata: Json
          organization_id: string | null
          resource_id: string
          resource_type: string
        }
        Insert: {
          action: string
          actor_email?: string
          actor_member_id?: string | null
          created_at?: string
          id?: string
          legacy_convex_id?: string | null
          metadata?: Json
          organization_id?: string | null
          resource_id?: string
          resource_type?: string
        }
        Update: {
          action?: string
          actor_email?: string
          actor_member_id?: string | null
          created_at?: string
          id?: string
          legacy_convex_id?: string | null
          metadata?: Json
          organization_id?: string | null
          resource_id?: string
          resource_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_member_id_fkey"
            columns: ["actor_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      batch_approvals: {
        Row: {
          action: string
          batch_id: string
          created_at: string
          decided_by_member_id: string | null
          id: string
          notes: string
          organization_id: string
          sku_summary: Json
        }
        Insert: {
          action: string
          batch_id: string
          created_at?: string
          decided_by_member_id?: string | null
          id?: string
          notes?: string
          organization_id: string
          sku_summary?: Json
        }
        Update: {
          action?: string
          batch_id?: string
          created_at?: string
          decided_by_member_id?: string | null
          id?: string
          notes?: string
          organization_id?: string
          sku_summary?: Json
        }
        Relationships: [
          {
            foreignKeyName: "batch_approvals_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "planning_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_approvals_decided_by_member_id_fkey"
            columns: ["decided_by_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_approvals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      batch_upload_jobs: {
        Row: {
          completed_rows: number
          created_at: string
          created_by: string | null
          failed_rows: number
          file_name: string
          id: string
          organization_id: string
          status: string
          total_rows: number
          updated_at: string
        }
        Insert: {
          completed_rows?: number
          created_at?: string
          created_by?: string | null
          failed_rows?: number
          file_name: string
          id?: string
          organization_id: string
          status?: string
          total_rows?: number
          updated_at?: string
        }
        Update: {
          completed_rows?: number
          created_at?: string
          created_by?: string | null
          failed_rows?: number
          file_name?: string
          id?: string
          organization_id?: string
          status?: string
          total_rows?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "batch_upload_jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_upload_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_asset_reviews: {
        Row: {
          asset_version_id: string | null
          comments: string
          created_at: string
          decision: string
          id: string
          metadata: Json
          organization_id: string
          review_scope: string
          reviewer_member_id: string | null
          work_item_id: string
        }
        Insert: {
          asset_version_id?: string | null
          comments?: string
          created_at?: string
          decision: string
          id?: string
          metadata?: Json
          organization_id: string
          review_scope?: string
          reviewer_member_id?: string | null
          work_item_id: string
        }
        Update: {
          asset_version_id?: string | null
          comments?: string
          created_at?: string
          decision?: string
          id?: string
          metadata?: Json
          organization_id?: string
          review_scope?: string
          reviewer_member_id?: string | null
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_asset_reviews_asset_version_id_fkey"
            columns: ["asset_version_id"]
            isOneToOne: false
            referencedRelation: "catalog_pose_asset_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_asset_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_asset_reviews_reviewer_member_id_fkey"
            columns: ["reviewer_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_asset_reviews_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_creative_directions: {
        Row: {
          background_backdrop: string
          composition: string
          created_at: string
          created_by_member_id: string | null
          id: string
          lighting: string
          look_and_mood: string
          marketplace_requirements: string
          metadata: Json
          model_direction: string
          organization_id: string
          pose_direction: Json
          styling_requirements: string
          updated_at: string
          work_item_id: string
        }
        Insert: {
          background_backdrop?: string
          composition?: string
          created_at?: string
          created_by_member_id?: string | null
          id?: string
          lighting?: string
          look_and_mood?: string
          marketplace_requirements?: string
          metadata?: Json
          model_direction?: string
          organization_id: string
          pose_direction?: Json
          styling_requirements?: string
          updated_at?: string
          work_item_id: string
        }
        Update: {
          background_backdrop?: string
          composition?: string
          created_at?: string
          created_by_member_id?: string | null
          id?: string
          lighting?: string
          look_and_mood?: string
          marketplace_requirements?: string
          metadata?: Json
          model_direction?: string
          organization_id?: string
          pose_direction?: Json
          styling_requirements?: string
          updated_at?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_creative_directions_created_by_member_id_fkey"
            columns: ["created_by_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_creative_directions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_creative_directions_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_handoff_settings: {
        Row: {
          business_weekdays: number[]
          created_at: string
          custom_recipients: string[]
          enabled: boolean
          holiday_dates: string[]
          id: string
          late_approval_policy: string
          organization_id: string
          recipient_mode: string
          recipient_role_slug: string
          recipient_team_id: string | null
          send_local_time: string
          timezone: string
          updated_at: string
          updated_by_member_id: string | null
        }
        Insert: {
          business_weekdays?: number[]
          created_at?: string
          custom_recipients?: string[]
          enabled?: boolean
          holiday_dates?: string[]
          id?: string
          late_approval_policy?: string
          organization_id: string
          recipient_mode?: string
          recipient_role_slug?: string
          recipient_team_id?: string | null
          send_local_time?: string
          timezone?: string
          updated_at?: string
          updated_by_member_id?: string | null
        }
        Update: {
          business_weekdays?: number[]
          created_at?: string
          custom_recipients?: string[]
          enabled?: boolean
          holiday_dates?: string[]
          id?: string
          late_approval_policy?: string
          organization_id?: string
          recipient_mode?: string
          recipient_role_slug?: string
          recipient_team_id?: string | null
          send_local_time?: string
          timezone?: string
          updated_at?: string
          updated_by_member_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_handoff_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_handoff_settings_recipient_team_id_fkey"
            columns: ["recipient_team_id"]
            isOneToOne: false
            referencedRelation: "organization_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_handoff_settings_updated_by_member_id_fkey"
            columns: ["updated_by_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_listing_handoff_assets: {
        Row: {
          asset_version_id: string
          created_at: string
          handoff_id: string
          id: string
          organization_id: string
          pose_index: number
        }
        Insert: {
          asset_version_id: string
          created_at?: string
          handoff_id: string
          id?: string
          organization_id: string
          pose_index: number
        }
        Update: {
          asset_version_id?: string
          created_at?: string
          handoff_id?: string
          id?: string
          organization_id?: string
          pose_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "catalog_listing_handoff_assets_asset_version_id_fkey"
            columns: ["asset_version_id"]
            isOneToOne: false
            referencedRelation: "catalog_pose_asset_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_listing_handoff_assets_handoff_id_fkey"
            columns: ["handoff_id"]
            isOneToOne: false
            referencedRelation: "catalog_listing_handoffs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_listing_handoff_assets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_listing_handoffs: {
        Row: {
          approval_revision: number
          approved_at: string
          approved_by_member_id: string | null
          created_at: string
          folder_key: string
          id: string
          listed_at: string | null
          listing_started_at: string | null
          organization_id: string
          remarks: string
          sent_at: string | null
          share_token: string
          status: string
          updated_at: string
          work_item_id: string
        }
        Insert: {
          approval_revision: number
          approved_at: string
          approved_by_member_id?: string | null
          created_at?: string
          folder_key: string
          id?: string
          listed_at?: string | null
          listing_started_at?: string | null
          organization_id: string
          remarks?: string
          sent_at?: string | null
          share_token?: string
          status?: string
          updated_at?: string
          work_item_id: string
        }
        Update: {
          approval_revision?: number
          approved_at?: string
          approved_by_member_id?: string | null
          created_at?: string
          folder_key?: string
          id?: string
          listed_at?: string | null
          listing_started_at?: string | null
          organization_id?: string
          remarks?: string
          sent_at?: string | null
          share_token?: string
          status?: string
          updated_at?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_listing_handoffs_approved_by_member_id_fkey"
            columns: ["approved_by_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_listing_handoffs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_listing_handoffs_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_pose_asset_versions: {
        Row: {
          approval_status: string
          approved_at: string | null
          approved_by_member_id: string | null
          created_at: string
          final_asset_url: string
          generated_at: string
          generation_id: string
          generation_job_id: string | null
          generation_status: string
          id: string
          model: string
          organization_id: string
          original_url: string
          pose_index: number
          preview_url: string
          prompt: string
          prompt_metadata: Json
          regeneration_metadata: Json
          reviewer_comments: string
          session_id: string
          storage_backend: string
          storage_path: string
          title: string
          updated_at: string
          version_number: number
          work_item_id: string
        }
        Insert: {
          approval_status?: string
          approved_at?: string | null
          approved_by_member_id?: string | null
          created_at?: string
          final_asset_url?: string
          generated_at?: string
          generation_id: string
          generation_job_id?: string | null
          generation_status?: string
          id?: string
          model?: string
          organization_id: string
          original_url?: string
          pose_index: number
          preview_url?: string
          prompt?: string
          prompt_metadata?: Json
          regeneration_metadata?: Json
          reviewer_comments?: string
          session_id: string
          storage_backend?: string
          storage_path?: string
          title?: string
          updated_at?: string
          version_number: number
          work_item_id: string
        }
        Update: {
          approval_status?: string
          approved_at?: string | null
          approved_by_member_id?: string | null
          created_at?: string
          final_asset_url?: string
          generated_at?: string
          generation_id?: string
          generation_job_id?: string | null
          generation_status?: string
          id?: string
          model?: string
          organization_id?: string
          original_url?: string
          pose_index?: number
          preview_url?: string
          prompt?: string
          prompt_metadata?: Json
          regeneration_metadata?: Json
          reviewer_comments?: string
          session_id?: string
          storage_backend?: string
          storage_path?: string
          title?: string
          updated_at?: string
          version_number?: number
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_pose_asset_versions_approved_by_member_id_fkey"
            columns: ["approved_by_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_pose_asset_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_pose_asset_versions_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_report_deliveries: {
        Row: {
          approved_from: string | null
          approved_to: string | null
          attempt_count: number
          created_at: string
          created_by_member_id: string | null
          delivery_key: string
          delivery_kind: string
          error_message: string
          id: string
          last_attempt_at: string | null
          next_retry_at: string | null
          organization_id: string
          payload: Json
          provider_message_id: string
          recipients: string[]
          report_date: string
          sent_at: string | null
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          approved_from?: string | null
          approved_to?: string | null
          attempt_count?: number
          created_at?: string
          created_by_member_id?: string | null
          delivery_key?: string
          delivery_kind?: string
          error_message?: string
          id?: string
          last_attempt_at?: string | null
          next_retry_at?: string | null
          organization_id: string
          payload?: Json
          provider_message_id?: string
          recipients?: string[]
          report_date: string
          sent_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Update: {
          approved_from?: string | null
          approved_to?: string | null
          attempt_count?: number
          created_at?: string
          created_by_member_id?: string | null
          delivery_key?: string
          delivery_kind?: string
          error_message?: string
          id?: string
          last_attempt_at?: string | null
          next_retry_at?: string | null
          organization_id?: string
          payload?: Json
          provider_message_id?: string
          recipients?: string[]
          report_date?: string
          sent_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_report_deliveries_created_by_member_id_fkey"
            columns: ["created_by_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_report_deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_report_delivery_attempts: {
        Row: {
          actor_member_id: string | null
          attempt_number: number
          completed_at: string | null
          delivery_id: string
          error_message: string
          id: string
          metadata: Json
          organization_id: string
          provider_message_id: string
          recipients: string[]
          started_at: string
          status: string
          trigger_type: string
        }
        Insert: {
          actor_member_id?: string | null
          attempt_number: number
          completed_at?: string | null
          delivery_id: string
          error_message?: string
          id?: string
          metadata?: Json
          organization_id: string
          provider_message_id?: string
          recipients?: string[]
          started_at?: string
          status?: string
          trigger_type?: string
        }
        Update: {
          actor_member_id?: string | null
          attempt_number?: number
          completed_at?: string | null
          delivery_id?: string
          error_message?: string
          id?: string
          metadata?: Json
          organization_id?: string
          provider_message_id?: string
          recipients?: string[]
          started_at?: string
          status?: string
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_report_delivery_attempts_actor_member_id_fkey"
            columns: ["actor_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_report_delivery_attempts_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "catalog_report_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_report_delivery_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_report_delivery_items: {
        Row: {
          delivery_id: string
          handoff_id: string
          id: string
          included_at: string
          organization_id: string
          sent_at: string | null
          work_item_id: string
        }
        Insert: {
          delivery_id: string
          handoff_id: string
          id?: string
          included_at?: string
          organization_id: string
          sent_at?: string | null
          work_item_id: string
        }
        Update: {
          delivery_id?: string
          handoff_id?: string
          id?: string
          included_at?: string
          organization_id?: string
          sent_at?: string | null
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_report_delivery_items_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "catalog_report_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_report_delivery_items_handoff_id_fkey"
            columns: ["handoff_id"]
            isOneToOne: true
            referencedRelation: "catalog_listing_handoffs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_report_delivery_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_report_delivery_items_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_sessions: {
        Row: {
          analysis_fingerprint: string
          created_at: string
          job_id: string
          legacy_convex_id: string | null
          organization_id: string | null
          planning_request_id: string | null
          product_hash: string
          reference_hash: string
          session_data: Json
          session_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          analysis_fingerprint?: string
          created_at?: string
          job_id?: string
          legacy_convex_id?: string | null
          organization_id?: string | null
          planning_request_id?: string | null
          product_hash?: string
          reference_hash?: string
          session_data?: Json
          session_id: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          analysis_fingerprint?: string
          created_at?: string
          job_id?: string
          legacy_convex_id?: string | null
          organization_id?: string | null
          planning_request_id?: string | null
          product_hash?: string
          reference_hash?: string
          session_data?: Json
          session_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_sessions_planning_request_id_fkey"
            columns: ["planning_request_id"]
            isOneToOne: false
            referencedRelation: "planning_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_work_item_assignments: {
        Row: {
          active: boolean
          assigned_at: string
          assigned_by_member_id: string | null
          assignment_type: string
          ended_at: string | null
          id: string
          member_id: string | null
          note: string
          organization_id: string
          work_item_id: string
        }
        Insert: {
          active?: boolean
          assigned_at?: string
          assigned_by_member_id?: string | null
          assignment_type: string
          ended_at?: string | null
          id?: string
          member_id?: string | null
          note?: string
          organization_id: string
          work_item_id: string
        }
        Update: {
          active?: boolean
          assigned_at?: string
          assigned_by_member_id?: string | null
          assignment_type?: string
          ended_at?: string | null
          id?: string
          member_id?: string | null
          note?: string
          organization_id?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_work_item_assignments_assigned_by_member_id_fkey"
            columns: ["assigned_by_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_work_item_assignments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_work_item_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_work_item_assignments_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_work_item_comments: {
        Row: {
          author_member_id: string | null
          body: string
          created_at: string
          deleted_at: string | null
          id: string
          organization_id: string
          updated_at: string
          visibility: string
          work_item_id: string
        }
        Insert: {
          author_member_id?: string | null
          body: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          organization_id: string
          updated_at?: string
          visibility?: string
          work_item_id: string
        }
        Update: {
          author_member_id?: string | null
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          organization_id?: string
          updated_at?: string
          visibility?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_work_item_comments_author_member_id_fkey"
            columns: ["author_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_work_item_comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_work_item_comments_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_work_item_events: {
        Row: {
          actor_member_id: string | null
          created_at: string
          duration_seconds: number | null
          event_type: string
          from_status: string | null
          id: string
          message: string
          metadata: Json
          organization_id: string
          related_asset_version_id: string | null
          source: string
          stage_code: string | null
          to_status: string | null
          work_item_id: string
        }
        Insert: {
          actor_member_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          event_type: string
          from_status?: string | null
          id?: string
          message?: string
          metadata?: Json
          organization_id: string
          related_asset_version_id?: string | null
          source?: string
          stage_code?: string | null
          to_status?: string | null
          work_item_id: string
        }
        Update: {
          actor_member_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          event_type?: string
          from_status?: string | null
          id?: string
          message?: string
          metadata?: Json
          organization_id?: string
          related_asset_version_id?: string | null
          source?: string
          stage_code?: string | null
          to_status?: string | null
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_work_item_events_actor_member_id_fkey"
            columns: ["actor_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_work_item_events_asset_version_fkey"
            columns: ["related_asset_version_id"]
            isOneToOne: false
            referencedRelation: "catalog_pose_asset_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_work_item_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_work_item_events_stage_code_fkey"
            columns: ["stage_code"]
            isOneToOne: false
            referencedRelation: "catalog_workflow_stage_definitions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "catalog_work_item_events_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_work_item_external_sources: {
        Row: {
          external_file_id: string | null
          external_request_id: string | null
          external_row_hash: string | null
          external_row_number: number | null
          external_sheet_id: string | null
          external_source: string
          external_tab_name: string | null
          id: string
          last_synced_at: string
          work_item_id: string
        }
        Insert: {
          external_file_id?: string | null
          external_request_id?: string | null
          external_row_hash?: string | null
          external_row_number?: number | null
          external_sheet_id?: string | null
          external_source?: string
          external_tab_name?: string | null
          id?: string
          last_synced_at?: string
          work_item_id: string
        }
        Update: {
          external_file_id?: string | null
          external_request_id?: string | null
          external_row_hash?: string | null
          external_row_number?: number | null
          external_sheet_id?: string | null
          external_source?: string
          external_tab_name?: string | null
          id?: string
          last_synced_at?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_work_item_external_sources_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_work_items: {
        Row: {
          ai_generation_remarks: string | null
          approval_revision: number
          archived_at: string | null
          asset_folder_key: string
          back_reference_image_url: string | null
          blocked_reason: string
          campaign_event_details: Json
          campaign_season: string | null
          catalog_session_id: string | null
          color_label: string | null
          completed_at: string | null
          created_at: string
          created_by_member_id: string | null
          current_step: string
          deadline_at: string | null
          event_id: string | null
          external_link: string | null
          failure_code: string
          final_approved_at: string | null
          final_approved_by_member_id: string | null
          generation_assigned_member_id: string | null
          generation_completed_at: string | null
          generation_job_id: string | null
          generation_started_at: string | null
          generation_status: string
          id: string
          in_house_brand: string | null
          legacy_external_link: string | null
          listing_action: string | null
          listing_assigned_member_id: string | null
          listing_completed_at: string | null
          listing_sent_at: string | null
          listing_started_at: string | null
          listing_status: string
          listing_team_remarks: string | null
          marketplace_brand: string | null
          marketplaces: string[]
          next_action: string
          organization_id: string
          planning_batch_id: string | null
          planning_request_id: string | null
          portal: string | null
          priority: string
          qc_status: string
          reference_image_url: string | null
          remarks: string | null
          request_code: string
          request_date: string
          shoot_reference_type: string | null
          sku_name: string
          special_instructions: string
          stage_started_at: string
          status: string
          theme: string | null
          updated_at: string
          work_mode: string
          work_type: string
          workflow_progress: number
          workflow_stage: string
        }
        Insert: {
          ai_generation_remarks?: string | null
          approval_revision?: number
          archived_at?: string | null
          asset_folder_key?: string
          back_reference_image_url?: string | null
          blocked_reason?: string
          campaign_event_details?: Json
          campaign_season?: string | null
          catalog_session_id?: string | null
          color_label?: string | null
          completed_at?: string | null
          created_at?: string
          created_by_member_id?: string | null
          current_step?: string
          deadline_at?: string | null
          event_id?: string | null
          external_link?: string | null
          failure_code?: string
          final_approved_at?: string | null
          final_approved_by_member_id?: string | null
          generation_assigned_member_id?: string | null
          generation_completed_at?: string | null
          generation_job_id?: string | null
          generation_started_at?: string | null
          generation_status?: string
          id?: string
          in_house_brand?: string | null
          legacy_external_link?: string | null
          listing_action?: string | null
          listing_assigned_member_id?: string | null
          listing_completed_at?: string | null
          listing_sent_at?: string | null
          listing_started_at?: string | null
          listing_status?: string
          listing_team_remarks?: string | null
          marketplace_brand?: string | null
          marketplaces?: string[]
          next_action?: string
          organization_id: string
          planning_batch_id?: string | null
          planning_request_id?: string | null
          portal?: string | null
          priority?: string
          qc_status?: string
          reference_image_url?: string | null
          remarks?: string | null
          request_code?: string
          request_date?: string
          shoot_reference_type?: string | null
          sku_name: string
          special_instructions?: string
          stage_started_at?: string
          status?: string
          theme?: string | null
          updated_at?: string
          work_mode?: string
          work_type?: string
          workflow_progress?: number
          workflow_stage?: string
        }
        Update: {
          ai_generation_remarks?: string | null
          approval_revision?: number
          archived_at?: string | null
          asset_folder_key?: string
          back_reference_image_url?: string | null
          blocked_reason?: string
          campaign_event_details?: Json
          campaign_season?: string | null
          catalog_session_id?: string | null
          color_label?: string | null
          completed_at?: string | null
          created_at?: string
          created_by_member_id?: string | null
          current_step?: string
          deadline_at?: string | null
          event_id?: string | null
          external_link?: string | null
          failure_code?: string
          final_approved_at?: string | null
          final_approved_by_member_id?: string | null
          generation_assigned_member_id?: string | null
          generation_completed_at?: string | null
          generation_job_id?: string | null
          generation_started_at?: string | null
          generation_status?: string
          id?: string
          in_house_brand?: string | null
          legacy_external_link?: string | null
          listing_action?: string | null
          listing_assigned_member_id?: string | null
          listing_completed_at?: string | null
          listing_sent_at?: string | null
          listing_started_at?: string | null
          listing_status?: string
          listing_team_remarks?: string | null
          marketplace_brand?: string | null
          marketplaces?: string[]
          next_action?: string
          organization_id?: string
          planning_batch_id?: string | null
          planning_request_id?: string | null
          portal?: string | null
          priority?: string
          qc_status?: string
          reference_image_url?: string | null
          remarks?: string | null
          request_code?: string
          request_date?: string
          shoot_reference_type?: string | null
          sku_name?: string
          special_instructions?: string
          stage_started_at?: string
          status?: string
          theme?: string | null
          updated_at?: string
          work_mode?: string
          work_type?: string
          workflow_progress?: number
          workflow_stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_work_items_created_by_member_id_fkey"
            columns: ["created_by_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_work_items_final_approved_by_member_id_fkey"
            columns: ["final_approved_by_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_work_items_generation_assigned_member_id_fkey"
            columns: ["generation_assigned_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_work_items_listing_assigned_member_id_fkey"
            columns: ["listing_assigned_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_work_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_work_items_planning_batch_id_fkey"
            columns: ["planning_batch_id"]
            isOneToOne: false
            referencedRelation: "planning_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_work_items_planning_request_id_fkey"
            columns: ["planning_request_id"]
            isOneToOne: false
            referencedRelation: "planning_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_workflow_stage_definitions: {
        Row: {
          code: string
          created_at: string
          default_next_action: string
          description: string
          group_key: string
          progress_percent: number
          stage_order: number
          terminal: boolean
          title: string
        }
        Insert: {
          code: string
          created_at?: string
          default_next_action?: string
          description?: string
          group_key: string
          progress_percent: number
          stage_order: number
          terminal?: boolean
          title: string
        }
        Update: {
          code?: string
          created_at?: string
          default_next_action?: string
          description?: string
          group_key?: string
          progress_percent?: number
          stage_order?: number
          terminal?: boolean
          title?: string
        }
        Relationships: []
      }
      event_automation_settings: {
        Row: {
          created_at: string
          id: string
          last_automation_at: string | null
          last_monthly_report_at: string | null
          last_usage_sync_at: string | null
          monthly_report_day: number
          monthly_report_enabled: boolean
          organization_id: string
          reminder_days_before: number
          reminder_enabled: boolean
          report_recipients: string[]
          research_enabled: boolean
          state_filters: string[]
          timezone: string
          updated_at: string
          updated_by_member_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          last_automation_at?: string | null
          last_monthly_report_at?: string | null
          last_usage_sync_at?: string | null
          monthly_report_day?: number
          monthly_report_enabled?: boolean
          organization_id: string
          reminder_days_before?: number
          reminder_enabled?: boolean
          report_recipients?: string[]
          research_enabled?: boolean
          state_filters?: string[]
          timezone?: string
          updated_at?: string
          updated_by_member_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          last_automation_at?: string | null
          last_monthly_report_at?: string | null
          last_usage_sync_at?: string | null
          monthly_report_day?: number
          monthly_report_enabled?: boolean
          organization_id?: string
          reminder_days_before?: number
          reminder_enabled?: boolean
          report_recipients?: string[]
          research_enabled?: boolean
          state_filters?: string[]
          timezone?: string
          updated_at?: string
          updated_by_member_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_automation_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_automation_settings_updated_by_member_id_fkey"
            columns: ["updated_by_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
        ]
      }
      event_email_deliveries: {
        Row: {
          created_at: string
          delivery_key: string
          delivery_kind: string
          error_message: string
          event_id: string | null
          id: string
          organization_id: string
          payload: Json
          provider_message_id: string
          recipients: string[]
          sent_at: string | null
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          delivery_key: string
          delivery_kind: string
          error_message?: string
          event_id?: string | null
          id?: string
          organization_id: string
          payload?: Json
          provider_message_id?: string
          recipients?: string[]
          sent_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          delivery_key?: string
          delivery_kind?: string
          error_message?: string
          event_id?: string | null
          id?: string
          organization_id?: string
          payload?: Json
          provider_message_id?: string
          recipients?: string[]
          sent_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_email_deliveries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "marketing_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_email_deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      event_research_runs: {
        Row: {
          error: string
          events_discovered: number
          events_upserted: number
          finished_at: string | null
          id: string
          model: string
          organization_id: string | null
          payload: Json
          run_kind: string
          started_at: string
          status: string
          summary: string
        }
        Insert: {
          error?: string
          events_discovered?: number
          events_upserted?: number
          finished_at?: string | null
          id?: string
          model?: string
          organization_id?: string | null
          payload?: Json
          run_kind?: string
          started_at?: string
          status?: string
          summary?: string
        }
        Update: {
          error?: string
          events_discovered?: number
          events_upserted?: number
          finished_at?: string | null
          id?: string
          model?: string
          organization_id?: string | null
          payload?: Json
          run_kind?: string
          started_at?: string
          status?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_research_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_events: {
        Row: {
          actor_member_id: string | null
          ai_run_id: string | null
          batch_id: string | null
          created_at: string
          event_type: string
          from_status: string | null
          id: string
          metadata: Json
          organization_id: string
          planning_request_id: string | null
          to_status: string | null
        }
        Insert: {
          actor_member_id?: string | null
          ai_run_id?: string | null
          batch_id?: string | null
          created_at?: string
          event_type: string
          from_status?: string | null
          id?: string
          metadata?: Json
          organization_id: string
          planning_request_id?: string | null
          to_status?: string | null
        }
        Update: {
          actor_member_id?: string | null
          ai_run_id?: string | null
          batch_id?: string | null
          created_at?: string
          event_type?: string
          from_status?: string | null
          id?: string
          metadata?: Json
          organization_id?: string
          planning_request_id?: string | null
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "execution_events_ai_run_id_fkey"
            columns: ["ai_run_id"]
            isOneToOne: false
            referencedRelation: "ai_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_events_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "planning_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_events_planning_request_id_fkey"
            columns: ["planning_request_id"]
            isOneToOne: false
            referencedRelation: "planning_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      fashion_knowledge_base: {
        Row: {
          category: string
          created_at: string
          guidance: string
          id: string
          is_active: boolean
          organization_id: string | null
          priority: number
          source: string
          tags: string[]
          title: string
          topic: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          guidance: string
          id?: string
          is_active?: boolean
          organization_id?: string | null
          priority?: number
          source?: string
          tags?: string[]
          title: string
          topic: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          guidance?: string
          id?: string
          is_active?: boolean
          organization_id?: string | null
          priority?: number
          source?: string
          tags?: string[]
          title?: string
          topic?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fashion_knowledge_base_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_flow_edges: {
        Row: {
          created_at: string
          id: string
          session_id: string
          source_node_id: string
          target_node_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          session_id: string
          source_node_id: string
          target_node_id: string
        }
        Update: {
          created_at?: string
          id?: string
          session_id?: string
          source_node_id?: string
          target_node_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_flow_edges_source_node_id_fkey"
            columns: ["source_node_id"]
            isOneToOne: false
            referencedRelation: "generation_flow_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_flow_edges_target_node_id_fkey"
            columns: ["target_node_id"]
            isOneToOne: false
            referencedRelation: "generation_flow_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_flow_nodes: {
        Row: {
          attempt: number
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          inputs: Json
          logs: string[]
          node_type: string
          outputs: Json
          session_id: string
          started_at: string | null
          status: string
        }
        Insert: {
          attempt?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          inputs?: Json
          logs?: string[]
          node_type: string
          outputs?: Json
          session_id: string
          started_at?: string | null
          status?: string
        }
        Update: {
          attempt?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          inputs?: Json
          logs?: string[]
          node_type?: string
          outputs?: Json
          session_id?: string
          started_at?: string | null
          status?: string
        }
        Relationships: []
      }
      generation_jobs: {
        Row: {
          actual_cost_usd: number
          aspect_ratio: string
          attempt_count: number
          available_at: string
          batch_id: string | null
          completed_at: string | null
          completed_poses: number
          created_at: string
          current_pose: number | null
          error_code: string
          error_message: string
          estimated_cost_usd: number
          failed_poses: number
          history_search: string | null
          image_size: string
          input_image_tokens: number
          input_text_tokens: number
          input_tokens: number
          job_data: Json
          job_id: string
          legacy_convex_id: string | null
          lock_expires_at: string | null
          locked_at: string | null
          model: string
          org_id: string
          output_tokens: number
          planning_request_id: string | null
          pose_qa: boolean
          provider: string
          quality: string
          readiness_reasons: Json
          readiness_status: string
          session_id: string
          sku_name: string
          source_type: string
          started_at: string | null
          status: string
          total_poses: number
          total_tokens: number
          updated_at: string
          user_email: string
          user_id: string
        }
        Insert: {
          actual_cost_usd?: number
          aspect_ratio?: string
          attempt_count?: number
          available_at?: string
          batch_id?: string | null
          completed_at?: string | null
          completed_poses?: number
          created_at?: string
          current_pose?: number | null
          error_code?: string
          error_message?: string
          estimated_cost_usd?: number
          failed_poses?: number
          history_search?: string | null
          image_size?: string
          input_image_tokens?: number
          input_text_tokens?: number
          input_tokens?: number
          job_data?: Json
          job_id: string
          legacy_convex_id?: string | null
          lock_expires_at?: string | null
          locked_at?: string | null
          model?: string
          org_id?: string
          output_tokens?: number
          planning_request_id?: string | null
          pose_qa?: boolean
          provider?: string
          quality?: string
          readiness_reasons?: Json
          readiness_status?: string
          session_id?: string
          sku_name?: string
          source_type?: string
          started_at?: string | null
          status?: string
          total_poses?: number
          total_tokens?: number
          updated_at?: string
          user_email?: string
          user_id: string
        }
        Update: {
          actual_cost_usd?: number
          aspect_ratio?: string
          attempt_count?: number
          available_at?: string
          batch_id?: string | null
          completed_at?: string | null
          completed_poses?: number
          created_at?: string
          current_pose?: number | null
          error_code?: string
          error_message?: string
          estimated_cost_usd?: number
          failed_poses?: number
          history_search?: string | null
          image_size?: string
          input_image_tokens?: number
          input_text_tokens?: number
          input_tokens?: number
          job_data?: Json
          job_id?: string
          legacy_convex_id?: string | null
          lock_expires_at?: string | null
          locked_at?: string | null
          model?: string
          org_id?: string
          output_tokens?: number
          planning_request_id?: string | null
          pose_qa?: boolean
          provider?: string
          quality?: string
          readiness_reasons?: Json
          readiness_status?: string
          session_id?: string
          sku_name?: string
          source_type?: string
          started_at?: string | null
          status?: string
          total_poses?: number
          total_tokens?: number
          updated_at?: string
          user_email?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_jobs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "planning_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_jobs_planning_request_id_fkey"
            columns: ["planning_request_id"]
            isOneToOne: false
            referencedRelation: "planning_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_learning_rules: {
        Row: {
          approved_at: string | null
          approved_by_member_id: string | null
          created_at: string
          created_by_member_id: string | null
          garment_family: string
          guidance: string
          id: string
          organization_id: string
          pose_id: string
          product_category: string
          reference_fingerprint: string
          review_note: string
          rule_kind: string
          scope: string
          source_learning_id: string | null
          source_qa_review_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by_member_id?: string | null
          created_at?: string
          created_by_member_id?: string | null
          garment_family: string
          guidance: string
          id?: string
          organization_id: string
          pose_id?: string
          product_category?: string
          reference_fingerprint?: string
          review_note?: string
          rule_kind: string
          scope: string
          source_learning_id?: string | null
          source_qa_review_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by_member_id?: string | null
          created_at?: string
          created_by_member_id?: string | null
          garment_family?: string
          guidance?: string
          id?: string
          organization_id?: string
          pose_id?: string
          product_category?: string
          reference_fingerprint?: string
          review_note?: string
          rule_kind?: string
          scope?: string
          source_learning_id?: string | null
          source_qa_review_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_learning_rules_approved_by_member_id_fkey"
            columns: ["approved_by_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_learning_rules_created_by_member_id_fkey"
            columns: ["created_by_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_learning_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_learning_rules_source_learning_id_fkey"
            columns: ["source_learning_id"]
            isOneToOne: false
            referencedRelation: "generation_learnings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_learning_rules_source_qa_review_id_fkey"
            columns: ["source_qa_review_id"]
            isOneToOne: false
            referencedRelation: "qa_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_learnings: {
        Row: {
          actual_cost_usd: number
          ai_run_id: string | null
          background_style: string
          catalog_key: string
          cost_source: string
          created_at: string
          failure_signals: Json
          footwear: string
          id: string
          job_id: string
          model: string
          organization_id: string | null
          pose_count: number
          pose_titles: string[]
          processing_time_ms: number
          product_category: string
          prompt_fingerprint: string
          prompt_version_id: string | null
          provider: string
          quality_score: number | null
          retry_count: number
          scene_summary: string
          session_id: string
          showcase_framing: string
          sku_name: string
          status: string
          success_signals: Json
          usage_json: Json
          user_feedback: string
          user_rating: number | null
        }
        Insert: {
          actual_cost_usd?: number
          ai_run_id?: string | null
          background_style?: string
          catalog_key?: string
          cost_source?: string
          created_at?: string
          failure_signals?: Json
          footwear?: string
          id?: string
          job_id?: string
          model?: string
          organization_id?: string | null
          pose_count?: number
          pose_titles?: string[]
          processing_time_ms?: number
          product_category?: string
          prompt_fingerprint?: string
          prompt_version_id?: string | null
          provider?: string
          quality_score?: number | null
          retry_count?: number
          scene_summary?: string
          session_id?: string
          showcase_framing?: string
          sku_name?: string
          status?: string
          success_signals?: Json
          usage_json?: Json
          user_feedback?: string
          user_rating?: number | null
        }
        Update: {
          actual_cost_usd?: number
          ai_run_id?: string | null
          background_style?: string
          catalog_key?: string
          cost_source?: string
          created_at?: string
          failure_signals?: Json
          footwear?: string
          id?: string
          job_id?: string
          model?: string
          organization_id?: string | null
          pose_count?: number
          pose_titles?: string[]
          processing_time_ms?: number
          product_category?: string
          prompt_fingerprint?: string
          prompt_version_id?: string | null
          provider?: string
          quality_score?: number | null
          retry_count?: number
          scene_summary?: string
          session_id?: string
          showcase_framing?: string
          sku_name?: string
          status?: string
          success_signals?: Json
          usage_json?: Json
          user_feedback?: string
          user_rating?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "generation_learnings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_daily_digests: {
        Row: {
          avg_quality: number | null
          catalog_key: string
          created_at: string
          digest_date: string
          guidance: string
          id: string
          jobs_completed: number
          jobs_failed: number
          knowledge_id: string | null
          metrics: Json
          organization_id: string | null
          product_category: string
          top_pose_titles: string[]
        }
        Insert: {
          avg_quality?: number | null
          catalog_key?: string
          created_at?: string
          digest_date: string
          guidance?: string
          id?: string
          jobs_completed?: number
          jobs_failed?: number
          knowledge_id?: string | null
          metrics?: Json
          organization_id?: string | null
          product_category?: string
          top_pose_titles?: string[]
        }
        Update: {
          avg_quality?: number | null
          catalog_key?: string
          created_at?: string
          digest_date?: string
          guidance?: string
          id?: string
          jobs_completed?: number
          jobs_failed?: number
          knowledge_id?: string | null
          metrics?: Json
          organization_id?: string | null
          product_category?: string
          top_pose_titles?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "learning_daily_digests_knowledge_id_fkey"
            columns: ["knowledge_id"]
            isOneToOne: false
            referencedRelation: "fashion_knowledge_base"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_daily_digests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_events: {
        Row: {
          applicable_states: string[]
          category: string
          color_palette: string[]
          confidence: number | null
          created_at: string
          description: string
          end_date: string | null
          id: string
          image_generation_status: string
          is_recurring: boolean
          knowledge_id: string | null
          legacy_convex_id: string | null
          name: string
          organization_id: string | null
          preparation_deadline: string | null
          priority: string
          recommended_categories: string[]
          research_payload: Json
          slug: string
          source: string
          source_detail: string
          start_date: string
          status: string
          styling_props: string[]
          target_marketplaces: string[]
          updated_at: string
          visual_themes: string[]
          year: number | null
        }
        Insert: {
          applicable_states?: string[]
          category?: string
          color_palette?: string[]
          confidence?: number | null
          created_at?: string
          description?: string
          end_date?: string | null
          id?: string
          image_generation_status?: string
          is_recurring?: boolean
          knowledge_id?: string | null
          legacy_convex_id?: string | null
          name: string
          organization_id?: string | null
          preparation_deadline?: string | null
          priority?: string
          recommended_categories?: string[]
          research_payload?: Json
          slug?: string
          source?: string
          source_detail?: string
          start_date: string
          status?: string
          styling_props?: string[]
          target_marketplaces?: string[]
          updated_at?: string
          visual_themes?: string[]
          year?: number | null
        }
        Update: {
          applicable_states?: string[]
          category?: string
          color_palette?: string[]
          confidence?: number | null
          created_at?: string
          description?: string
          end_date?: string | null
          id?: string
          image_generation_status?: string
          is_recurring?: boolean
          knowledge_id?: string | null
          legacy_convex_id?: string | null
          name?: string
          organization_id?: string | null
          preparation_deadline?: string | null
          priority?: string
          recommended_categories?: string[]
          research_payload?: Json
          slug?: string
          source?: string
          source_detail?: string
          start_date?: string
          status?: string
          styling_props?: string[]
          target_marketplaces?: string[]
          updated_at?: string
          visual_themes?: string[]
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_events_knowledge_id_fkey"
            columns: ["knowledge_id"]
            isOneToOne: false
            referencedRelation: "fashion_knowledge_base"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_campaign_catalog: {
        Row: {
          campaign_key: string
          color_palette: string[]
          created_at: string
          id: string
          marketplace: string
          name: string
          priority: string
          product_categories: string[]
          recurrence_notes: string
          typical_month_end: number | null
          typical_month_start: number | null
          visual_themes: string[]
        }
        Insert: {
          campaign_key: string
          color_palette?: string[]
          created_at?: string
          id?: string
          marketplace: string
          name: string
          priority?: string
          product_categories?: string[]
          recurrence_notes?: string
          typical_month_end?: number | null
          typical_month_start?: number | null
          visual_themes?: string[]
        }
        Update: {
          campaign_key?: string
          color_palette?: string[]
          created_at?: string
          id?: string
          marketplace?: string
          name?: string
          priority?: string
          product_categories?: string[]
          recurrence_notes?: string
          typical_month_end?: number | null
          typical_month_start?: number | null
          visual_themes?: string[]
        }
        Relationships: []
      }
      member_roles: {
        Row: {
          assigned_at: string
          assigned_by_member_id: string | null
          member_id: string
          role_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by_member_id?: string | null
          member_id: string
          role_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by_member_id?: string | null
          member_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_roles_assigned_by_member_id_fkey"
            columns: ["assigned_by_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_roles_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          batch_id: string | null
          body: string
          channel: string
          created_at: string
          created_by_member_id: string | null
          error: string
          event_id: string | null
          id: string
          legacy_convex_id: string | null
          organization_id: string
          payload: Json
          planning_request_id: string | null
          read_at: string | null
          recipient_email: string
          recipient_member_id: string | null
          recipient_team: string
          sent_at: string | null
          status: string
          title: string
          type: string
        }
        Insert: {
          batch_id?: string | null
          body?: string
          channel?: string
          created_at?: string
          created_by_member_id?: string | null
          error?: string
          event_id?: string | null
          id?: string
          legacy_convex_id?: string | null
          organization_id: string
          payload?: Json
          planning_request_id?: string | null
          read_at?: string | null
          recipient_email?: string
          recipient_member_id?: string | null
          recipient_team?: string
          sent_at?: string | null
          status?: string
          title?: string
          type: string
        }
        Update: {
          batch_id?: string | null
          body?: string
          channel?: string
          created_at?: string
          created_by_member_id?: string | null
          error?: string
          event_id?: string | null
          id?: string
          legacy_convex_id?: string | null
          organization_id?: string
          payload?: Json
          planning_request_id?: string | null
          read_at?: string | null
          recipient_email?: string
          recipient_member_id?: string | null
          recipient_team?: string
          sent_at?: string | null
          status?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "planning_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "marketing_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_planning_request_id_fkey"
            columns: ["planning_request_id"]
            isOneToOne: false
            referencedRelation: "planning_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_member_id_fkey"
            columns: ["recipient_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
        ]
      }
      openai_usage_daily: {
        Row: {
          actual_cost_usd: number
          cost_payload: Json
          currency: string
          dimension_key: string
          id: string
          image_count: number
          image_size: string
          model: string
          openai_project_id: string
          organization_id: string
          request_count: number
          source: string
          synced_at: string
          usage_date: string
          usage_payload: Json
        }
        Insert: {
          actual_cost_usd?: number
          cost_payload?: Json
          currency?: string
          dimension_key: string
          id?: string
          image_count?: number
          image_size?: string
          model?: string
          openai_project_id?: string
          organization_id: string
          request_count?: number
          source?: string
          synced_at?: string
          usage_date: string
          usage_payload?: Json
        }
        Update: {
          actual_cost_usd?: number
          cost_payload?: Json
          currency?: string
          dimension_key?: string
          id?: string
          image_count?: number
          image_size?: string
          model?: string
          openai_project_id?: string
          organization_id?: string
          request_count?: number
          source?: string
          synced_at?: string
          usage_date?: string
          usage_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "openai_usage_daily_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_ai_model_policies: {
        Row: {
          created_at: string
          fallback_enabled: boolean
          fallback_model: string | null
          fallback_provider: string | null
          fallback_reasoning: string | null
          id: string
          organization_id: string
          primary_model: string
          primary_provider: string
          primary_reasoning: string
          purpose: string
          revision: number
          updated_at: string
          updated_by_member_id: string | null
        }
        Insert: {
          created_at?: string
          fallback_enabled?: boolean
          fallback_model?: string | null
          fallback_provider?: string | null
          fallback_reasoning?: string | null
          id?: string
          organization_id: string
          primary_model: string
          primary_provider: string
          primary_reasoning?: string
          purpose: string
          revision?: number
          updated_at?: string
          updated_by_member_id?: string | null
        }
        Update: {
          created_at?: string
          fallback_enabled?: boolean
          fallback_model?: string | null
          fallback_provider?: string | null
          fallback_reasoning?: string | null
          id?: string
          organization_id?: string
          primary_model?: string
          primary_provider?: string
          primary_reasoning?: string
          purpose?: string
          revision?: number
          updated_at?: string
          updated_by_member_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_ai_model_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_ai_model_policies_updated_by_member_id_fkey"
            columns: ["updated_by_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_budgets: {
        Row: {
          created_at: string
          daily_limit: number
          is_enabled: boolean
          monthly_limit: number
          organization_id: string
          updated_at: string
          weekly_limit: number
        }
        Insert: {
          created_at?: string
          daily_limit?: number
          is_enabled?: boolean
          monthly_limit?: number
          organization_id: string
          updated_at?: string
          weekly_limit?: number
        }
        Update: {
          created_at?: string
          daily_limit?: number
          is_enabled?: boolean
          monthly_limit?: number
          organization_id?: string
          updated_at?: string
          weekly_limit?: number
        }
        Relationships: [
          {
            foreignKeyName: "organization_budgets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_member_notification_preferences: {
        Row: {
          catalog_assignments_in_app: boolean
          catalog_handoff_email: boolean
          created_at: string
          id: string
          member_id: string
          organization_id: string
          updated_at: string
          updated_by_member_id: string | null
        }
        Insert: {
          catalog_assignments_in_app?: boolean
          catalog_handoff_email?: boolean
          created_at?: string
          id?: string
          member_id: string
          organization_id: string
          updated_at?: string
          updated_by_member_id?: string | null
        }
        Update: {
          catalog_assignments_in_app?: boolean
          catalog_handoff_email?: boolean
          created_at?: string
          id?: string
          member_id?: string
          organization_id?: string
          updated_at?: string
          updated_by_member_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_member_notification_pref_updated_by_member_id_fkey"
            columns: ["updated_by_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_member_notification_preferenc_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_member_notification_preferences_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          display_name: string
          email: string
          firebase_uid: string
          id: string
          legacy_convex_id: string | null
          notification_preferences: Json
          organization_id: string
          profile: Json
          status: string
          supabase_uid: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string
          email: string
          firebase_uid: string
          id?: string
          legacy_convex_id?: string | null
          notification_preferences?: Json
          organization_id: string
          profile?: Json
          status?: string
          supabase_uid?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          email?: string
          firebase_uid?: string
          id?: string
          legacy_convex_id?: string | null
          notification_preferences?: Json
          organization_id?: string
          profile?: Json
          status?: string
          supabase_uid?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_team_memberships: {
        Row: {
          active: boolean
          created_at: string
          created_by_member_id: string | null
          ended_at: string | null
          id: string
          joined_at: string
          member_id: string
          membership_role: string
          organization_id: string
          team_id: string
          updated_at: string
          updated_by_member_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by_member_id?: string | null
          ended_at?: string | null
          id?: string
          joined_at?: string
          member_id: string
          membership_role?: string
          organization_id: string
          team_id: string
          updated_at?: string
          updated_by_member_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by_member_id?: string | null
          ended_at?: string | null
          id?: string
          joined_at?: string
          member_id?: string
          membership_role?: string
          organization_id?: string
          team_id?: string
          updated_at?: string
          updated_by_member_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_team_memberships_created_by_member_id_fkey"
            columns: ["created_by_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_team_memberships_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_team_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_team_memberships_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "organization_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_team_memberships_updated_by_member_id_fkey"
            columns: ["updated_by_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_teams: {
        Row: {
          active: boolean
          created_at: string
          created_by_member_id: string | null
          description: string
          id: string
          is_system: boolean
          name: string
          organization_id: string
          slug: string
          team_type: string
          updated_at: string
          updated_by_member_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by_member_id?: string | null
          description?: string
          id?: string
          is_system?: boolean
          name: string
          organization_id: string
          slug: string
          team_type?: string
          updated_at?: string
          updated_by_member_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by_member_id?: string | null
          description?: string
          id?: string
          is_system?: boolean
          name?: string
          organization_id?: string
          slug?: string
          team_type?: string
          updated_at?: string
          updated_by_member_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_teams_created_by_member_id_fkey"
            columns: ["created_by_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_teams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_teams_updated_by_member_id_fkey"
            columns: ["updated_by_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          legacy_convex_id: string | null
          name: string
          settings: Json
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          legacy_convex_id?: string | null
          name: string
          settings?: Json
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          legacy_convex_id?: string | null
          name?: string
          settings?: Json
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      permissions: {
        Row: {
          description: string
          id: string
          key: string
          legacy_convex_id: string | null
          module: string
        }
        Insert: {
          description?: string
          id?: string
          key: string
          legacy_convex_id?: string | null
          module: string
        }
        Update: {
          description?: string
          id?: string
          key?: string
          legacy_convex_id?: string | null
          module?: string
        }
        Relationships: []
      }
      planning_assets: {
        Row: {
          asset_role: string
          created_at: string
          generation_job_id: string | null
          id: string
          image_url: string
          legacy_convex_id: string | null
          metadata: Json
          organization_id: string
          planning_request_id: string
          prompt: string
          sku_matched: boolean
          sku_name: string
          storage_backend: string
          storage_path: string
        }
        Insert: {
          asset_role?: string
          created_at?: string
          generation_job_id?: string | null
          id?: string
          image_url?: string
          legacy_convex_id?: string | null
          metadata?: Json
          organization_id: string
          planning_request_id: string
          prompt?: string
          sku_matched?: boolean
          sku_name: string
          storage_backend?: string
          storage_path?: string
        }
        Update: {
          asset_role?: string
          created_at?: string
          generation_job_id?: string | null
          id?: string
          image_url?: string
          legacy_convex_id?: string | null
          metadata?: Json
          organization_id?: string
          planning_request_id?: string
          prompt?: string
          sku_matched?: boolean
          sku_name?: string
          storage_backend?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "planning_assets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_assets_planning_request_id_fkey"
            columns: ["planning_request_id"]
            isOneToOne: false
            referencedRelation: "planning_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      planning_batches: {
        Row: {
          approved_at: string | null
          approved_by_member_id: string | null
          archived_at: string | null
          assigned_member_id: string | null
          assigned_team: string
          batch_code: string
          campaign_season: string
          catalog_key: string
          catalog_memory: Json
          completed_at: string | null
          created_at: string
          created_by_member_id: string | null
          event_id: string | null
          failed_count: number
          generated_count: number
          generation_settings: Json
          id: string
          indent_name: string
          last_sku_started_at: string | null
          legacy_convex_id: string | null
          memory_source_request_id: string | null
          memory_updated_at: string | null
          name: string
          next_eligible_at: string | null
          organization_id: string
          pending_count: number
          priority: string
          queue_status: string
          reference_images: Json
          requires_review_count: number
          review_status: string
          schedule_error: string
          schedule_finished_at: string | null
          schedule_started_at: string | null
          schedule_status: string
          scheduled_at: string | null
          selected_reference: Json
          shared_reference_path: string
          shared_reference_url: string
          sku_delay_ms: number | null
          source_event_id: string | null
          status: string
          total_skus: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by_member_id?: string | null
          archived_at?: string | null
          assigned_member_id?: string | null
          assigned_team?: string
          batch_code: string
          campaign_season?: string
          catalog_key?: string
          catalog_memory?: Json
          completed_at?: string | null
          created_at?: string
          created_by_member_id?: string | null
          event_id?: string | null
          failed_count?: number
          generated_count?: number
          generation_settings?: Json
          id?: string
          indent_name?: string
          last_sku_started_at?: string | null
          legacy_convex_id?: string | null
          memory_source_request_id?: string | null
          memory_updated_at?: string | null
          name?: string
          next_eligible_at?: string | null
          organization_id: string
          pending_count?: number
          priority?: string
          queue_status?: string
          reference_images?: Json
          requires_review_count?: number
          review_status?: string
          schedule_error?: string
          schedule_finished_at?: string | null
          schedule_started_at?: string | null
          schedule_status?: string
          scheduled_at?: string | null
          selected_reference?: Json
          shared_reference_path?: string
          shared_reference_url?: string
          sku_delay_ms?: number | null
          source_event_id?: string | null
          status?: string
          total_skus?: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by_member_id?: string | null
          archived_at?: string | null
          assigned_member_id?: string | null
          assigned_team?: string
          batch_code?: string
          campaign_season?: string
          catalog_key?: string
          catalog_memory?: Json
          completed_at?: string | null
          created_at?: string
          created_by_member_id?: string | null
          event_id?: string | null
          failed_count?: number
          generated_count?: number
          generation_settings?: Json
          id?: string
          indent_name?: string
          last_sku_started_at?: string | null
          legacy_convex_id?: string | null
          memory_source_request_id?: string | null
          memory_updated_at?: string | null
          name?: string
          next_eligible_at?: string | null
          organization_id?: string
          pending_count?: number
          priority?: string
          queue_status?: string
          reference_images?: Json
          requires_review_count?: number
          review_status?: string
          schedule_error?: string
          schedule_finished_at?: string | null
          schedule_started_at?: string | null
          schedule_status?: string
          scheduled_at?: string | null
          selected_reference?: Json
          shared_reference_path?: string
          shared_reference_url?: string
          sku_delay_ms?: number | null
          source_event_id?: string | null
          status?: string
          total_skus?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "planning_batches_approved_by_member_id_fkey"
            columns: ["approved_by_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_batches_assigned_member_id_fkey"
            columns: ["assigned_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_batches_created_by_member_id_fkey"
            columns: ["created_by_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_batches_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "marketing_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_batches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_batches_source_event_id_fkey"
            columns: ["source_event_id"]
            isOneToOne: false
            referencedRelation: "marketing_events"
            referencedColumns: ["id"]
          },
        ]
      }
      planning_requests: {
        Row: {
          ai_analysis: Json
          analysis_fingerprint: string
          analysis_status: string
          analysis_updated_at: string | null
          approved_at: string | null
          approved_by_member_id: string | null
          archived_at: string | null
          assigned_member_id: string | null
          back_image_path: string
          back_image_url: string
          batch_id: string | null
          category: string
          color_label: string
          completion_status: string
          cost_breakdown: Json
          cost_source: string
          created_at: string
          created_by_member_id: string | null
          error_message: string
          expected_shoot_date: string | null
          festival_season: string
          front_image_path: string
          front_image_url: string
          garment_analysis: Json
          generation_cost_usd: number
          generation_finished_at: string | null
          generation_job_id: string | null
          generation_started_at: string | null
          generation_status: string
          id: string
          indent_name: string
          legacy_convex_id: string | null
          matched_at: string | null
          matched_sku: boolean
          notes: string
          organization_id: string
          photoshoot_type: string
          pose_plan: Json
          priority: string
          product_description: string
          queue_position: number | null
          queued_at: string | null
          reference_image_url: string
          reference_images: Json
          request_code: string
          retry_count: number
          review_status: string
          selected_styling: Json
          shoot_recommendations: Json
          sku_name: string
          staging_cleanup_at: string | null
          status: string
          trend_analysis: Json
          updated_at: string
          validation_report: Json
          validation_status: string
        }
        Insert: {
          ai_analysis?: Json
          analysis_fingerprint?: string
          analysis_status?: string
          analysis_updated_at?: string | null
          approved_at?: string | null
          approved_by_member_id?: string | null
          archived_at?: string | null
          assigned_member_id?: string | null
          back_image_path?: string
          back_image_url?: string
          batch_id?: string | null
          category?: string
          color_label?: string
          completion_status?: string
          cost_breakdown?: Json
          cost_source?: string
          created_at?: string
          created_by_member_id?: string | null
          error_message?: string
          expected_shoot_date?: string | null
          festival_season?: string
          front_image_path?: string
          front_image_url?: string
          garment_analysis?: Json
          generation_cost_usd?: number
          generation_finished_at?: string | null
          generation_job_id?: string | null
          generation_started_at?: string | null
          generation_status?: string
          id?: string
          indent_name?: string
          legacy_convex_id?: string | null
          matched_at?: string | null
          matched_sku?: boolean
          notes?: string
          organization_id: string
          photoshoot_type?: string
          pose_plan?: Json
          priority?: string
          product_description?: string
          queue_position?: number | null
          queued_at?: string | null
          reference_image_url?: string
          reference_images?: Json
          request_code?: string
          retry_count?: number
          review_status?: string
          selected_styling?: Json
          shoot_recommendations?: Json
          sku_name: string
          staging_cleanup_at?: string | null
          status?: string
          trend_analysis?: Json
          updated_at?: string
          validation_report?: Json
          validation_status?: string
        }
        Update: {
          ai_analysis?: Json
          analysis_fingerprint?: string
          analysis_status?: string
          analysis_updated_at?: string | null
          approved_at?: string | null
          approved_by_member_id?: string | null
          archived_at?: string | null
          assigned_member_id?: string | null
          back_image_path?: string
          back_image_url?: string
          batch_id?: string | null
          category?: string
          color_label?: string
          completion_status?: string
          cost_breakdown?: Json
          cost_source?: string
          created_at?: string
          created_by_member_id?: string | null
          error_message?: string
          expected_shoot_date?: string | null
          festival_season?: string
          front_image_path?: string
          front_image_url?: string
          garment_analysis?: Json
          generation_cost_usd?: number
          generation_finished_at?: string | null
          generation_job_id?: string | null
          generation_started_at?: string | null
          generation_status?: string
          id?: string
          indent_name?: string
          legacy_convex_id?: string | null
          matched_at?: string | null
          matched_sku?: boolean
          notes?: string
          organization_id?: string
          photoshoot_type?: string
          pose_plan?: Json
          priority?: string
          product_description?: string
          queue_position?: number | null
          queued_at?: string | null
          reference_image_url?: string
          reference_images?: Json
          request_code?: string
          retry_count?: number
          review_status?: string
          selected_styling?: Json
          shoot_recommendations?: Json
          sku_name?: string
          staging_cleanup_at?: string | null
          status?: string
          trend_analysis?: Json
          updated_at?: string
          validation_report?: Json
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "planning_requests_approved_by_member_id_fkey"
            columns: ["approved_by_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_requests_assigned_member_id_fkey"
            columns: ["assigned_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_requests_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "planning_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_requests_created_by_member_id_fkey"
            columns: ["created_by_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_patterns: {
        Row: {
          avg_quality: number | null
          created_at: string
          failure_count: number
          id: string
          last_used_at: string
          organization_id: string | null
          pattern_kind: string
          pattern_text: string
          product_category: string
          success_count: number
          title: string
          updated_at: string
        }
        Insert: {
          avg_quality?: number | null
          created_at?: string
          failure_count?: number
          id?: string
          last_used_at?: string
          organization_id?: string | null
          pattern_kind?: string
          pattern_text: string
          product_category?: string
          success_count?: number
          title?: string
          updated_at?: string
        }
        Update: {
          avg_quality?: number | null
          created_at?: string
          failure_count?: number
          id?: string
          last_used_at?: string
          organization_id?: string | null
          pattern_kind?: string
          pattern_text?: string
          product_category?: string
          success_count?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_patterns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_versions: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          kind: string
          name: string
          organization_id: string | null
          schema_json: Json
          template: string
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          kind: string
          name: string
          organization_id?: string | null
          schema_json?: Json
          template?: string
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          organization_id?: string | null
          schema_json?: Json
          template?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "prompt_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_reviews: {
        Row: {
          attempt_number: number | null
          created_at: string
          created_by_member_id: string | null
          generation_epoch: number | null
          generation_job_id: string
          id: string
          issues: Json
          metadata: Json
          notes: string
          organization_id: string
          outcome: string
          passed: boolean | null
          planning_request_id: string | null
          pose_index: number | null
          qa_version: string
          reviewer_type: string
          score: number | null
        }
        Insert: {
          attempt_number?: number | null
          created_at?: string
          created_by_member_id?: string | null
          generation_epoch?: number | null
          generation_job_id?: string
          id?: string
          issues?: Json
          metadata?: Json
          notes?: string
          organization_id: string
          outcome?: string
          passed?: boolean | null
          planning_request_id?: string | null
          pose_index?: number | null
          qa_version?: string
          reviewer_type?: string
          score?: number | null
        }
        Update: {
          attempt_number?: number | null
          created_at?: string
          created_by_member_id?: string | null
          generation_epoch?: number | null
          generation_job_id?: string
          id?: string
          issues?: Json
          metadata?: Json
          notes?: string
          organization_id?: string
          outcome?: string
          passed?: boolean | null
          planning_request_id?: string | null
          pose_index?: number | null
          qa_version?: string
          reviewer_type?: string
          score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "qa_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_reviews_planning_request_id_fkey"
            columns: ["planning_request_id"]
            isOneToOne: false
            referencedRelation: "planning_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_library: {
        Row: {
          created_at: string
          download_url: string
          id: string
          organization_id: string
          role: string
          storage_path: string
          tags: string[]
          usage_count: number
        }
        Insert: {
          created_at?: string
          download_url: string
          id?: string
          organization_id: string
          role?: string
          storage_path: string
          tags?: string[]
          usage_count?: number
        }
        Update: {
          created_at?: string
          download_url?: string
          id?: string
          organization_id?: string
          role?: string
          storage_path?: string
          tags?: string[]
          usage_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "reference_library_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      regional_festival_catalog: {
        Row: {
          color_palette: string[]
          created_at: string
          festival_key: string
          id: string
          lunar_based: boolean
          name: string
          notes: string
          product_categories: string[]
          region: string
          states: string[]
          styling_props: string[]
          typical_month_end: number | null
          typical_month_start: number | null
          visual_themes: string[]
        }
        Insert: {
          color_palette?: string[]
          created_at?: string
          festival_key: string
          id?: string
          lunar_based?: boolean
          name: string
          notes?: string
          product_categories?: string[]
          region?: string
          states?: string[]
          styling_props?: string[]
          typical_month_end?: number | null
          typical_month_start?: number | null
          visual_themes?: string[]
        }
        Update: {
          color_palette?: string[]
          created_at?: string
          festival_key?: string
          id?: string
          lunar_based?: boolean
          name?: string
          notes?: string
          product_categories?: string[]
          region?: string
          states?: string[]
          styling_props?: string[]
          typical_month_end?: number | null
          typical_month_start?: number | null
          visual_themes?: string[]
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          permission_id: string
          role_id: string
        }
        Insert: {
          permission_id: string
          role_id: string
        }
        Update: {
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          description: string
          id: string
          is_system: boolean
          legacy_convex_id: string | null
          name: string
          organization_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          is_system?: boolean
          legacy_convex_id?: string | null
          name: string
          organization_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          is_system?: boolean
          legacy_convex_id?: string | null
          name?: string
          organization_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      scene_analyses: {
        Row: {
          analysis_id: string
          created_at: string
          error: string
          expires_at: string
          request_data: Json
          result_data: Json
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          analysis_id: string
          created_at?: string
          error?: string
          expires_at?: string
          request_data?: Json
          result_data?: Json
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          analysis_id?: string
          created_at?: string
          error?: string
          expires_at?: string
          request_data?: Json
          result_data?: Json
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      session_generations: {
        Row: {
          actual_cost_usd: number
          approval_notes: string | null
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          attempt_count: number
          created_at: string
          error: string
          full_prompt: string
          generation_data: Json
          generation_epoch: number
          generation_id: string
          input_image_tokens: number
          input_text_tokens: number
          input_tokens: number
          instructions: string
          legacy_convex_id: string | null
          output_tokens: number
          output_url: string
          pose_index: number
          pose_type: string
          provider_request_id: string
          qa_payload: Json
          qa_status: string
          reference_fingerprint: string | null
          regeneration_history: Json
          regeneration_instructions: string
          session_id: string
          status: string
          storage_backend: string
          storage_path: string
          title: string
          total_tokens: number
          updated_at: string
          usage_payload: Json
        }
        Insert: {
          actual_cost_usd?: number
          approval_notes?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          attempt_count?: number
          created_at?: string
          error?: string
          full_prompt?: string
          generation_data?: Json
          generation_epoch?: number
          generation_id: string
          input_image_tokens?: number
          input_text_tokens?: number
          input_tokens?: number
          instructions?: string
          legacy_convex_id?: string | null
          output_tokens?: number
          output_url?: string
          pose_index?: number
          pose_type?: string
          provider_request_id?: string
          qa_payload?: Json
          qa_status?: string
          reference_fingerprint?: string | null
          regeneration_history?: Json
          regeneration_instructions?: string
          session_id: string
          status?: string
          storage_backend?: string
          storage_path?: string
          title?: string
          total_tokens?: number
          updated_at?: string
          usage_payload?: Json
        }
        Update: {
          actual_cost_usd?: number
          approval_notes?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          attempt_count?: number
          created_at?: string
          error?: string
          full_prompt?: string
          generation_data?: Json
          generation_epoch?: number
          generation_id?: string
          input_image_tokens?: number
          input_text_tokens?: number
          input_tokens?: number
          instructions?: string
          legacy_convex_id?: string | null
          output_tokens?: number
          output_url?: string
          pose_index?: number
          pose_type?: string
          provider_request_id?: string
          qa_payload?: Json
          qa_status?: string
          reference_fingerprint?: string | null
          regeneration_history?: Json
          regeneration_instructions?: string
          session_id?: string
          status?: string
          storage_backend?: string
          storage_path?: string
          title?: string
          total_tokens?: number
          updated_at?: string
          usage_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "session_generations_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_generations_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "catalog_sessions"
            referencedColumns: ["session_id"]
          },
        ]
      }
      styling_decisions: {
        Row: {
          ai_plan: Json
          approved: boolean
          approved_plan: Json
          batch_id: string | null
          category: string
          changed_fields: string[]
          created_at: string
          decided_by_member_id: string | null
          id: string
          organization_id: string
          planning_request_id: string | null
          scope: string
          session_id: string
          theme_summary: string
        }
        Insert: {
          ai_plan?: Json
          approved?: boolean
          approved_plan?: Json
          batch_id?: string | null
          category?: string
          changed_fields?: string[]
          created_at?: string
          decided_by_member_id?: string | null
          id?: string
          organization_id: string
          planning_request_id?: string | null
          scope: string
          session_id?: string
          theme_summary?: string
        }
        Update: {
          ai_plan?: Json
          approved?: boolean
          approved_plan?: Json
          batch_id?: string | null
          category?: string
          changed_fields?: string[]
          created_at?: string
          decided_by_member_id?: string | null
          id?: string
          organization_id?: string
          planning_request_id?: string | null
          scope?: string
          session_id?: string
          theme_summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "styling_decisions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "planning_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "styling_decisions_decided_by_member_id_fkey"
            columns: ["decided_by_member_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "styling_decisions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "styling_decisions_planning_request_id_fkey"
            columns: ["planning_request_id"]
            isOneToOne: false
            referencedRelation: "planning_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      visual_attributes: {
        Row: {
          ai_run_id: string | null
          catalog_key: string
          colorway: string
          created_at: string
          dominant_colors: Json
          fabric_cues: string
          front_back_diffs: Json
          id: string
          organization_id: string
          planning_request_id: string | null
          print_motifs: Json
          raw: Json
          ref_consistency: Json
          silhouette: string
          typography: Json
        }
        Insert: {
          ai_run_id?: string | null
          catalog_key?: string
          colorway?: string
          created_at?: string
          dominant_colors?: Json
          fabric_cues?: string
          front_back_diffs?: Json
          id?: string
          organization_id: string
          planning_request_id?: string | null
          print_motifs?: Json
          raw?: Json
          ref_consistency?: Json
          silhouette?: string
          typography?: Json
        }
        Update: {
          ai_run_id?: string | null
          catalog_key?: string
          colorway?: string
          created_at?: string
          dominant_colors?: Json
          fabric_cues?: string
          front_back_diffs?: Json
          id?: string
          organization_id?: string
          planning_request_id?: string | null
          print_motifs?: Json
          raw?: Json
          ref_consistency?: Json
          silhouette?: string
          typography?: Json
        }
        Relationships: [
          {
            foreignKeyName: "visual_attributes_ai_run_id_fkey"
            columns: ["ai_run_id"]
            isOneToOne: false
            referencedRelation: "ai_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visual_attributes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visual_attributes_planning_request_id_fkey"
            columns: ["planning_request_id"]
            isOneToOne: false
            referencedRelation: "planning_requests"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      app_current_workspace: { Args: never; Returns: Json }
      claim_due_catalog_batch: {
        Args: never
        Returns: {
          approved_at: string | null
          approved_by_member_id: string | null
          archived_at: string | null
          assigned_member_id: string | null
          assigned_team: string
          batch_code: string
          campaign_season: string
          catalog_key: string
          catalog_memory: Json
          completed_at: string | null
          created_at: string
          created_by_member_id: string | null
          event_id: string | null
          failed_count: number
          generated_count: number
          generation_settings: Json
          id: string
          indent_name: string
          last_sku_started_at: string | null
          legacy_convex_id: string | null
          memory_source_request_id: string | null
          memory_updated_at: string | null
          name: string
          next_eligible_at: string | null
          organization_id: string
          pending_count: number
          priority: string
          queue_status: string
          reference_images: Json
          requires_review_count: number
          review_status: string
          schedule_error: string
          schedule_finished_at: string | null
          schedule_started_at: string | null
          schedule_status: string
          scheduled_at: string | null
          selected_reference: Json
          shared_reference_path: string
          shared_reference_url: string
          sku_delay_ms: number | null
          source_event_id: string | null
          status: string
          total_skus: number
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "planning_batches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_next_generation_job: {
        Args: never
        Returns: {
          actual_cost_usd: number
          aspect_ratio: string
          attempt_count: number
          available_at: string
          batch_id: string | null
          completed_at: string | null
          completed_poses: number
          created_at: string
          current_pose: number | null
          error_code: string
          error_message: string
          estimated_cost_usd: number
          failed_poses: number
          history_search: string | null
          image_size: string
          input_image_tokens: number
          input_text_tokens: number
          input_tokens: number
          job_data: Json
          job_id: string
          legacy_convex_id: string | null
          lock_expires_at: string | null
          locked_at: string | null
          model: string
          org_id: string
          output_tokens: number
          planning_request_id: string | null
          pose_qa: boolean
          provider: string
          quality: string
          readiness_reasons: Json
          readiness_status: string
          session_id: string
          sku_name: string
          source_type: string
          started_at: string | null
          status: string
          total_poses: number
          total_tokens: number
          updated_at: string
          user_email: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "generation_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      merge_catalog_memory: {
        Args: { p_batch_id: string; p_patch: Json; p_require_absent?: string }
        Returns: Json
      }
      mutate_planning_batch_reference_images: {
        Args: {
          p_add?: Json
          p_batch_id: string
          p_remove_id?: string
          p_replace_role?: string
        }
        Returns: Json
      }
      recover_stale_generation_jobs: { Args: never; Returns: number }
      replace_organization_team_members: {
        Args: {
          p_actor_member_id: string
          p_lead_member_id: string
          p_member_ids: string[]
          p_organization_id: string
          p_team_id: string
        }
        Returns: number
      }
      save_catalog_styling_plan: {
        Args: {
          p_approve: boolean
          p_batch_id: string
          p_member_id: string
          p_plan: Json
        }
        Returns: Json
      }
      upsert_organization_team: {
        Args: {
          p_active: boolean
          p_actor_email: string
          p_actor_member_id: string
          p_description: string
          p_lead_member_id: string
          p_member_ids: string[]
          p_name: string
          p_organization_id: string
          p_slug: string
          p_team_id: string
          p_team_type: string
        }
        Returns: string
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
