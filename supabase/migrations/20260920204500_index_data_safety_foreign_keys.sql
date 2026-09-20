-- Supporting indexes for private safety-table foreign keys.
create index if not exists family_recycle_bin_deleted_by_idx
  on private.family_recycle_bin(deleted_by);
create index if not exists family_recycle_bin_restored_by_idx
  on private.family_recycle_bin(restored_by);
create index if not exists family_conflict_drafts_actor_user_idx
  on private.family_conflict_drafts(actor_user_id);
create index if not exists family_conflict_drafts_resolved_by_idx
  on private.family_conflict_drafts(resolved_by);
