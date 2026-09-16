// Hand-authored to match supabase/migrations/0001_init_schema.sql.
// Once a real Supabase project is linked, this can be replaced with
// `supabase gen types typescript` output in the same shape.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type CollaborationStatus =
  | "APPLIED"
  | "SELECTED"
  | "SHIPPING"
  | "RECEIVED"
  | "SHOOTING"
  | "WRITING"
  | "REVIEW"
  | "UPLOAD_READY"
  | "COMPLETED"
  | "PAYMENT_PENDING"
  | "PAID";

export type ProvisionType = "PRODUCT" | "FEE" | "PRODUCT_AND_FEE";

export type ContentPlatform =
  | "INSTAGRAM_FEED"
  | "INSTAGRAM_REELS_CAPTION"
  | "INSTAGRAM_REELS_SUBTITLE"
  | "NAVER_BLOG_TITLE"
  | "NAVER_BLOG_BODY"
  | "NAVER_BLOG"
  | "THREADS"
  | "COMMENT_REPLY"
  | "DM_REPLY";

export type ContentStatus = "DRAFT" | "REVIEW" | "APPROVED" | "POSTED";

export type ScheduleType =
  | "SHOOTING"
  | "CONTENT_DEADLINE"
  | "UPLOAD"
  | "PAYMENT";

export type PhotoType =
  | "PRODUCT_ALONE"
  | "PACKAGE"
  | "COMPONENTS"
  | "DETAIL"
  | "USAGE"
  | "KID_USAGE"
  | "FINAL_SHOT"
  | "OTHER";

