-- VerdoFamily production data safety layer.
-- Additive only: recycle bin, conflict drafts, and user-facing change history.

create table if not exists private.family_recycle_bin (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  deleted_by uuid references auth.users(id) on delete set null,
  module text not null,
  label text not null,
  payload jsonb not null default '{}'::jsonb,
  deleted_at timestamptz not null default now(),
  restored_at timestamptz,
  restored_by uuid references auth.users(id) on delete set null
);
alter table private.family_recycle_bin enable row level security;
create index if not exists family_recycle_bin_family_deleted_idx on private.family_recycle_bin(family_id,deleted_at desc);
revoke all on table private.family_recycle_bin from public,anon,authenticated;

create table if not exists private.family_conflict_drafts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  base_revision bigint not null,
  remote_revision bigint not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);
alter table private.family_conflict_drafts enable row level security;
create index if not exists family_conflict_drafts_family_created_idx on private.family_conflict_drafts(family_id,created_at desc);
revoke all on table private.family_conflict_drafts from public,anon,authenticated;

create or replace function public.archive_family_deleted_item(p_family_id uuid,p_module text,p_label text,p_payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_role text; v_id uuid; v_module text:=left(trim(coalesce(p_module,'')),60); v_label text:=left(trim(coalesce(p_label,'')),160);
begin
 if v_uid is null then raise exception 'not_authenticated'; end if;
 v_role:=private.family_role(p_family_id,v_uid);
 if v_role is null then raise exception 'not_family_member'; end if;
 if v_module='' then raise exception 'module_required'; end if;
 if pg_column_size(coalesce(p_payload,'{}'::jsonb))>524288 then raise exception 'recycle_payload_too_large'; end if;
 if not private.consume_security_rate_limit('archive_family_deleted_item',v_uid::text||':'||p_family_id::text,240,3600) then raise exception 'rate_limited'; end if;
 insert into private.family_recycle_bin(family_id,deleted_by,module,label,payload)
 values(p_family_id,v_uid,v_module,coalesce(nullif(v_label,''),'Elemento eliminato'),coalesce(p_payload,'{}'::jsonb)) returning id into v_id;
 perform private.write_security_audit(v_uid,p_family_id,'recycle_item_archived',true,'info','recycle_item',v_id::text,jsonb_build_object('module',v_module,'label',coalesce(nullif(v_label,''),'Elemento eliminato')));
 return v_id;
end $$;

create or replace function public.get_family_recycle_bin(p_family_id uuid,p_limit integer default 100)
returns table(id uuid,module text,label text,payload jsonb,deleted_at timestamptz,deleted_by uuid)
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_role text; v_limit integer:=least(greatest(coalesce(p_limit,100),1),250);
begin
 if v_uid is null then raise exception 'not_authenticated'; end if;
 v_role:=private.family_role(p_family_id,v_uid);
 if v_role not in ('admin','adult') then raise exception 'adult_or_admin_required'; end if;
 return query select r.id,r.module,r.label,r.payload,r.deleted_at,r.deleted_by
 from private.family_recycle_bin r where r.family_id=p_family_id and r.restored_at is null order by r.deleted_at desc limit v_limit;
end $$;

create or replace function public.mark_family_recycle_restored(p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_family_id uuid; v_role text;
begin
 if v_uid is null then raise exception 'not_authenticated'; end if;
 select r.family_id into v_family_id from private.family_recycle_bin r where r.id=p_id and r.restored_at is null;
 if v_family_id is null then return false; end if;
 v_role:=private.family_role(v_family_id,v_uid);
 if v_role not in ('admin','adult') then raise exception 'adult_or_admin_required'; end if;
 update private.family_recycle_bin set restored_at=now(),restored_by=v_uid where id=p_id and restored_at is null;
 perform private.write_security_audit(v_uid,v_family_id,'recycle_item_restored',true,'info','recycle_item',p_id::text,'{}'::jsonb);
 return found;
end $$;

create or replace function public.purge_family_recycle_item(p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_family_id uuid; v_role text;
begin
 if v_uid is null then raise exception 'not_authenticated'; end if;
 select r.family_id into v_family_id from private.family_recycle_bin r where r.id=p_id;
 if v_family_id is null then return false; end if;
 v_role:=private.family_role(v_family_id,v_uid);
 if v_role not in ('admin','adult') then raise exception 'adult_or_admin_required'; end if;
 perform private.write_security_audit(v_uid,v_family_id,'recycle_item_purged',true,'warning','recycle_item',p_id::text,'{}'::jsonb);
 delete from private.family_recycle_bin where id=p_id;
 return found;
end $$;

create or replace function public.save_family_conflict_draft(p_family_id uuid,p_base_revision bigint,p_remote_revision bigint,p_data jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_role text; v_id uuid;
begin
 if v_uid is null then raise exception 'not_authenticated'; end if;
 v_role:=private.family_role(p_family_id,v_uid);
 if v_role is null then raise exception 'not_family_member'; end if;
 if pg_column_size(coalesce(p_data,'{}'::jsonb))>6291456 then raise exception 'conflict_payload_too_large'; end if;
 if not private.consume_security_rate_limit('save_family_conflict_draft',v_uid::text||':'||p_family_id::text,30,3600) then raise exception 'rate_limited'; end if;
 insert into private.family_conflict_drafts(family_id,actor_user_id,base_revision,remote_revision,data)
 values(p_family_id,v_uid,greatest(coalesce(p_base_revision,0),0),greatest(coalesce(p_remote_revision,0),0),coalesce(p_data,'{}'::jsonb)) returning id into v_id;
 perform private.write_security_audit(v_uid,p_family_id,'family_conflict_draft_saved',true,'warning','conflict_draft',v_id::text,jsonb_build_object('baseRevision',p_base_revision,'remoteRevision',p_remote_revision));
 return v_id;
end $$;

create or replace function public.get_family_conflict_drafts(p_family_id uuid,p_limit integer default 20)
returns table(id uuid,actor_user_id uuid,base_revision bigint,remote_revision bigint,data jsonb,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_role text; v_limit integer:=least(greatest(coalesce(p_limit,20),1),50);
begin
 if v_uid is null then raise exception 'not_authenticated'; end if;
 v_role:=private.family_role(p_family_id,v_uid);
 if v_role not in ('admin','adult') then raise exception 'adult_or_admin_required'; end if;
 return query select d.id,d.actor_user_id,d.base_revision,d.remote_revision,d.data,d.created_at
 from private.family_conflict_drafts d where d.family_id=p_family_id and d.resolved_at is null order by d.created_at desc limit v_limit;
end $$;

create or replace function public.mark_family_conflict_resolved(p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_family_id uuid; v_role text;
begin
 if v_uid is null then raise exception 'not_authenticated'; end if;
 select d.family_id into v_family_id from private.family_conflict_drafts d where d.id=p_id and d.resolved_at is null;
 if v_family_id is null then return false; end if;
 v_role:=private.family_role(v_family_id,v_uid);
 if v_role not in ('admin','adult') then raise exception 'adult_or_admin_required'; end if;
 update private.family_conflict_drafts set resolved_at=now(),resolved_by=v_uid where id=p_id and resolved_at is null;
 perform private.write_security_audit(v_uid,v_family_id,'family_conflict_draft_resolved',true,'info','conflict_draft',p_id::text,'{}'::jsonb);
 return found;
end $$;

create or replace function public.get_family_change_history(p_family_id uuid,p_limit integer default 50)
returns table(id bigint,actor_user_id uuid,event_type text,success boolean,severity text,metadata jsonb,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_role text; v_limit integer:=least(greatest(coalesce(p_limit,50),1),200);
begin
 if v_uid is null then raise exception 'not_authenticated'; end if;
 v_role:=private.family_role(p_family_id,v_uid);
 if v_role not in ('admin','adult') then raise exception 'adult_or_admin_required'; end if;
 return query select l.id,l.actor_user_id,l.event_type,l.success,l.severity,l.metadata,l.created_at
 from private.security_audit_logs l where l.family_id=p_family_id and l.event_type in
 ('family_document_saved','family_document_conflict','family_backup_created','family_backup_restored','recycle_item_archived','recycle_item_restored','recycle_item_purged','family_conflict_draft_saved','family_conflict_draft_resolved')
 order by l.created_at desc limit v_limit;
end $$;

revoke all on function public.archive_family_deleted_item(uuid,text,text,jsonb) from public,anon;
grant execute on function public.archive_family_deleted_item(uuid,text,text,jsonb) to authenticated;
revoke all on function public.get_family_recycle_bin(uuid,integer) from public,anon;
grant execute on function public.get_family_recycle_bin(uuid,integer) to authenticated;
revoke all on function public.mark_family_recycle_restored(uuid) from public,anon;
grant execute on function public.mark_family_recycle_restored(uuid) to authenticated;
revoke all on function public.purge_family_recycle_item(uuid) from public,anon;
grant execute on function public.purge_family_recycle_item(uuid) to authenticated;
revoke all on function public.save_family_conflict_draft(uuid,bigint,bigint,jsonb) from public,anon;
grant execute on function public.save_family_conflict_draft(uuid,bigint,bigint,jsonb) to authenticated;
revoke all on function public.get_family_conflict_drafts(uuid,integer) from public,anon;
grant execute on function public.get_family_conflict_drafts(uuid,integer) to authenticated;
revoke all on function public.mark_family_conflict_resolved(uuid) from public,anon;
grant execute on function public.mark_family_conflict_resolved(uuid) to authenticated;
revoke all on function public.get_family_change_history(uuid,integer) from public,anon;
grant execute on function public.get_family_change_history(uuid,integer) to authenticated;
