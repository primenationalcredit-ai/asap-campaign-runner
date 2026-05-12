// ============================================================
// Shared TypeScript types
// ============================================================

export type SourceType = "pipedrive_filter" | "pipedrive_pipeline";

export type ActionType = "update_deal_field" | "send_email" | "send_sms";

export type CampaignStatus =
  | "draft"
  | "launching"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type QueueItemStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "skipped";

/**
 * Action config for "update_deal_field".
 *
 * value_mode = "fixed":  every matching deal gets `fixed_value`.
 * value_mode = "chain":  each deal's next value is looked up in `chain`
 *                        based on its current field value. A `from_value`
 *                        of null matches deals where the field is blank.
 *                        Deals whose current value isn't in the chain
 *                        are routed to `else_to_value` if set, otherwise
 *                        skipped (status = 'skipped').
 */
export interface UpdateDealFieldConfig {
  field_key: string;        // 40-char Pipedrive custom field hash
  field_name: string;       // human label, for display
  field_type:               // affects how we serialize the value
    | "enum"
    | "varchar"
    | "text"
    | "double"
    | "monetary"
    | "date"
    | "phone";
  value_mode: "fixed" | "chain";
  fixed_value?: string | number | null;
  chain?: ChainStep[];
  /** Catch-all: if set, deals whose current value matches no chain
   *  step are routed to this value (instead of being skipped). */
  else_to_value?: string | number | null;
}

export interface ChainStep {
  from_value: string | number | null;  // null = blank
  to_value: string | number | null;
}

export interface CampaignRow {
  id: string;
  name: string;
  description: string | null;
  source_type: SourceType;
  source_config: Record<string, unknown>;
  action_type: ActionType;
  action_config: UpdateDealFieldConfig | Record<string, unknown>;
  rate_per_minute: number;
  business_hours_start: string; // "HH:MM:SS"
  business_hours_end: string;
  timezone: string;
  skip_weekends: boolean;
  skip_holidays: boolean;
  custom_skip_dates: string[]; // "YYYY-MM-DD"
  randomize_within_minute: boolean;
  status: CampaignStatus;
  launch_state: {
    next_scheduled_at?: string;
    pipedrive_cursor?: string | null;
    deals_seen?: number;
    deals_queued?: number;
  };
  total_items: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  created_at: string;
  launched_at: string | null;
  completed_at: string | null;
  estimated_completion_at: string | null;
  audience_snapshot_count: number | null;
}

export interface QueueItemRow {
  id: number;
  campaign_id: string;
  pipedrive_deal_id: number;
  pipedrive_deal_title: string | null;
  action_payload: Record<string, unknown>;
  scheduled_at: string;
  status: QueueItemStatus;
  attempts: number;
  sent_at: string | null;
  error_message: string | null;
  created_at: string;
}

// --- Pipedrive API response shapes (only the bits we use) ---

export interface PipedriveFilter {
  id: number;
  name: string;
  type: string;          // "deals" | "people" | etc.
  active_flag: boolean;
}

export interface PipedrivePipeline {
  id: number;
  name: string;
  active: boolean;
}

export interface PipedriveStage {
  id: number;
  name: string;
  pipeline_id: number;
}

export interface PipedriveDealField {
  id: number;
  key: string;
  name: string;
  field_type: string;            // "enum", "set", "varchar", "text", ...
  options?: Array<{ id: number; label: string }>;
}

export interface PipedriveDealV2 {
  id: number;
  title: string;
  pipeline_id: number;
  stage_id: number;
  status: string;                // "open" | "won" | "lost"
  custom_fields?: Record<string, unknown>;
}
