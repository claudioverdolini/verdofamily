# Cloud architecture

VerdoFamily uses Supabase Auth for account identity and a family-scoped versioned JSON document for the existing app data model.

- `profiles`: user profile metadata.
- `families`: family containers and owner.
- `family_members`: membership and role (`admin`, `adult`, `child`).
- `family_invites`: expiring single/multi-use invite codes.
- `family_documents`: versioned shared FamilyData JSON, protected by RLS and updated via optimistic-concurrency RPC.

The browser subscribes to Realtime updates for the current family document. Local cache remains available for continuity, but cloud-linked family passwords are stripped before upload. RLS and security-definer RPCs enforce family membership and admin-only operations.