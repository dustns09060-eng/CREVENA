-- STEP 17: track failed AI calls too (not just successful ones), plus real token usage.

alter table public.ai_usage_logs add column if not exists status text not null default 'success';
alter table public.ai_usage_logs drop constraint if exists ai_usage_logs_status_check;
alter table public.ai_usage_logs add constraint ai_usage_logs_status_check check (status in ('success', 'failed'));

alter table public.ai_usage_logs add column if not exists error_type text;
alter table public.ai_usage_logs add column if not exists input_tokens int;
alter table public.ai_usage_logs add column if not exists output_tokens int;

create index if not exists ai_usage_logs_status_idx on public.ai_usage_logs(user_id, status);
