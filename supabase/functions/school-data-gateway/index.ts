import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", ...cors }
});

const arr = (value: any) => Array.isArray(value) ? value : [];
const n = (value: any) => Number(value || 0);
const s = (value: any) => String(value ?? "").trim();
const SCHOOL_TYPES = new Set(["homework","test","oral","material","circular","permission","trip","payment"]);

function dbError(error: any, label: string) {
  if (!error) return;
  throw new Error(`${label}: ${error.message || String(error)}`);
}

async function rateLimit(admin: any, scope: string, subjectKey: string, limit: number, windowSeconds: number) {
  const { data, error } = await admin.rpc("system_security_rate_limit", {
    p_scope: scope,
    p_subject_key: subjectKey,
    p_limit: limit,
    p_window_seconds: windowSeconds
  });
  if (error) throw error;
  return data === true;
}

async function audit(admin: any, event: {
  actorUserId?: string | null;
  familyId?: string | null;
  eventType: string;
  success?: boolean;
  severity?: "info" | "warning" | "critical";
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await admin.rpc("system_security_audit", {
    p_actor_user_id: event.actorUserId || null,
    p_family_id: event.familyId || null,
    p_event_type: event.eventType,
    p_success: event.success !== false,
    p_severity: event.severity || "info",
    p_target_type: event.targetType || null,
    p_target_id: event.targetId || null,
    p_metadata: event.metadata || {}
  });
  if (error) console.warn("security_audit_failed", error.message);
}

function uniqueLegacyIds(items: any[]) {
  const seen = new Set<number>();
  for (const item of items) {
    const id = n(item?.id);
    if (id <= 0 || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

async function peopleMap(admin: any, familyId: string) {
  const { data, error } = await admin
    .from("family_people")
    .select("id,legacy_user_id,auth_user_id")
    .eq("family_id", familyId);
  dbError(error, "read people");
  const rows = data || [];
  return {
    rows,
    legacyById: new Map(rows.map((row: any) => [String(row.id), Number(row.legacy_user_id)])),
    idByLegacy: new Map(rows.map((row: any) => [Number(row.legacy_user_id), String(row.id)]))
  };
}

async function readSchool(userClient: any, admin: any, familyId: string) {
  const [people, subjectsR, timetableR, itemsR] = await Promise.all([
    peopleMap(admin, familyId),
    userClient.from("school_subjects").select("*").eq("family_id", familyId).order("legacy_id"),
    userClient.from("school_timetable_entries").select("*").eq("family_id", familyId).order("weekday").order("lesson_order"),
    userClient.from("school_items").select("*").eq("family_id", familyId).order("item_date").order("legacy_id")
  ]);
  dbError(subjectsR.error, "read subjects");
  dbError(timetableR.error, "read timetable");
  dbError(itemsR.error, "read school items");

  const subjectLegacyById = new Map((subjectsR.data || []).map((row: any) => [String(row.id), Number(row.legacy_id)]));

  const schoolSubjects = (subjectsR.data || []).map((row: any) => ({
    id: Number(row.legacy_id),
    name: String(row.name || "Materia"),
    shortName: row.short_name || undefined
  }));

  const schoolTimetable = (timetableR.data || []).map((row: any) => ({
    id: Number(row.legacy_id),
    userId: people.legacyById.get(String(row.person_id)) || 0,
    weekday: Number(row.weekday),
    order: Number(row.lesson_order),
    subjectId: subjectLegacyById.get(String(row.subject_id)) || 0,
    startTime: row.start_time ? String(row.start_time).slice(0,5) : undefined,
    endTime: row.end_time ? String(row.end_time).slice(0,5) : undefined,
    room: row.room || undefined,
    notes: row.notes || undefined
  })).filter((row: any) => row.userId > 0 && row.subjectId > 0);

  const schoolItems = (itemsR.data || []).map((row: any) => ({
    id: Number(row.legacy_id),
    userId: people.legacyById.get(String(row.person_id)) || 0,
    type: row.type,
    title: String(row.title || "Impegno scolastico"),
    date: row.item_date,
    subjectId: row.subject_id ? subjectLegacyById.get(String(row.subject_id)) || undefined : undefined,
    notes: row.notes || undefined,
    amount: row.amount === null || row.amount === undefined ? undefined : Number(row.amount),
    done: row.done === true,
    createdAt: row.created_on
  })).filter((row: any) => row.userId > 0);

  return { schoolSubjects, schoolTimetable, schoolItems };
}

async function syncAdultSchool(admin: any, familyId: string, snapshot: any) {
  const subjects = arr(snapshot?.schoolSubjects);
  const timetable = arr(snapshot?.schoolTimetable);
  const items = arr(snapshot?.schoolItems);
  if (subjects.length > 500 || timetable.length > 5000 || items.length > 10000) {
    throw new Error("school_payload_limit");
  }
  if (!uniqueLegacyIds(subjects) || !uniqueLegacyIds(timetable) || !uniqueLegacyIds(items)) {
    throw new Error("invalid_school_ids");
  }

  const people = await peopleMap(admin, familyId);
  const now = new Date().toISOString();

  const subjectRows = subjects.map((subject: any) => ({
    family_id: familyId,
    legacy_id: n(subject.id),
    name: s(subject.name) || "Materia",
    short_name: s(subject.shortName) || null,
    updated_at: now
  }));
  if (subjectRows.length) {
    const { error } = await admin.from("school_subjects").upsert(subjectRows, { onConflict: "family_id,legacy_id" });
    dbError(error, "sync subjects");
  }

  const { data: subjectDb, error: subjectError } = await admin
    .from("school_subjects")
    .select("id,legacy_id")
    .eq("family_id", familyId);
  dbError(subjectError, "read subject ids");
  const subjectIdByLegacy = new Map((subjectDb || []).map((row: any) => [Number(row.legacy_id), String(row.id)]));

  const timetableRows = timetable.map((entry: any) => ({
    family_id: familyId,
    legacy_id: n(entry.id),
    person_id: people.idByLegacy.get(n(entry.userId)),
    weekday: Math.min(7, Math.max(1, n(entry.weekday) || 1)),
    lesson_order: Math.max(1, n(entry.order) || 1),
    subject_id: subjectIdByLegacy.get(n(entry.subjectId)),
    start_time: s(entry.startTime) || null,
    end_time: s(entry.endTime) || null,
    room: s(entry.room) || null,
    notes: s(entry.notes) || null,
    updated_at: now
  })).filter((row: any) => row.person_id && row.subject_id);
  if (timetableRows.length) {
    const { error } = await admin.from("school_timetable_entries").upsert(timetableRows, { onConflict: "family_id,legacy_id" });
    dbError(error, "sync timetable");
  }

  const itemRows = items.map((item: any) => ({
    family_id: familyId,
    legacy_id: n(item.id),
    person_id: people.idByLegacy.get(n(item.userId)),
    type: SCHOOL_TYPES.has(String(item.type)) ? String(item.type) : "homework",
    title: s(item.title) || "Impegno scolastico",
    item_date: s(item.date) || new Date().toISOString().slice(0,10),
    subject_id: n(item.subjectId) > 0 ? subjectIdByLegacy.get(n(item.subjectId)) || null : null,
    notes: s(item.notes) || null,
    amount: item.amount === undefined || item.amount === null ? null : Math.max(0, n(item.amount)),
    done: item.done === true,
    created_on: s(item.createdAt) || new Date().toISOString().slice(0,10),
    updated_at: now
  })).filter((row: any) => row.person_id);
  if (itemRows.length) {
    const { error } = await admin.from("school_items").upsert(itemRows, { onConflict: "family_id,legacy_id" });
    dbError(error, "sync school items");
  }

  const [allTimetable, allItems, allSubjects] = await Promise.all([
    admin.from("school_timetable_entries").select("id,legacy_id").eq("family_id", familyId),
    admin.from("school_items").select("id,legacy_id").eq("family_id", familyId),
    admin.from("school_subjects").select("id,legacy_id").eq("family_id", familyId)
  ]);
  dbError(allTimetable.error, "read timetable cleanup");
  dbError(allItems.error, "read items cleanup");
  dbError(allSubjects.error, "read subjects cleanup");

  const keepTimetable = new Set(timetableRows.map((row: any) => Number(row.legacy_id)));
  const keepItems = new Set(itemRows.map((row: any) => Number(row.legacy_id)));
  const keepSubjects = new Set(subjectRows.map((row: any) => Number(row.legacy_id)));

  for (const row of allTimetable.data || []) {
    if (!keepTimetable.has(Number(row.legacy_id))) {
      const { error } = await admin.from("school_timetable_entries").delete().eq("id", row.id);
      dbError(error, "delete timetable entry");
    }
  }
  for (const row of allItems.data || []) {
    if (!keepItems.has(Number(row.legacy_id))) {
      const { error } = await admin.from("school_items").delete().eq("id", row.id);
      dbError(error, "delete school item");
    }
  }
  for (const row of allSubjects.data || []) {
    if (!keepSubjects.has(Number(row.legacy_id))) {
      const { error } = await admin.from("school_subjects").delete().eq("id", row.id);
      dbError(error, "delete subject");
    }
  }
}

async function syncChildSchool(admin: any, familyId: string, authUserId: string, snapshot: any) {
  const people = await peopleMap(admin, familyId);
  const person = people.rows.find((row: any) => String(row.auth_user_id || "") === authUserId);
  if (!person) throw new Error("child_identity_not_linked");
  const childId = Number(person.legacy_user_id);

  const incoming = arr(snapshot?.schoolItems);
  if (incoming.length > 5000 || !uniqueLegacyIds(incoming)) throw new Error("invalid_school_ids");
  if (incoming.some((item: any) => n(item?.userId) !== childId)) throw new Error("forbidden_school_change");

  const [{ data: ownRows, error: ownError }, { data: allRows, error: allError }, { data: subjects, error: subjectError }] = await Promise.all([
    admin.from("school_items").select("id,legacy_id").eq("family_id", familyId).eq("person_id", person.id),
    admin.from("school_items").select("id,legacy_id,person_id").eq("family_id", familyId),
    admin.from("school_subjects").select("id,legacy_id").eq("family_id", familyId)
  ]);
  dbError(ownError, "read child items");
  dbError(allError, "read family school ids");
  dbError(subjectError, "read subjects");

  const ownByLegacy = new Map((ownRows || []).map((row: any) => [Number(row.legacy_id), row]));
  const usedByLegacy = new Map((allRows || []).map((row: any) => [Number(row.legacy_id), row]));
  const subjectIdByLegacy = new Map((subjects || []).map((row: any) => [Number(row.legacy_id), String(row.id)]));
  let nextLegacyId = Math.max(0, ...(allRows || []).map((row: any) => Number(row.legacy_id) || 0)) + 1;
  const keepIds = new Set<string>();
  const now = new Date().toISOString();

  for (const item of incoming) {
    let legacyId = n(item.id);
    const existing = ownByLegacy.get(legacyId);
    const collision = usedByLegacy.get(legacyId);
    if (!existing && collision && String(collision.person_id) !== String(person.id)) {
      legacyId = nextLegacyId++;
    }

    const row = {
      family_id: familyId,
      legacy_id: legacyId,
      person_id: person.id,
      type: SCHOOL_TYPES.has(String(item.type)) ? String(item.type) : "homework",
      title: s(item.title) || "Impegno scolastico",
      item_date: s(item.date) || new Date().toISOString().slice(0,10),
      subject_id: n(item.subjectId) > 0 ? subjectIdByLegacy.get(n(item.subjectId)) || null : null,
      notes: s(item.notes) || null,
      amount: item.amount === undefined || item.amount === null ? null : Math.max(0, n(item.amount)),
      done: item.done === true,
      created_on: s(item.createdAt) || new Date().toISOString().slice(0,10),
      updated_at: now
    };

    if (existing) {
      const { data: updated, error } = await admin.from("school_items").update(row).eq("id", existing.id).select("id").single();
      dbError(error, "update child school item");
      keepIds.add(String(updated.id));
    } else {
      const { data: inserted, error } = await admin.from("school_items").insert(row).select("id").single();
      dbError(error, "create child school item");
      keepIds.add(String(inserted.id));
    }
  }

  for (const row of ownRows || []) {
    if (!keepIds.has(String(row.id))) {
      const { error } = await admin.from("school_items").delete().eq("id", row.id);
      dbError(error, "delete child school item");
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ ok: false, error: "unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
    const { data: userResult, error: userError } = await admin.auth.getUser(token);
    const user = userResult?.user;
    if (userError || !user) return json({ ok: false, error: "unauthorized" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } }
    });

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "read");
    const familyId = String(body?.familyId || "").trim();
    if (!familyId) return json({ ok: false, error: "family_id_required" }, 400);

    const { data: membership, error: membershipError } = await admin
      .from("family_members")
      .select("role")
      .eq("family_id", familyId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (membershipError || !membership) return json({ ok: false, error: "forbidden" }, 403);
    const role = String(membership.role || "adult");

    if (action === "read") {
      return json({ ok: true, role, ...(await readSchool(userClient, admin, familyId)) });
    }

    if (action === "sync") {
      const allowed = await rateLimit(
        admin,
        "school_sync",
        `${user.id}:${familyId}`,
        role === "child" ? 60 : 120,
        600
      );
      if (!allowed) {
        await audit(admin, {
          actorUserId: user.id, familyId, eventType: "school_sync_rate_limited",
          success: false, severity: "warning", targetType: "school", targetId: familyId,
          metadata: { role }
        });
        return json({ ok: false, error: "rate_limited" }, 429);
      }

      if (role === "child") await syncChildSchool(admin, familyId, user.id, body?.data || {});
      else if (role === "adult" || role === "admin") await syncAdultSchool(admin, familyId, body?.data || {});
      else return json({ ok: false, error: "forbidden" }, 403);

      await audit(admin, {
        actorUserId: user.id, familyId, eventType: "school_synced",
        targetType: "school", targetId: familyId,
        metadata: {
          role,
          subjects: arr(body?.data?.schoolSubjects).length,
          timetable: arr(body?.data?.schoolTimetable).length,
          items: arr(body?.data?.schoolItems).length
        }
      });

      return json({ ok: true, role, ...(await readSchool(userClient, admin, familyId)) });
    }

    return json({ ok: false, error: "unsupported_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("school-data-gateway", message);
    const clientErrors = new Set([
      "school_payload_limit",
      "invalid_school_ids",
      "child_identity_not_linked",
      "forbidden_school_change"
    ]);
    return json({ ok: false, error: clientErrors.has(message) ? message : "server_error" }, clientErrors.has(message) ? 403 : 500);
  }
});
