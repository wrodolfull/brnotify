-- 009_ivr_key_no_expiration.sql
-- Only URA-only keys (messages:send) can be created without expiry by the API.
-- Existing key expirations remain untouched.
alter table public.integration_api_keys
  alter column expires_at drop not null;

-- Enforce the least-privilege guarantee also at database level, including
-- for any administrative SQL changes outside the API.
alter table public.integration_api_keys
  drop constraint if exists integration_api_keys_nonexpiring_ura_only;
alter table public.integration_api_keys
  add constraint integration_api_keys_nonexpiring_ura_only
  check (expires_at is not null or scopes = ARRAY['messages:send']::text[]);
