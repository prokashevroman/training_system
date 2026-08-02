export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activities: {
        Row: {
          avg_heart_rate_bpm: number | null
          avg_power_watts: number | null
          cadence_spm: number | null
          calories: number | null
          created_at: string
          details: Json
          distance_km: number | null
          duration_seconds: number | null
          elevation_gain_m: number | null
          external_load_kg: number | null
          id: string
          intensity: Database["public"]["Enums"]["intensity_level"]
          max_heart_rate_bpm: number | null
          modality: Database["public"]["Enums"]["activity_modality"]
          notes: string | null
          objective: Database["public"]["Enums"]["training_objective"]
          original_text: string
          sequence: number
          session_id: string
          subtype: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avg_heart_rate_bpm?: number | null
          avg_power_watts?: number | null
          cadence_spm?: number | null
          calories?: number | null
          created_at?: string
          details?: Json
          distance_km?: number | null
          duration_seconds?: number | null
          elevation_gain_m?: number | null
          external_load_kg?: number | null
          id?: string
          intensity?: Database["public"]["Enums"]["intensity_level"]
          max_heart_rate_bpm?: number | null
          modality: Database["public"]["Enums"]["activity_modality"]
          notes?: string | null
          objective?: Database["public"]["Enums"]["training_objective"]
          original_text?: string
          sequence: number
          session_id: string
          subtype?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avg_heart_rate_bpm?: number | null
          avg_power_watts?: number | null
          cadence_spm?: number | null
          calories?: number | null
          created_at?: string
          details?: Json
          distance_km?: number | null
          duration_seconds?: number | null
          elevation_gain_m?: number | null
          external_load_kg?: number | null
          id?: string
          intensity?: Database["public"]["Enums"]["intensity_level"]
          max_heart_rate_bpm?: number | null
          modality?: Database["public"]["Enums"]["activity_modality"]
          notes?: string | null
          objective?: Database["public"]["Enums"]["training_objective"]
          original_text?: string
          sequence?: number
          session_id?: string
          subtype?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_session_id_user_id_fkey"
            columns: ["session_id", "user_id"]
            isOneToOne: false
            referencedRelation: "workout_sessions"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      activity_tags: {
        Row: {
          activity_id: string
          created_at: string
          tag_id: string
          user_id: string
        }
        Insert: {
          activity_id: string
          created_at?: string
          tag_id: string
          user_id: string
        }
        Update: {
          activity_id?: string
          created_at?: string
          tag_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_tags_activity_id_user_id_fkey"
            columns: ["activity_id", "user_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "activity_tags_tag_id_user_id_fkey"
            columns: ["tag_id", "user_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      ai_runs: {
        Row: {
          created_at: string
          error_category: string | null
          error_message: string | null
          estimated_cost_usd: number | null
          id: string
          import_entry_id: string | null
          input_tokens: number | null
          latency_ms: number | null
          model: string
          operation: string
          output_tokens: number | null
          prompt_version: string
          provider: string
          request_id: string | null
          schema_error_summary: string | null
          schema_valid: boolean | null
          session_id: string | null
          status: string
          total_tokens: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_category?: string | null
          error_message?: string | null
          estimated_cost_usd?: number | null
          id?: string
          import_entry_id?: string | null
          input_tokens?: number | null
          latency_ms?: number | null
          model: string
          operation: string
          output_tokens?: number | null
          prompt_version: string
          provider: string
          request_id?: string | null
          schema_error_summary?: string | null
          schema_valid?: boolean | null
          session_id?: string | null
          status?: string
          total_tokens?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_category?: string | null
          error_message?: string | null
          estimated_cost_usd?: number | null
          id?: string
          import_entry_id?: string | null
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string
          operation?: string
          output_tokens?: number | null
          prompt_version?: string
          provider?: string
          request_id?: string | null
          schema_error_summary?: string | null
          schema_valid?: boolean | null
          session_id?: string | null
          status?: string
          total_tokens?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      benchmark_definitions: {
        Row: {
          created_at: string
          description: string | null
          expected_split_labels: string[]
          id: string
          is_active: boolean
          is_standard: boolean
          modality: Database["public"]["Enums"]["activity_modality"]
          name: string
          prescription: Json
          scoring: Database["public"]["Enums"]["benchmark_scoring"]
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          expected_split_labels?: string[]
          id?: string
          is_active?: boolean
          is_standard?: boolean
          modality?: Database["public"]["Enums"]["activity_modality"]
          name: string
          prescription?: Json
          scoring: Database["public"]["Enums"]["benchmark_scoring"]
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          expected_split_labels?: string[]
          id?: string
          is_active?: boolean
          is_standard?: boolean
          modality?: Database["public"]["Enums"]["activity_modality"]
          name?: string
          prescription?: Json
          scoring?: Database["public"]["Enums"]["benchmark_scoring"]
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      benchmark_results: {
        Row: {
          activity_id: string
          as_prescribed: boolean | null
          created_at: string
          definition_id: string | null
          definition_slug: string
          id: string
          notes: string | null
          original_text: string
          partition_strategy: string | null
          rounds_completed: number | null
          score: string | null
          scoring: Database["public"]["Enums"]["benchmark_scoring"]
          total_seconds: number | null
          updated_at: string
          user_id: string
          variant_label: string | null
          vest_kg: number | null
        }
        Insert: {
          activity_id: string
          as_prescribed?: boolean | null
          created_at?: string
          definition_id?: string | null
          definition_slug: string
          id?: string
          notes?: string | null
          original_text?: string
          partition_strategy?: string | null
          rounds_completed?: number | null
          score?: string | null
          scoring?: Database["public"]["Enums"]["benchmark_scoring"]
          total_seconds?: number | null
          updated_at?: string
          user_id: string
          variant_label?: string | null
          vest_kg?: number | null
        }
        Update: {
          activity_id?: string
          as_prescribed?: boolean | null
          created_at?: string
          definition_id?: string | null
          definition_slug?: string
          id?: string
          notes?: string | null
          original_text?: string
          partition_strategy?: string | null
          rounds_completed?: number | null
          score?: string | null
          scoring?: Database["public"]["Enums"]["benchmark_scoring"]
          total_seconds?: number | null
          updated_at?: string
          user_id?: string
          variant_label?: string | null
          vest_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "benchmark_results_activity_id_user_id_fkey"
            columns: ["activity_id", "user_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "benchmark_results_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "benchmark_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      benchmark_splits: {
        Row: {
          benchmark_result_id: string
          cadence_spm: number | null
          created_at: string
          distance_km: number | null
          elapsed_seconds: number | null
          heart_rate_bpm: number | null
          id: string
          is_cumulative: boolean
          label: string
          notes: string | null
          original_text: string
          pace_seconds_per_km: number | null
          reference_frame: string
          reps: number | null
          split_order: number
          split_seconds: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          benchmark_result_id: string
          cadence_spm?: number | null
          created_at?: string
          distance_km?: number | null
          elapsed_seconds?: number | null
          heart_rate_bpm?: number | null
          id?: string
          is_cumulative?: boolean
          label: string
          notes?: string | null
          original_text?: string
          pace_seconds_per_km?: number | null
          reference_frame?: string
          reps?: number | null
          split_order: number
          split_seconds?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          benchmark_result_id?: string
          cadence_spm?: number | null
          created_at?: string
          distance_km?: number | null
          elapsed_seconds?: number | null
          heart_rate_bpm?: number | null
          id?: string
          is_cumulative?: boolean
          label?: string
          notes?: string | null
          original_text?: string
          pace_seconds_per_km?: number | null
          reference_frame?: string
          reps?: number | null
          split_order?: number
          split_seconds?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "benchmark_splits_benchmark_result_id_user_id_fkey"
            columns: ["benchmark_result_id", "user_id"]
            isOneToOne: false
            referencedRelation: "benchmark_results"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      body_measurements: {
        Row: {
          body_fat_percent: number | null
          body_weight_kg: number | null
          created_at: string
          id: string
          local_date: string
          notes: string | null
          updated_at: string
          user_id: string
          waist_cm: number | null
        }
        Insert: {
          body_fat_percent?: number | null
          body_weight_kg?: number | null
          created_at?: string
          id?: string
          local_date: string
          notes?: string | null
          updated_at?: string
          user_id: string
          waist_cm?: number | null
        }
        Update: {
          body_fat_percent?: number | null
          body_weight_kg?: number | null
          created_at?: string
          id?: string
          local_date?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
          waist_cm?: number | null
        }
        Relationships: []
      }
      cardio_intervals: {
        Row: {
          activity_id: string
          cadence_spm: number | null
          calories: number | null
          created_at: string
          distance_km: number | null
          duration_seconds: number | null
          heart_rate_bpm: number | null
          id: string
          interval_index: number
          interval_type: Database["public"]["Enums"]["cardio_interval_type"]
          notes: string | null
          original_text: string
          pace_seconds_per_km: number | null
          power_watts: number | null
          rest_seconds: number | null
          speed_unit: string | null
          speed_value: number | null
          split_seconds_per_500m: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          activity_id: string
          cadence_spm?: number | null
          calories?: number | null
          created_at?: string
          distance_km?: number | null
          duration_seconds?: number | null
          heart_rate_bpm?: number | null
          id?: string
          interval_index: number
          interval_type?: Database["public"]["Enums"]["cardio_interval_type"]
          notes?: string | null
          original_text?: string
          pace_seconds_per_km?: number | null
          power_watts?: number | null
          rest_seconds?: number | null
          speed_unit?: string | null
          speed_value?: number | null
          split_seconds_per_500m?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          activity_id?: string
          cadence_spm?: number | null
          calories?: number | null
          created_at?: string
          distance_km?: number | null
          duration_seconds?: number | null
          heart_rate_bpm?: number | null
          id?: string
          interval_index?: number
          interval_type?: Database["public"]["Enums"]["cardio_interval_type"]
          notes?: string | null
          original_text?: string
          pace_seconds_per_km?: number | null
          power_watts?: number | null
          rest_seconds?: number | null
          speed_unit?: string | null
          speed_value?: number | null
          split_seconds_per_500m?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cardio_intervals_activity_id_user_id_fkey"
            columns: ["activity_id", "user_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      circuit_movements: {
        Row: {
          apparatus: string | null
          circuit_result_id: string
          created_at: string
          exercise_confidence: number
          exercise_id: string | null
          exercise_raw_text: string
          id: string
          load_kg: number | null
          load_scope: Database["public"]["Enums"]["load_scope"]
          load_unit: Database["public"]["Enums"]["load_unit"]
          load_value: number | null
          movement_order: number
          notes: string | null
          original_text: string
          target_calories: number | null
          target_distance_km: number | null
          target_reps: number | null
          target_seconds: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          apparatus?: string | null
          circuit_result_id: string
          created_at?: string
          exercise_confidence?: number
          exercise_id?: string | null
          exercise_raw_text: string
          id?: string
          load_kg?: number | null
          load_scope?: Database["public"]["Enums"]["load_scope"]
          load_unit?: Database["public"]["Enums"]["load_unit"]
          load_value?: number | null
          movement_order: number
          notes?: string | null
          original_text?: string
          target_calories?: number | null
          target_distance_km?: number | null
          target_reps?: number | null
          target_seconds?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          apparatus?: string | null
          circuit_result_id?: string
          created_at?: string
          exercise_confidence?: number
          exercise_id?: string | null
          exercise_raw_text?: string
          id?: string
          load_kg?: number | null
          load_scope?: Database["public"]["Enums"]["load_scope"]
          load_unit?: Database["public"]["Enums"]["load_unit"]
          load_value?: number | null
          movement_order?: number
          notes?: string | null
          original_text?: string
          target_calories?: number | null
          target_distance_km?: number | null
          target_reps?: number | null
          target_seconds?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "circuit_movements_circuit_result_id_user_id_fkey"
            columns: ["circuit_result_id", "user_id"]
            isOneToOne: false
            referencedRelation: "circuit_results"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "circuit_movements_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      circuit_results: {
        Row: {
          activity_id: string
          as_prescribed: boolean | null
          completion_seconds: number | null
          created_at: string
          details: Json
          format: Database["public"]["Enums"]["circuit_format"]
          id: string
          name: string | null
          notes: string | null
          original_text: string
          partial_round_reps: number | null
          rest_seconds: number | null
          rounds_completed: number | null
          rounds_prescribed: number | null
          score: string | null
          time_cap_seconds: number | null
          updated_at: string
          user_id: string
          work_seconds: number | null
        }
        Insert: {
          activity_id: string
          as_prescribed?: boolean | null
          completion_seconds?: number | null
          created_at?: string
          details?: Json
          format?: Database["public"]["Enums"]["circuit_format"]
          id?: string
          name?: string | null
          notes?: string | null
          original_text?: string
          partial_round_reps?: number | null
          rest_seconds?: number | null
          rounds_completed?: number | null
          rounds_prescribed?: number | null
          score?: string | null
          time_cap_seconds?: number | null
          updated_at?: string
          user_id: string
          work_seconds?: number | null
        }
        Update: {
          activity_id?: string
          as_prescribed?: boolean | null
          completion_seconds?: number | null
          created_at?: string
          details?: Json
          format?: Database["public"]["Enums"]["circuit_format"]
          id?: string
          name?: string | null
          notes?: string | null
          original_text?: string
          partial_round_reps?: number | null
          rest_seconds?: number | null
          rounds_completed?: number | null
          rounds_prescribed?: number | null
          score?: string | null
          time_cap_seconds?: number | null
          updated_at?: string
          user_id?: string
          work_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "circuit_results_activity_id_user_id_fkey"
            columns: ["activity_id", "user_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      daily_checkins: {
        Row: {
          created_at: string
          fatigue: number | null
          hrv_ms: number | null
          id: string
          is_ill: boolean
          local_date: string
          motivation: number | null
          notes: string | null
          pain_level: number | null
          pain_notes: string | null
          resting_heart_rate_bpm: number | null
          sleep_hours: number | null
          sleep_quality: number | null
          soreness: Json
          stress: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          fatigue?: number | null
          hrv_ms?: number | null
          id?: string
          is_ill?: boolean
          local_date: string
          motivation?: number | null
          notes?: string | null
          pain_level?: number | null
          pain_notes?: string | null
          resting_heart_rate_bpm?: number | null
          sleep_hours?: number | null
          sleep_quality?: number | null
          soreness?: Json
          stress?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          fatigue?: number | null
          hrv_ms?: number | null
          id?: string
          is_ill?: boolean
          local_date?: string
          motivation?: number | null
          notes?: string | null
          pain_level?: number | null
          pain_notes?: string | null
          resting_heart_rate_bpm?: number | null
          sleep_hours?: number | null
          sleep_quality?: number | null
          soreness?: Json
          stress?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      exercise_aliases: {
        Row: {
          alias: string
          apparatus: string | null
          created_at: string
          exercise_id: string
          id: string
          is_misspelling: boolean
          language: string
          updated_at: string
        }
        Insert: {
          alias: string
          apparatus?: string | null
          created_at?: string
          exercise_id: string
          id?: string
          is_misspelling?: boolean
          language?: string
          updated_at?: string
        }
        Update: {
          alias?: string
          apparatus?: string | null
          created_at?: string
          exercise_id?: string
          id?: string
          is_misspelling?: boolean
          language?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercise_aliases_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      exercises: {
        Row: {
          created_at: string
          equipment: string[]
          id: string
          is_active: boolean
          is_bodyweight: boolean
          is_unilateral: boolean
          movement_pattern: Database["public"]["Enums"]["movement_pattern"]
          name: string
          notes: string | null
          primary_muscles: string[]
          secondary_muscles: string[]
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          equipment?: string[]
          id?: string
          is_active?: boolean
          is_bodyweight?: boolean
          is_unilateral?: boolean
          movement_pattern: Database["public"]["Enums"]["movement_pattern"]
          name: string
          notes?: string | null
          primary_muscles?: string[]
          secondary_muscles?: string[]
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          equipment?: string[]
          id?: string
          is_active?: boolean
          is_bodyweight?: boolean
          is_unilateral?: boolean
          movement_pattern?: Database["public"]["Enums"]["movement_pattern"]
          name?: string
          notes?: string | null
          primary_muscles?: string[]
          secondary_muscles?: string[]
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      import_batches: {
        Row: {
          cells_scanned: number
          created_at: string
          entries_applied: number
          entries_created: number
          entries_failed: number
          entries_parsed: number
          entries_review_required: number
          error_summary: string | null
          file_name: string
          file_sha256: string | null
          finished_at: string | null
          id: string
          importer_version: string
          notes: string | null
          parser_version: string
          sessions_created: number
          sheet_name: string
          started_at: string
          status: Database["public"]["Enums"]["import_batch_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          cells_scanned?: number
          created_at?: string
          entries_applied?: number
          entries_created?: number
          entries_failed?: number
          entries_parsed?: number
          entries_review_required?: number
          error_summary?: string | null
          file_name: string
          file_sha256?: string | null
          finished_at?: string | null
          id?: string
          importer_version: string
          notes?: string | null
          parser_version: string
          sessions_created?: number
          sheet_name: string
          started_at?: string
          status?: Database["public"]["Enums"]["import_batch_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          cells_scanned?: number
          created_at?: string
          entries_applied?: number
          entries_created?: number
          entries_failed?: number
          entries_parsed?: number
          entries_review_required?: number
          error_summary?: string | null
          file_name?: string
          file_sha256?: string | null
          finished_at?: string | null
          id?: string
          importer_version?: string
          notes?: string | null
          parser_version?: string
          sessions_created?: number
          sheet_name?: string
          started_at?: string
          status?: Database["public"]["Enums"]["import_batch_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      import_entries: {
        Row: {
          ai_draft: Json | null
          applied_at: string | null
          batch_id: string
          cell_ref: string
          created_at: string
          error_message: string | null
          extraction: Json | null
          id: string
          inferred_local_date: string | null
          raw_text: string
          raw_text_sha256: string
          review_notes: string | null
          review_status: Database["public"]["Enums"]["import_review_status"]
          reviewed_at: string | null
          sheet_name: string
          source_col: number
          source_row: number
          unconsumed_lines: string[]
          updated_at: string
          user_id: string
          validation: Json | null
          warnings: Json
          week_label: string | null
        }
        Insert: {
          ai_draft?: Json | null
          applied_at?: string | null
          batch_id: string
          cell_ref: string
          created_at?: string
          error_message?: string | null
          extraction?: Json | null
          id?: string
          inferred_local_date?: string | null
          raw_text: string
          raw_text_sha256: string
          review_notes?: string | null
          review_status?: Database["public"]["Enums"]["import_review_status"]
          reviewed_at?: string | null
          sheet_name: string
          source_col: number
          source_row: number
          unconsumed_lines?: string[]
          updated_at?: string
          user_id: string
          validation?: Json | null
          warnings?: Json
          week_label?: string | null
        }
        Update: {
          ai_draft?: Json | null
          applied_at?: string | null
          batch_id?: string
          cell_ref?: string
          created_at?: string
          error_message?: string | null
          extraction?: Json | null
          id?: string
          inferred_local_date?: string | null
          raw_text?: string
          raw_text_sha256?: string
          review_notes?: string | null
          review_status?: Database["public"]["Enums"]["import_review_status"]
          reviewed_at?: string | null
          sheet_name?: string
          source_col?: number
          source_row?: number
          unconsumed_lines?: string[]
          updated_at?: string
          user_id?: string
          validation?: Json | null
          warnings?: Json
          week_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_entries_batch_id_user_id_fkey"
            columns: ["batch_id", "user_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      import_entry_sessions: {
        Row: {
          created_at: string
          import_entry_id: string
          ordinal: number
          session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          import_entry_id: string
          ordinal?: number
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          import_entry_id?: string
          ordinal?: number
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_entry_sessions_import_entry_id_user_id_fkey"
            columns: ["import_entry_id", "user_id"]
            isOneToOne: false
            referencedRelation: "import_entries"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "import_entry_sessions_session_id_user_id_fkey"
            columns: ["session_id", "user_id"]
            isOneToOne: false
            referencedRelation: "workout_sessions"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      profiles: {
        Row: {
          birth_date: string | null
          created_at: string
          current_constraints: string | null
          default_language: string
          display_name: string | null
          height_cm: number | null
          injury_notes: string | null
          preferred_sessions_per_week_max: number | null
          preferred_sessions_per_week_min: number | null
          preferred_units: Database["public"]["Enums"]["preferred_units"]
          timezone: string
          training_preferences: string | null
          updated_at: string
          user_id: string
          weekday_max_minutes: number | null
          weekend_max_minutes: number | null
        }
        Insert: {
          birth_date?: string | null
          created_at?: string
          current_constraints?: string | null
          default_language?: string
          display_name?: string | null
          height_cm?: number | null
          injury_notes?: string | null
          preferred_sessions_per_week_max?: number | null
          preferred_sessions_per_week_min?: number | null
          preferred_units?: Database["public"]["Enums"]["preferred_units"]
          timezone?: string
          training_preferences?: string | null
          updated_at?: string
          user_id: string
          weekday_max_minutes?: number | null
          weekend_max_minutes?: number | null
        }
        Update: {
          birth_date?: string | null
          created_at?: string
          current_constraints?: string | null
          default_language?: string
          display_name?: string | null
          height_cm?: number | null
          injury_notes?: string | null
          preferred_sessions_per_week_max?: number | null
          preferred_sessions_per_week_min?: number | null
          preferred_units?: Database["public"]["Enums"]["preferred_units"]
          timezone?: string
          training_preferences?: string | null
          updated_at?: string
          user_id?: string
          weekday_max_minutes?: number | null
          weekend_max_minutes?: number | null
        }
        Relationships: []
      }
      session_tags: {
        Row: {
          created_at: string
          session_id: string
          tag_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          session_id: string
          tag_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          session_id?: string
          tag_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_tags_session_id_user_id_fkey"
            columns: ["session_id", "user_id"]
            isOneToOne: false
            referencedRelation: "workout_sessions"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "session_tags_tag_id_user_id_fkey"
            columns: ["tag_id", "user_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      strength_sets: {
        Row: {
          activity_id: string
          apparatus: string | null
          completed: boolean
          created_at: string
          exercise_confidence: number
          exercise_id: string | null
          exercise_raw_text: string
          hold_seconds: number | null
          id: string
          load_kg: number | null
          load_scope: Database["public"]["Enums"]["load_scope"]
          load_unit: Database["public"]["Enums"]["load_unit"]
          load_value: number | null
          notes: string | null
          original_text: string
          reps: number | null
          rest_seconds: number | null
          rir: number | null
          rpe: number | null
          set_index: number
          set_type: Database["public"]["Enums"]["strength_set_type"]
          side: Database["public"]["Enums"]["body_side"] | null
          tempo: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          activity_id: string
          apparatus?: string | null
          completed?: boolean
          created_at?: string
          exercise_confidence?: number
          exercise_id?: string | null
          exercise_raw_text: string
          hold_seconds?: number | null
          id?: string
          load_kg?: number | null
          load_scope?: Database["public"]["Enums"]["load_scope"]
          load_unit?: Database["public"]["Enums"]["load_unit"]
          load_value?: number | null
          notes?: string | null
          original_text?: string
          reps?: number | null
          rest_seconds?: number | null
          rir?: number | null
          rpe?: number | null
          set_index: number
          set_type?: Database["public"]["Enums"]["strength_set_type"]
          side?: Database["public"]["Enums"]["body_side"] | null
          tempo?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          activity_id?: string
          apparatus?: string | null
          completed?: boolean
          created_at?: string
          exercise_confidence?: number
          exercise_id?: string | null
          exercise_raw_text?: string
          hold_seconds?: number | null
          id?: string
          load_kg?: number | null
          load_scope?: Database["public"]["Enums"]["load_scope"]
          load_unit?: Database["public"]["Enums"]["load_unit"]
          load_value?: number | null
          notes?: string | null
          original_text?: string
          reps?: number | null
          rest_seconds?: number | null
          rir?: number | null
          rpe?: number | null
          set_index?: number
          set_type?: Database["public"]["Enums"]["strength_set_type"]
          side?: Database["public"]["Enums"]["body_side"] | null
          tempo?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "strength_sets_activity_id_user_id_fkey"
            columns: ["activity_id", "user_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "strength_sets_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string | null
          created_at: string
          id: string
          label: string
          slug: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          label: string
          slug: string
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          label?: string
          slug?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_corrections: {
        Row: {
          approved_result: Json
          changed_fields: string[]
          correction_notes: string | null
          created_at: string
          id: string
          import_entry_id: string | null
          original_draft: Json
          parser_version: string | null
          session_id: string | null
          source_kind: string
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_result: Json
          changed_fields?: string[]
          correction_notes?: string | null
          created_at?: string
          id?: string
          import_entry_id?: string | null
          original_draft: Json
          parser_version?: string | null
          session_id?: string | null
          source_kind: string
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_result?: Json
          changed_fields?: string[]
          correction_notes?: string | null
          created_at?: string
          id?: string
          import_entry_id?: string | null
          original_draft?: Json
          parser_version?: string | null
          session_id?: string | null
          source_kind?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      workout_sessions: {
        Row: {
          client_request_key: string | null
          created_at: string
          duration_seconds: number | null
          id: string
          local_date: string
          notes: string | null
          planned_session_id: string | null
          raw_text: string
          session_rpe: number | null
          source: Database["public"]["Enums"]["session_source"]
          started_at: string | null
          status: Database["public"]["Enums"]["session_status"]
          title: string
          transcript: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          client_request_key?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          local_date: string
          notes?: string | null
          planned_session_id?: string | null
          raw_text?: string
          session_rpe?: number | null
          source?: Database["public"]["Enums"]["session_source"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["session_status"]
          title: string
          transcript?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          client_request_key?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          local_date?: string
          notes?: string | null
          planned_session_id?: string | null
          raw_text?: string
          session_rpe?: number | null
          source?: Database["public"]["Enums"]["session_source"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["session_status"]
          title?: string
          transcript?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_import_entry: {
        Args: {
          p_batch_id: string
          p_cell: Json
          p_sessions: Json
          p_user_id: string
        }
        Returns: {
          client_request_key: string
          session_id: string
        }[]
      }
    }
    Enums: {
      activity_modality:
        | "strength"
        | "running"
        | "cycling"
        | "rowing"
        | "ski_erg"
        | "swimming"
        | "hybrid_conditioning"
        | "mobility_recovery"
        | "walking_hiking"
        | "sport_outdoor"
        | "dance"
        | "other"
      benchmark_scoring: "time" | "rounds_reps" | "distance" | "load" | "custom"
      body_side: "left" | "right" | "both" | "each"
      cardio_interval_type:
        | "warmup"
        | "work"
        | "rest"
        | "cooldown"
        | "split"
        | "steady"
      circuit_format:
        | "amrap"
        | "emom"
        | "for_time"
        | "rounds"
        | "interval"
        | "chipper"
        | "custom"
      distance_unit: "km" | "m" | "mi" | "floors" | "steps"
      import_batch_status: "running" | "completed" | "failed"
      import_review_status:
        | "pending"
        | "parsed"
        | "review_required"
        | "approved"
        | "applied"
        | "rejected"
        | "failed"
      intensity_level: "easy" | "moderate" | "hard" | "max" | "unknown"
      load_scope:
        | "total"
        | "per_hand"
        | "per_side"
        | "added_bodyweight"
        | "bodyweight"
        | "machine_setting"
        | "unknown"
      load_unit: "kg" | "lb" | "none"
      movement_pattern:
        | "squat"
        | "hinge"
        | "horizontal_push"
        | "horizontal_pull"
        | "vertical_push"
        | "vertical_pull"
        | "unilateral_leg"
        | "carry"
        | "core"
        | "locomotion"
        | "power"
        | "mobility"
      preferred_units: "metric" | "imperial"
      session_source: "manual" | "voice" | "excel_import" | "integration"
      session_status: "draft" | "completed" | "discarded"
      strength_set_type: "warmup" | "working" | "drop" | "amrap" | "test"
      training_objective:
        | "max_strength"
        | "hypertrophy"
        | "power"
        | "skill"
        | "aerobic_base"
        | "tempo_threshold"
        | "vo2max"
        | "race_specific"
        | "hybrid_conditioning"
        | "recovery"
        | "commute"
        | "unknown"
      warning_severity: "info" | "warning" | "error"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      activity_modality: [
        "strength",
        "running",
        "cycling",
        "rowing",
        "ski_erg",
        "swimming",
        "hybrid_conditioning",
        "mobility_recovery",
        "walking_hiking",
        "sport_outdoor",
        "dance",
        "other",
      ],
      benchmark_scoring: ["time", "rounds_reps", "distance", "load", "custom"],
      body_side: ["left", "right", "both", "each"],
      cardio_interval_type: [
        "warmup",
        "work",
        "rest",
        "cooldown",
        "split",
        "steady",
      ],
      circuit_format: [
        "amrap",
        "emom",
        "for_time",
        "rounds",
        "interval",
        "chipper",
        "custom",
      ],
      distance_unit: ["km", "m", "mi", "floors", "steps"],
      import_batch_status: ["running", "completed", "failed"],
      import_review_status: [
        "pending",
        "parsed",
        "review_required",
        "approved",
        "applied",
        "rejected",
        "failed",
      ],
      intensity_level: ["easy", "moderate", "hard", "max", "unknown"],
      load_scope: [
        "total",
        "per_hand",
        "per_side",
        "added_bodyweight",
        "bodyweight",
        "machine_setting",
        "unknown",
      ],
      load_unit: ["kg", "lb", "none"],
      movement_pattern: [
        "squat",
        "hinge",
        "horizontal_push",
        "horizontal_pull",
        "vertical_push",
        "vertical_pull",
        "unilateral_leg",
        "carry",
        "core",
        "locomotion",
        "power",
        "mobility",
      ],
      preferred_units: ["metric", "imperial"],
      session_source: ["manual", "voice", "excel_import", "integration"],
      session_status: ["draft", "completed", "discarded"],
      strength_set_type: ["warmup", "working", "drop", "amrap", "test"],
      training_objective: [
        "max_strength",
        "hypertrophy",
        "power",
        "skill",
        "aerobic_base",
        "tempo_threshold",
        "vo2max",
        "race_specific",
        "hybrid_conditioning",
        "recovery",
        "commute",
        "unknown",
      ],
      warning_severity: ["info", "warning", "error"],
    },
  },
} as const

