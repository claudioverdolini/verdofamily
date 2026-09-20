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

async function notifyFamilyPush(admin: any, supabaseUrl: string, familyId: string, categories: string[], excludeUserId: string, details: any[] = []) {
  if (!categories.length) return;
  try {
    const { data: secretRow } = await admin
      .from("system_settings")
      .select("value")
      .eq("key", "push_cron_secret")
      .maybeSingle();
    if (!secretRow?.value) return;
    const response = await fetch(`${supabaseUrl}/functions/v1/push-notifications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-push-secret": String(secretRow.value)
      },
      body: JSON.stringify({
        action: "notify-system",
        familyId,
        categories,
        excludeUserId,
        details
      })
    });
    if (!response.ok) console.warn("push_notification_deferred", response.status);
  } catch (error) {
    console.warn("push_notification_deferred", error instanceof Error ? error.message : String(error));
  }
}


const arr = (value: any) => Array.isArray(value) ? value : [];
const n = (value: any) => Number(value || 0);
const s = (value: any) => String(value ?? "").trim();
const same = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function changedFinanceRecord(previous: any[], next: any[]) {
  const before = new Map(arr(previous).map((item: any) => [String(item?.id ?? ""), item]));
  const added = arr(next).find((item: any) => {
    const id = String(item?.id ?? "");
    return id && !before.has(id);
  });
  if (added) return { before: null, after: added };
  const changed = arr(next).find((item: any) => {
    const id = String(item?.id ?? "");
    return id && before.has(id) && JSON.stringify(before.get(id)) !== JSON.stringify(item);
  });
  return changed ? { before: before.get(String(changed?.id ?? "")), after: changed } : null;
}

function financePushDetails(previous: any, next: any) {
  const choreChange = changedFinanceRecord(previous?.chores || [], next?.chores || []);
  if (choreChange?.after) {
    const item = choreChange.after;
    const before = choreChange.before;
    const status = !before
      ? "new"
      : item?.completionStatus === "pending" && before?.completionStatus !== "pending"
        ? "pending"
        : item?.done === true && before?.done !== true
          ? "approved"
          : "updated";
    return [{
      category: "chores",
      kind: "chore",
      id: n(item?.id),
      title: s(item?.title) || "Compito",
      userId: n(item?.userId),
      deadline: s(item?.deadline),
      status,
      amount: Number(item?.amount || 0)
    }];
  }

  const recurringChange = changedFinanceRecord(previous?.recurringChores || [], next?.recurringChores || []);
  if (recurringChange?.after) {
    const item = recurringChange.after;
    return [{
      category: "chores",
      kind: "recurring",
      id: n(item?.id),
      title: s(item?.title) || "Compito ricorrente",
      userId: n(item?.userId),
      userIds: Array.from(new Set(arr(item?.userIds).map(n).filter((id: number) => id > 0))),
      status: recurringChange.before ? "updated" : "new",
      amount: Number(item?.amount || 0)
    }];
  }

  const txChange = changedFinanceRecord(previous?.transactions || [], next?.transactions || []);
  if (txChange?.after && !txChange.before) {
    const item = txChange.after;
    return [{
      category: "chores",
      kind: "transaction",
      id: n(item?.id),
      title: s(item?.note) || "Paghetta aggiornata",
      userId: n(item?.userId),
      type: s(item?.type),
      amount: Number(item?.amount || 0)
    }];
  }

  return [];
}

function cleanWeekdays(value: any) {
  return Array.from(new Set(arr(value).map(Number).filter(day => day >= 1 && day <= 7))).sort((a,b) => a-b);
}

async function readFinance(client: any, familyId: string) {
  const [peopleR, walletsR, recurringR, recurringAssigneesR, transactionsR, choresR] = await Promise.all([
    client.from("family_people").select("id,legacy_user_id").eq("family_id", familyId),
    client.from("finance_wallets").select("*").eq("family_id", familyId),
    client.from("finance_recurring_chores").select("*").eq("family_id", familyId),
    client.from("finance_recurring_chore_assignees").select("recurring_chore_id,person_id").eq("family_id", familyId),
    client.from("finance_transactions").select("*").eq("family_id", familyId),
    client.from("finance_chores").select("*").eq("family_id", familyId)
  ]);

  for (const [label, result] of [
    ["people", peopleR],
    ["wallets", walletsR],
    ["recurring chores", recurringR],
    ["recurring chore assignees", recurringAssigneesR],
    ["transactions", transactionsR],
    ["chores", choresR]
  ] as const) dbError(result.error, label);

  const people = peopleR.data || [];
  const personLegacy = new Map(people.map((row: any) => [String(row.id), Number(row.legacy_user_id)]));
  const txLegacy = new Map((transactionsR.data || []).map((row: any) => [String(row.id), Number(row.legacy_id)]));
  const recurringLegacy = new Map((recurringR.data || []).map((row: any) => [String(row.id), Number(row.legacy_id)]));
  const recurringAssignees = new Map<string, number[]>();
  for (const row of recurringAssigneesR.data || []) {
    const recurringId = String(row.recurring_chore_id || "");
    const legacyUserId = personLegacy.get(String(row.person_id)) || 0;
    if (!recurringId || legacyUserId <= 0) continue;
    const current = recurringAssignees.get(recurringId) || [];
    if (!current.includes(legacyUserId)) current.push(legacyUserId);
    recurringAssignees.set(recurringId, current);
  }

  const wallets = (walletsR.data || []).map((row: any) => ({
    userId: personLegacy.get(String(row.person_id)) || 0,
    balance: Number(row.balance || 0),
    currency: row.currency || "EUR"
  })).filter((row: any) => row.userId > 0);

  const recurringChores = (recurringR.data || []).map((row: any) => {
    const primaryUserId = personLegacy.get(String(row.person_id)) || 0;
    const userIds = Array.from(new Set([
      ...(recurringAssignees.get(String(row.id)) || []),
      ...(primaryUserId > 0 ? [primaryUserId] : [])
    ])).filter(id => id > 0);
    return {
      id: Number(row.legacy_id),
      title: String(row.title || "Compito ricorrente"),
      userId: userIds[0] || primaryUserId,
      userIds,
      amount: Number(row.amount || 0),
      weekdays: arr(row.weekdays).map(Number),
      active: row.active !== false,
      startDate: row.start_date,
      endDate: row.end_date || undefined
    };
  }).filter((row: any) => row.userId > 0 && row.userIds.length);

  const transactions = (transactionsR.data || []).map((row: any) => ({
    id: Number(row.legacy_id),
    userId: personLegacy.get(String(row.person_id)) || 0,
    type: row.type,
    amount: Number(row.amount || 0),
    date: row.transaction_date,
    note: String(row.note || ""),
    reversed: row.reversed === true
  })).filter((row: any) => row.userId > 0);

  const chores = (choresR.data || []).map((row: any) => ({
    id: Number(row.legacy_id),
    title: String(row.title || "Compito"),
    deadline: row.deadline,
    userId: personLegacy.get(String(row.person_id)) || 0,
    amount: Number(row.amount || 0),
    done: row.status === "approved",
    completionStatus: row.status,
    completedAt: row.completed_at || undefined,
    completedByUserId: row.completed_by_person_id ? personLegacy.get(String(row.completed_by_person_id)) || undefined : undefined,
    approvedAt: row.approved_at || undefined,
    approvedByUserId: row.approved_by_person_id ? personLegacy.get(String(row.approved_by_person_id)) || undefined : undefined,
    creditedTransactionId: row.credited_transaction_id ? txLegacy.get(String(row.credited_transaction_id)) || undefined : undefined,
    recurringChoreId: row.recurring_chore_id ? recurringLegacy.get(String(row.recurring_chore_id)) || undefined : undefined
  })).filter((row: any) => row.userId > 0);

  return { wallets, recurringChores, transactions, chores };
}

async function syncPeople(admin: any, familyId: string, users: any[]) {
  const rows = users
    .filter((user: any) => n(user?.id) > 0)
    .map((user: any) => ({
      family_id: familyId,
      legacy_user_id: n(user.id),
      auth_user_id: uuidPattern.test(String(user?.cloudUserId || "")) ? String(user.cloudUserId) : null,
      display_name: s(user?.name) || "Familiare",
      role: user?.role === "admin" ? "admin" : user?.role === "bimbo" ? "child" : "adult",
      updated_at: new Date().toISOString()
    }));

  if (!rows.length) return;
  const { error } = await admin.from("family_people").upsert(rows, { onConflict: "family_id,legacy_user_id" });
  dbError(error, "sync people");
}

async function syncAdultFinance(admin: any, familyId: string, snapshot: any) {
  const users = arr(snapshot?.users);
  const chores = arr(snapshot?.chores);
  const recurring = arr(snapshot?.recurringChores);
  const transactions = arr(snapshot?.transactions);

  const bytes = new TextEncoder().encode(JSON.stringify({ users, chores, recurring, transactions })).byteLength;
  if (bytes > 5 * 1024 * 1024) throw new Error("finance_payload_too_large");
  if (users.length > 200 || chores.length > 10000 || recurring.length > 2000 || transactions.length > 20000) {
    throw new Error("finance_payload_limit");
  }

  await syncPeople(admin, familyId, users);

  const { data: people, error: peopleError } = await admin
    .from("family_people")
    .select("id,legacy_user_id")
    .eq("family_id", familyId);
  dbError(peopleError, "read people");
  const personByLegacy = new Map((people || []).map((row: any) => [Number(row.legacy_user_id), String(row.id)]));

  const now = new Date().toISOString();
  const walletRows = users.map((user: any) => ({
    family_id: familyId,
    person_id: personByLegacy.get(n(user.id)),
    balance: Math.max(0, n(user.balance)),
    currency: "EUR",
    updated_at: now
  })).filter((row: any) => row.person_id);

  if (walletRows.length) {
    const { error } = await admin.from("finance_wallets").upsert(walletRows, { onConflict: "family_id,person_id" });
    dbError(error, "sync wallets");
  }

  const recurringAssignments = new Map<number, string[]>();
  const recurringRows = recurring.map((item: any) => {
    const legacyId = n(item.id);
    const requestedUserIds = Array.from(new Set([
      ...arr(item.userIds).map(n),
      ...(n(item.userId) > 0 ? [n(item.userId)] : [])
    ])).filter((id: number) => id > 0);
    const personIds = requestedUserIds
      .map((legacyUserId: number) => personByLegacy.get(legacyUserId))
      .filter((value: any): value is string => Boolean(value));
    if (legacyId > 0 && personIds.length) recurringAssignments.set(legacyId, Array.from(new Set(personIds)));
    return {
      family_id: familyId,
      legacy_id: legacyId,
      person_id: personIds[0],
      title: s(item.title) || "Compito ricorrente",
      amount: Math.max(0, n(item.amount)),
      weekdays: cleanWeekdays(item.weekdays),
      active: item.active !== false,
      start_date: s(item.startDate) || new Date().toISOString().slice(0,10),
      end_date: s(item.endDate) || null,
      updated_at: now
    };
  }).filter((row: any) => row.legacy_id > 0 && row.person_id && row.weekdays.length);

  if (recurringRows.length) {
    const { error } = await admin.from("finance_recurring_chores").upsert(recurringRows, { onConflict: "family_id,legacy_id" });
    dbError(error, "sync recurring chores");
  }

  const transactionRows = transactions.map((item: any) => ({
    family_id: familyId,
    legacy_id: n(item.id),
    person_id: personByLegacy.get(n(item.userId)),
    type: ["credit","payment","reversal"].includes(String(item.type)) ? item.type : "credit",
    amount: Math.max(0, n(item.amount)),
    transaction_date: s(item.date) || new Date().toISOString().slice(0,10),
    note: String(item.note || ""),
    reversed: item.reversed === true,
    updated_at: now
  })).filter((row: any) => row.legacy_id > 0 && row.person_id);

  if (transactionRows.length) {
    const { error } = await admin.from("finance_transactions").upsert(transactionRows, { onConflict: "family_id,legacy_id" });
    dbError(error, "sync transactions");
  }

  const [{ data: recurringDb, error: recurringError }, { data: txDb, error: txError }] = await Promise.all([
    admin.from("finance_recurring_chores").select("id,legacy_id").eq("family_id", familyId),
    admin.from("finance_transactions").select("id,legacy_id").eq("family_id", familyId)
  ]);
  dbError(recurringError, "read recurring chores");
  dbError(txError, "read transactions");
  const recurringByLegacy = new Map((recurringDb || []).map((row: any) => [Number(row.legacy_id), String(row.id)]));
  const txByLegacy = new Map((txDb || []).map((row: any) => [Number(row.legacy_id), String(row.id)]));

  const assigneeRows: any[] = [];
  for (const [legacyId, personIds] of recurringAssignments.entries()) {
    const recurringId = recurringByLegacy.get(legacyId);
    if (!recurringId) continue;
    for (const personId of personIds) {
      assigneeRows.push({
        family_id: familyId,
        recurring_chore_id: recurringId,
        person_id: personId
      });
    }
  }

  if (assigneeRows.length) {
    const { error } = await admin
      .from("finance_recurring_chore_assignees")
      .upsert(assigneeRows, { onConflict: "recurring_chore_id,person_id" });
    dbError(error, "sync recurring chore assignees");
  }

  const { data: currentAssignees, error: currentAssigneesError } = await admin
    .from("finance_recurring_chore_assignees")
    .select("recurring_chore_id,person_id")
    .eq("family_id", familyId);
  dbError(currentAssigneesError, "read recurring chore assignees");
  const keepAssignees = new Set(assigneeRows.map((row: any) => `${row.recurring_chore_id}:${row.person_id}`));
  for (const row of currentAssignees || []) {
    const key = `${row.recurring_chore_id}:${row.person_id}`;
    if (!keepAssignees.has(key)) {
      const { error } = await admin
        .from("finance_recurring_chore_assignees")
        .delete()
        .eq("recurring_chore_id", row.recurring_chore_id)
        .eq("person_id", row.person_id);
      dbError(error, "delete recurring chore assignee");
    }
  }

  const choreRows = chores.map((item: any) => ({
    family_id: familyId,
    legacy_id: n(item.id),
    person_id: personByLegacy.get(n(item.userId)),
    title: s(item.title) || "Compito",
    deadline: s(item.deadline) || new Date().toISOString().slice(0,10),
    amount: Math.max(0, n(item.amount)),
    status: item.done === true ? "approved" : item.completionStatus === "pending" ? "pending" : "open",
    completed_at: s(item.completedAt) || null,
    completed_by_person_id: personByLegacy.get(n(item.completedByUserId)) || null,
    approved_at: s(item.approvedAt) || null,
    approved_by_person_id: personByLegacy.get(n(item.approvedByUserId)) || null,
    credited_transaction_id: txByLegacy.get(n(item.creditedTransactionId)) || null,
    recurring_chore_id: recurringByLegacy.get(n(item.recurringChoreId)) || null,
    updated_at: now
  })).filter((row: any) => row.legacy_id > 0 && row.person_id);

  if (choreRows.length) {
    const { error } = await admin.from("finance_chores").upsert(choreRows, { onConflict: "family_id,legacy_id" });
    dbError(error, "sync chores");
  }

  const keepChores = new Set(choreRows.map((row: any) => row.legacy_id));
  const keepRecurring = new Set(recurringRows.map((row: any) => row.legacy_id));
  const keepTransactions = new Set(transactionRows.map((row: any) => row.legacy_id));

  const [{ data: choresDb }, { data: recurringAll }, { data: txAll }] = await Promise.all([
    admin.from("finance_chores").select("id,legacy_id").eq("family_id", familyId),
    admin.from("finance_recurring_chores").select("id,legacy_id").eq("family_id", familyId),
    admin.from("finance_transactions").select("id,legacy_id").eq("family_id", familyId)
  ]);

  for (const row of choresDb || []) {
    if (!keepChores.has(Number(row.legacy_id))) {
      const { error } = await admin.from("finance_chores").delete().eq("id", row.id);
      dbError(error, "delete chore");
    }
  }
  for (const row of recurringAll || []) {
    if (!keepRecurring.has(Number(row.legacy_id))) {
      const { error } = await admin.from("finance_recurring_chores").delete().eq("id", row.id);
      dbError(error, "delete recurring chore");
    }
  }
  for (const row of txAll || []) {
    if (!keepTransactions.has(Number(row.legacy_id))) {
      const { error } = await admin.from("finance_transactions").delete().eq("id", row.id);
      dbError(error, "delete transaction");
    }
  }
}

async function syncChildFinance(admin: any, familyId: string, userId: string, snapshot: any) {
  const { data: person, error: personError } = await admin
    .from("family_people")
    .select("id,legacy_user_id")
    .eq("family_id", familyId)
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (personError || !person) throw new Error("child_identity_not_linked");

  const childId = Number(person.legacy_user_id);
  const incomingChores = arr(snapshot?.chores);
  if (incomingChores.length > 5000) throw new Error("finance_payload_limit");

  const [
    { data: currentRows, error: currentError },
    { data: txRows, error: txError },
    { data: recurringRows, error: recurringError }
  ] = await Promise.all([
    admin
      .from("finance_chores")
      .select("*")
      .eq("family_id", familyId)
      .eq("person_id", person.id),
    admin
      .from("finance_transactions")
      .select("id,legacy_id")
      .eq("family_id", familyId),
    admin
      .from("finance_recurring_chores")
      .select("id,legacy_id")
      .eq("family_id", familyId)
  ]);
  dbError(currentError, "read child chores");
  dbError(txError, "read child transactions");
  dbError(recurringError, "read child recurring chores");

  const currentByLegacy = new Map((currentRows || []).map((row: any) => [Number(row.legacy_id), row]));
  const txLegacyById = new Map((txRows || []).map((row: any) => [String(row.id), Number(row.legacy_id)]));
  const recurringLegacyById = new Map((recurringRows || []).map((row: any) => [String(row.id), Number(row.legacy_id)]));

  for (const proposed of incomingChores) {
    if (n(proposed?.userId) !== childId) throw new Error("forbidden_chore_change");
    const current = currentByLegacy.get(n(proposed?.id));
    if (!current) throw new Error("forbidden_chore_create");

    const currentRecurring = current.recurring_chore_id ? recurringLegacyById.get(String(current.recurring_chore_id)) : undefined;
    const currentTx = current.credited_transaction_id ? txLegacyById.get(String(current.credited_transaction_id)) : undefined;
    const immutablePairs = [
      [current.title, proposed?.title],
      [String(current.deadline), proposed?.deadline],
      [Number(current.amount || 0), Number(proposed?.amount || 0)],
      [currentRecurring, proposed?.recurringChoreId],
      [currentTx, proposed?.creditedTransactionId]
    ];
    if (immutablePairs.some(([a,b]) => !same(a,b))) throw new Error("forbidden_chore_change");
    if (current.status === "approved") {
      if (!proposed?.done || proposed?.completionStatus !== "approved") throw new Error("forbidden_approved_chore_change");
      continue;
    }

    const nextStatus = proposed?.completionStatus === "pending" ? "pending" : "open";
    if (nextStatus === "pending" && n(proposed?.completedByUserId) !== childId) {
      throw new Error("forbidden_chore_completion");
    }
    if (nextStatus === "open" && (proposed?.completedAt || proposed?.completedByUserId)) {
      throw new Error("forbidden_chore_completion");
    }

    const update = nextStatus === "pending"
      ? {
          status: "pending",
          completed_at: s(proposed?.completedAt) || new Date().toISOString(),
          completed_by_person_id: person.id,
          updated_at: new Date().toISOString()
        }
      : {
          status: "open",
          completed_at: null,
          completed_by_person_id: null,
          updated_at: new Date().toISOString()
        };

    const { error } = await admin.from("finance_chores").update(update).eq("id", current.id);
    dbError(error, "update child chore");
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
      const data = await readFinance(userClient, familyId);
      return json({ ok: true, role, ...data });
    }

    if (action === "sync") {
      const expectedRevision = body?.expectedRevision;
      if (expectedRevision !== undefined && expectedRevision !== null) {
        const revisionNumber = Number(expectedRevision);
        if (!Number.isInteger(revisionNumber) || revisionNumber < 0) {
          return json({ ok: false, error: "invalid_expected_revision" }, 400);
        }
        const { data: revisionRow, error: revisionError } = await admin
          .from("family_documents")
          .select("revision")
          .eq("family_id", familyId)
          .single();
        if (revisionError || !revisionRow) return json({ ok: false, error: "family_document_not_found" }, 404);
        if (Number(revisionRow.revision || 0) !== revisionNumber) {
          return json({
            ok: false,
            error: "expected_revision_conflict",
            revision: Number(revisionRow.revision || 0)
          });
        }
      }
      const allowed = await rateLimit(
        admin,
        "finance_sync",
        `${user.id}:${familyId}`,
        role === "child" ? 60 : 120,
        600
      );
      if (!allowed) {
        await audit(admin, {
          actorUserId: user.id, familyId, eventType: "finance_sync_rate_limited",
          success: false, severity: "warning", targetType: "finance", targetId: familyId,
          metadata: { role }
        });
        return json({ ok: false, error: "rate_limited" }, 429);
      }

      const pushBefore = await readFinance(userClient, familyId);

      if (role === "child") await syncChildFinance(admin, familyId, user.id, body?.data || {});
      else if (["admin","adult"].includes(role)) await syncAdultFinance(admin, familyId, body?.data || {});
      else return json({ ok: false, error: "forbidden" }, 403);

      await audit(admin, {
        actorUserId: user.id, familyId, eventType: "finance_synced",
        targetType: "finance", targetId: familyId,
        metadata: {
          role,
          chores: arr(body?.data?.chores).length,
          recurringChores: arr(body?.data?.recurringChores).length,
          transactions: arr(body?.data?.transactions).length
        }
      });

      const data = await readFinance(userClient, familyId);
      await notifyFamilyPush(admin, supabaseUrl, familyId, ["chores"], user.id, financePushDetails(pushBefore, data));
      return json({ ok: true, role, ...data });
    }

    return json({ ok: false, error: "unsupported_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("finance-data-gateway", message);
    const clientErrors = new Set([
      "child_identity_not_linked",
      "forbidden_chore_change",
      "forbidden_chore_create",
      "forbidden_approved_chore_change",
      "forbidden_chore_completion",
      "finance_payload_limit",
      "finance_payload_too_large"
    ]);
    return json({ ok: false, error: clientErrors.has(message) ? message : "server_error" }, clientErrors.has(message) ? 403 : 500);
  }
});
