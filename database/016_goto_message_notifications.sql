-- Apply after 015_reply_template_routing.sql, before updating the API.
alter table public.goto_connections
 add column if not exists notification_last_error varchar(300),
 add column if not exists notification_verified_at timestamptz;