export type AiUsageFeature = "VISION_ANALYSIS" | "TEXT_GENERATION";

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          plan_tier: string;
          role: string;
          subscription_status: string;
          subscription_started_at: string | null;
          subscription_expires_at: string | null;
          next_billing_at: string | null;
          cancel_at_period_end: boolean;
          payment_provider: string | null;
          payment_customer_id: string | null;
          payment_subscription_id: string | null;
          retry_count: number;
          next_retry_at: string | null;
          last_payment_failed_at: string | null;
          last_payment_error_type: string | null;
          scheduled_plan: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          plan_tier?: string;
          role?: string;
          subscription_status?: string;
          subscription_started_at?: string | null;
          subscription_expires_at?: string | null;
          next_billing_at?: string | null;
          cancel_at_period_end?: boolean;
          payment_provider?: string | null;
          payment_customer_id?: string | null;
          payment_subscription_id?: string | null;
          retry_count?: number;
          next_retry_at?: string | null;
          last_payment_failed_at?: string | null;
          last_payment_error_type?: string | null;
          scheduled_plan?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          display_name?: string | null;
          plan_tier?: string;
          role?: string;
          subscription_status?: string;
          subscription_started_at?: string | null;
          subscription_expires_at?: string | null;
          next_billing_at?: string | null;
          cancel_at_period_end?: boolean;
          payment_provider?: string | null;
          payment_customer_id?: string | null;
          payment_subscription_id?: string | null;
          retry_count?: number;
          next_retry_at?: string | null;
          last_payment_failed_at?: string | null;
          last_payment_error_type?: string | null;
          scheduled_plan?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      collaborations: {
        Row: {
          id: string;
          user_id: string;
          brand_name: string;
          product_name: string;
          campaign_name: string | null;
          platform: string | null;
          platform_site_url: string | null;
          manager_name: string | null;
          manager_contact: string | null;
          provision_type: ProvisionType | null;
          product_price: number | null;
          writing_fee: number | null;
          product_received_date: string | null;
          content_deadline: string | null;
          payment_due_date: string | null;
          upload_platforms: string[];
          required_keywords: string | null;
          required_hashtags: string | null;
          required_mentions: string | null;
          required_photo_count: number | null;
          required_video_info: string | null;
          content_guide: string | null;
          ad_disclosure_text: string | null;
          memo: string | null;
          review_notes: Json;
          status: CollaborationStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          brand_name: string;
          product_name: string;
          campaign_name?: string | null;
          platform?: string | null;
          platform_site_url?: string | null;
          manager_name?: string | null;
          manager_contact?: string | null;
          provision_type?: ProvisionType | null;
          product_price?: number | null;
          writing_fee?: number | null;
          product_received_date?: string | null;
          content_deadline?: string | null;
          payment_due_date?: string | null;
          upload_platforms?: string[];
          required_keywords?: string | null;
          required_hashtags?: string | null;
          required_mentions?: string | null;
          required_photo_count?: number | null;
          required_video_info?: string | null;
          content_guide?: string | null;
          ad_disclosure_text?: string | null;
          memo?: string | null;
          review_notes?: Json;
          status?: CollaborationStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["collaborations"]["Insert"]>;
        Relationships: [];
      };
      collaboration_guides: {
        Row: {
          id: string;
          collaboration_id: string;
          user_id: string;
          raw_content: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          collaboration_id: string;
          user_id: string;
          raw_content: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["collaboration_guides"]["Insert"]>;
        Relationships: [];
      };
      contents: {
        Row: {
          id: string;
          collaboration_id: string;
          user_id: string;
          platform: ContentPlatform;
          title: string | null;
          body: string | null;
          status: ContentStatus;
          ai_provider: string | null;
          generation_input: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          collaboration_id: string;
          user_id: string;
          platform: ContentPlatform;
          title?: string | null;
          body?: string | null;
          status?: ContentStatus;
          ai_provider?: string | null;
          generation_input?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["contents"]["Insert"]>;
        Relationships: [];
      };
      schedules: {
        Row: {
          id: string;
          collaboration_id: string;
          user_id: string;
          schedule_type: ScheduleType;
          scheduled_date: string;
          title: string | null;
          memo: string | null;
          is_completed: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          collaboration_id: string;
          user_id: string;
          schedule_type: ScheduleType;
          scheduled_date: string;
          title?: string | null;
          memo?: string | null;
          is_completed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["schedules"]["Insert"]>;
        Relationships: [];
      };
      creator_styles: {
        Row: {
          id: string;
          user_id: string;
          style_name: string;
          sample_text: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          style_name: string;
          sample_text: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["creator_styles"]["Insert"]>;
        Relationships: [];
      };
      collaboration_photos: {
        Row: {
          id: string;
          collaboration_id: string;
          user_id: string;
          storage_path: string;
          thumbnail_path: string;
          original_filename: string | null;
          display_order: number;
          photo_type: PhotoType | null;
          ai_analysis: string | null;
          user_memo: string | null;
          body_section: string | null;
          body_edited: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          collaboration_id: string;
          user_id: string;
          storage_path: string;
          thumbnail_path: string;
          original_filename?: string | null;
          display_order?: number;
          photo_type?: PhotoType | null;
          ai_analysis?: string | null;
          user_memo?: string | null;
          body_section?: string | null;
          body_edited?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["collaboration_photos"]["Insert"]>;
        Relationships: [];
      };
      ai_usage_logs: {
        Row: {
          id: string;
          user_id: string;
          collaboration_id: string | null;
          feature: AiUsageFeature;
          operation: string | null;
          provider: string;
          model: string | null;
          unit_count: number;
          status: "success" | "failed";
          error_type: string | null;
          input_tokens: number | null;
          output_tokens: number | null;
          credits_used: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          collaboration_id?: string | null;
          feature: AiUsageFeature;
          operation?: string | null;
          provider: string;
          model?: string | null;
          unit_count?: number;
          status?: "success" | "failed";
          error_type?: string | null;
          input_tokens?: number | null;
          output_tokens?: number | null;
          credits_used?: number | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ai_usage_logs"]["Insert"]>;
        Relationships: [];
      };
      ai_usage_quotas: {
        Row: {
          user_id: string;
          period: string;
          used_count: number;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          period: string;
          used_count?: number;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ai_usage_quotas"]["Insert"]>;
        Relationships: [];
      };
      payment_events: {
        Row: {
          id: string;
          user_id: string;
          payment_id: string;
          plan: string;
          amount: number;
          status: "PENDING" | "PAID" | "FAILED";
          provider: string;
          kind: "INITIAL" | "RECURRING";
          billing_period_start: string | null;
          error_code: string | null;
          error_type: string | null;
          raw_response: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          payment_id: string;
          plan: string;
          amount: number;
          status?: "PENDING" | "PAID" | "FAILED";
          provider?: string;
          kind?: "INITIAL" | "RECURRING";
          billing_period_start?: string | null;
          error_code?: string | null;
          error_type?: string | null;
          raw_response?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["payment_events"]["Insert"]>;
        Relationships: [];
      };
      payment_refunds: {
        Row: {
          id: string;
          payment_event_id: string;
          user_id: string;
          refund_amount: number;
          reason: string | null;
          status: "PENDING" | "SUCCEEDED" | "FAILED";
          provider_refund_id: string | null;
          requested_by: string | null;
          idempotency_key: string;
          created_at: string;
          updated_at: string;
          processed_at: string | null;
        };
        Insert: {
          id?: string;
          payment_event_id: string;
          user_id: string;
          refund_amount: number;
          reason?: string | null;
          status?: "PENDING" | "SUCCEEDED" | "FAILED";
          provider_refund_id?: string | null;
          requested_by?: string | null;
          idempotency_key: string;
          created_at?: string;
          updated_at?: string;
          processed_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["payment_refunds"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      increment_ai_quota: {
        Args: { p_period: string; p_limit: number };
        Returns: { used_count: number; allowed: boolean }[];
      };
      increment_ai_credits: {
        Args: { p_period: string; p_amount: number; p_limit: number };
        Returns: { reservation_id: string | null; used_count: number; allowed: boolean }[];
      };
      refund_ai_credits: {
        Args: { p_reservation_id: string };
        Returns: undefined;
      };
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      admin_dashboard_stats: {
        Args: Record<string, never>;
        Returns: AdminDashboardStats;
      };
      admin_list_users: {
        Args: { p_search?: string | null; p_plan?: string | null; p_active?: string | null };
        Returns: AdminUserListRow[];
      };
      admin_user_detail: {
        Args: { p_user_id: string };
        Returns: AdminUserDetail;
      };
      admin_usage_grouped: {
        Args: { p_start: string; p_end: string };
        Returns: AdminUsageGroupedRow[];
      };
      admin_apply_subscription: {
        Args: {
          p_user_id: string;
          p_plan: string;
          p_subscription_status: string;
          p_started_at?: string | null;
          p_expires_at?: string | null;
          p_next_billing_at?: string | null;
          p_cancel_at_period_end?: boolean;
          p_payment_provider?: string | null;
          p_payment_customer_id?: string | null;
          p_payment_subscription_id?: string | null;
        };
        Returns: undefined;
      };
      claim_billing_attempt: {
        Args: {
          p_user_id: string;
          p_billing_period_start: string;
          p_plan: string;
          p_amount: number;
          p_payment_id: string;
        };
        Returns: {
          id: string;
          user_id: string;
          payment_id: string;
          plan: string;
          amount: number;
          status: "PENDING" | "PAID" | "FAILED";
          provider: string;
          kind: "INITIAL" | "RECURRING";
          billing_period_start: string | null;
          error_code: string | null;
          error_type: string | null;
          raw_response: Json | null;
          created_at: string;
          updated_at: string;
        }[];
      };
    };
  };
};

export type AdminDashboardStats = {
  total_users: number;
  active_30d: number;
  free_users: number;
  basic_users: number;
  pro_users: number;
  ai_calls_today: number;
  ai_calls_month: number;
  photo_analysis_month: number;
  blog_generation_month: number;
  ai_failures_month: number;
};

export type AdminUserListRow = {
  id: string;
  email: string;
  created_at: string;
  last_active_at: string;
  plan_tier: string;
  role: string;
  ai_calls_month: number;
  photo_analysis_month: number;
  blog_generation_month: number;
  fail_count_month: number;
  credits_used_month: number;
};

export type AdminUsageLogEntry = {
  id: string;
  feature: AiUsageFeature;
  operation: string | null;
  status?: "success" | "failed";
  error_type: string | null;
  provider: string;
  model: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  credits_used?: number | null;
  created_at: string;
};

export type AdminUserDetail = {
  id: string;
  email: string;
  display_name: string | null;
  plan_tier: string;
  role: string;
  created_at: string;
  last_sign_in_at: string | null;
  subscription_status: string;
  subscription_started_at: string | null;
  subscription_expires_at: string | null;
  next_billing_at: string | null;
  cancel_at_period_end: boolean;
  scheduled_plan: string | null;
  payment_provider: string | null;
  payment_customer_id: string | null;
  has_billing_key: boolean;
  retry_count: number;
  next_retry_at: string | null;
  last_payment_failed_at: string | null;
  last_payment_error_type: string | null;
  ai_calls_month: number;
  photo_analysis_month: number;
  blog_generation_month: number;
  credits_used_month: number;
  recent_logs: AdminUsageLogEntry[];
  failed_logs: AdminUsageLogEntry[];
  recent_payments: AdminPaymentEventEntry[];
  recent_refunds: AdminRefundEntry[];
};

export type AdminPaymentEventEntry = {
  id: string;
  kind: "INITIAL" | "RECURRING";
  plan: string;
  amount: number;
  status: "PENDING" | "PAID" | "FAILED";
  error_type: string | null;
  created_at: string;
};

export type AdminRefundEntry = {
  id: string;
  payment_event_id: string;
  refund_amount: number;
  reason: string | null;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  created_at: string;
};

export type AdminUsageGroupedRow = {
  day: string;
  user_id: string;
  email: string;
  feature: AiUsageFeature;
  operation: string | null;
  status: "success" | "failed";
  provider: string;
  model: string | null;
  call_count: number;
  input_tokens: number;
  output_tokens: number;
  credits_used: number;
};

export type UserProfile = Database["public"]["Tables"]["users"]["Row"];
export type Collaboration = Database["public"]["Tables"]["collaborations"]["Row"];
export type CollaborationGuide = Database["public"]["Tables"]["collaboration_guides"]["Row"];
export type Content = Database["public"]["Tables"]["contents"]["Row"];
export type Schedule = Database["public"]["Tables"]["schedules"]["Row"];
export type CreatorStyle = Database["public"]["Tables"]["creator_styles"]["Row"];
export type CollaborationPhoto = Database["public"]["Tables"]["collaboration_photos"]["Row"];
export type AiUsageLog = Database["public"]["Tables"]["ai_usage_logs"]["Row"];
