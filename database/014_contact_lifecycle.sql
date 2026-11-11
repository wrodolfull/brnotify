-- Contact lifecycle: separate operational active status from WhatsApp opt-in.
-- This is a reversible schema addition; existing contacts remain active.
alter table public.contacts
 add column if not exists is_active boolean not null default true;
create index if not exists contacts_tenant_active_created_idx
 on public.contacts(tenant_id,is_active,created_at desc,id desc);
-- Do not change opted_out_at when deactivating a contact:
-- a WhatsApp opt-out is legally distinct from an operational archive.
