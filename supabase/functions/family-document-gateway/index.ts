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

const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

const array = (value: any) => Array.isArray(value) ? value : [];
const n = (value: any) => Number(value || 0);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? {}));

function same(a: any, b: any) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function appUserId(data: any, cloudUserId: string) {
  const user = array(data?.users).find((item: any) => String(item?.cloudUserId || "") === cloudUserId);
  return user ? n(user.id) : 0;
}

function stripPasswords(data: any) {
  const next = clone(data);
  next.users = array(next.users).map((user: any) => ({ ...user, password: "" }));
  return next;
}

const HEALTH_KINDS = new Set(["medicine", "therapy", "visit", "health-record"]);

function stripHealthData(value: any) {
  const data = stripPasswords(value);
  data.deadlines = array(data.deadlines).filter((item: any) => !HEALTH_KINDS.has(String(item?.kind || "")));
  return data;
}

function stripFinanceData(value: any) {
  const data = stripPasswords(value);
  data.users = array(data.users).map((user: any) => ({ ...user, balance: 0, password: "" }));
  data.chores = [];
  data.recurringChores = [];
  data.transactions = [];
  return data;
}

function stripSensitiveData(value: any) {
  return stripFinanceData(stripHealthData(value));
}

function mergeFinanceSnapshot(base: any, finance: any) {
  const data = stripPasswords(base);
  if (!finance || typeof finance !== "object") return data;
  const wallets = array(finance.wallets);
  const balances = new Map(wallets.map((wallet: any) => [n(wallet?.userId), Number(wallet?.balance || 0)]));
  data.users = array(data.users).map((user: any) =>
    balances.has(n(user?.id)) ? { ...user, balance: Number(balances.get(n(user?.id)) || 0), password: "" } : user
  );
  data.chores = array(finance.chores);
  data.recurringChores = array(finance.recurringChores);
  data.transactions = array(finance.transactions);
  return data;
}

async function callFinanceGateway(
  supabaseUrl: string,
  anonKey: string,
  authHeader: string,
  action: "read" | "sync",
  familyId: string,
  payload?: any
) {
  const response = await fetch(`${supabaseUrl}/functions/v1/finance-data-gateway`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": authHeader,
      "apikey": anonKey
    },
    body: JSON.stringify({
      action,
      familyId,
      ...(action === "sync" ? { data: payload || {} } : {})
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.ok !== true) {
    throw new Error(String(result?.error || `finance_gateway_http_${response.status}`));
  }
  return result;
}

function participants(event: any) {
  const ids = array(event?.userIds).map(n).filter(Boolean);
  if (ids.length) return ids;
  return n(event?.userId) ? [n(event.userId)] : [];
}

function redactForChild(fullData: any, childId: number) {
  const data = stripPasswords(fullData);

  data.users = array(data.users).map((user: any) => ({
    ...user,
    balance: n(user.id) === childId ? Number(user.balance || 0) : 0,
    password: ""
  }));

  data.calendarEvents = array(data.calendarEvents).filter((event: any) =>
    event?.audience === "family" || participants(event).includes(childId)
  );

  const ownTherapies = array(data.deadlines).filter((item: any) =>
    item?.kind === "therapy" && n(item?.userId) === childId
  );
  const medicineIds = new Set<number>();
  for (const therapy of ownTherapies) {
    for (const line of array(therapy?.therapyMedicines)) {
      const id = n(line?.medicineId);
      if (id) medicineIds.add(id);
    }
  }

  data.deadlines = array(data.deadlines).filter((item: any) => {
    const kind = String(item?.kind || "general");
    if (kind === "medicine") return medicineIds.has(n(item?.id));
    if (kind === "therapy" || kind === "visit" || kind === "health-record") return n(item?.userId) === childId;
    return !n(item?.userId) || n(item?.userId) === childId;
  });

  data.chores = array(data.chores).filter((item: any) => n(item?.userId) === childId);
  data.recurringChores = array(data.recurringChores).filter((item: any) => n(item?.userId) === childId);
  data.transactions = array(data.transactions).filter((item: any) => n(item?.userId) === childId);
  data.todos = array(data.todos).filter((item: any) => n(item?.userId) === childId);
  data.routines = array(data.routines).filter((item: any) => n(item?.userId) === childId);
  data.routineCompletions = array(data.routineCompletions).filter((item: any) => n(item?.userId) === childId);
  data.schoolTimetable = array(data.schoolTimetable).filter((item: any) => n(item?.userId) === childId);
  data.schoolItems = array(data.schoolItems).filter((item: any) => n(item?.userId) === childId);
  data.mealPlans = array(data.mealPlans).filter((item: any) => n(item?.userId) === childId || n(item?.userId) === 0);

  data.boardPosts = array(data.boardPosts).filter((post: any) =>
    n(post?.authorUserId) === childId ||
    post?.audience === "family" ||
    array(post?.userIds).map(n).includes(childId)
  );

  return data;
}

function uniqueIds(items: any[], key = "id") {
  const seen = new Set<string>();
  for (const item of items) {
    const id = String(item?.[key] ?? "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

function mergeChildChanges(fullData: any, incomingData: any, childId: number) {
  const full = stripPasswords(fullData);
  const incoming = stripPasswords(incomingData);

  const fullUsers = array(full.users);
  const incomingUsers = array(incoming.users);
  const currentUser = fullUsers.find((user: any) => n(user?.id) === childId);
  const incomingUser = incomingUsers.find((user: any) => n(user?.id) === childId);
  if (!currentUser || !incomingUser) throw new Error("child_profile_missing");

  const immutableUserFields = ["id", "cloudUserId", "role", "balance"];
  for (const key of immutableUserFields) {
    if (!same(currentUser?.[key], incomingUser?.[key])) throw new Error("forbidden_profile_change");
  }

  full.users = fullUsers.map((user: any) => n(user?.id) === childId ? {
    ...user,
    name: String(incomingUser?.name || user?.name || "Utente"),
    color: String(incomingUser?.color || user?.color || "#5B5BD6"),
    avatarUrl: String(incomingUser?.avatarUrl || ""),
    prefs: clone(incomingUser?.prefs || user?.prefs || {}),
    password: ""
  } : { ...user, password: "" });

  const incomingChores = array(incoming.chores);
  const fullChores = array(full.chores);
  if (!uniqueIds(incomingChores)) throw new Error("invalid_chore_ids");
  for (const proposed of incomingChores) {
    if (n(proposed?.userId) !== childId) throw new Error("forbidden_chore_change");
    const old = fullChores.find((item: any) => n(item?.id) === n(proposed?.id));
    if (!old) throw new Error("forbidden_chore_create");

    const immutable = ["id","title","deadline","userId","amount","done","approvedAt","approvedByUserId","creditedTransactionId","recurringChoreId"];
    for (const key of immutable) {
      if (!same(old?.[key], proposed?.[key])) throw new Error("forbidden_chore_change");
    }

    if (old?.done) {
      if (!same(old, proposed)) throw new Error("forbidden_approved_chore_change");
      continue;
    }

    const nextStatus = String(proposed?.completionStatus || "open");
    if (!["open","pending"].includes(nextStatus)) throw new Error("forbidden_chore_status");
    if (nextStatus === "pending" && n(proposed?.completedByUserId) !== childId) throw new Error("forbidden_chore_completion");
    if (nextStatus === "open" && (proposed?.completedAt || proposed?.completedByUserId)) throw new Error("forbidden_chore_completion");
  }

  full.chores = fullChores.map((old: any) => {
    if (n(old?.userId) !== childId || old?.done) return old;
    const proposed = incomingChores.find((item: any) => n(item?.id) === n(old?.id));
    if (!proposed) return old;
    return {
      ...old,
      completionStatus: proposed?.completionStatus === "pending" ? "pending" : "open",
      completedAt: proposed?.completionStatus === "pending" ? String(proposed?.completedAt || new Date().toISOString()) : undefined,
      completedByUserId: proposed?.completionStatus === "pending" ? childId : undefined
    };
  });

  const otherTodoIds = new Set(array(full.todos).filter((item: any) => n(item?.userId) !== childId).map((item: any) => String(item?.id)));
  const ownTodos = array(incoming.todos);
  if (!uniqueIds(ownTodos) || ownTodos.some((item: any) => n(item?.userId) !== childId || otherTodoIds.has(String(item?.id)))) {
    throw new Error("forbidden_todo_change");
  }
  full.todos = [
    ...array(full.todos).filter((item: any) => n(item?.userId) !== childId),
    ...ownTodos.map((item: any) => ({
      id: n(item?.id),
      title: String(item?.title || "").trim(),
      userId: childId,
      done: item?.done === true,
      createdAt: String(item?.createdAt || new Date().toISOString())
    })).filter((item: any) => item.id > 0 && item.title)
  ];

  const allowedRoutineIds = new Set(array(full.routines).filter((item: any) => n(item?.userId) === childId).map((item: any) => n(item?.id)));
  const otherCompletionIds = new Set(array(full.routineCompletions).filter((item: any) => n(item?.userId) !== childId).map((item: any) => String(item?.id)));
  const ownCompletions = array(incoming.routineCompletions);
  if (!uniqueIds(ownCompletions) || ownCompletions.some((item: any) =>
    n(item?.userId) !== childId ||
    !allowedRoutineIds.has(n(item?.routineId)) ||
    n(item?.completedByUserId) !== childId ||
    otherCompletionIds.has(String(item?.id))
  )) throw new Error("forbidden_routine_change");
  full.routineCompletions = [
    ...array(full.routineCompletions).filter((item: any) => n(item?.userId) !== childId),
    ...ownCompletions
  ];

  const otherSchoolIds = new Set(array(full.schoolItems).filter((item: any) => n(item?.userId) !== childId).map((item: any) => String(item?.id)));
  const ownSchoolItems = array(incoming.schoolItems);
  if (!uniqueIds(ownSchoolItems) || ownSchoolItems.some((item: any) => n(item?.userId) !== childId || otherSchoolIds.has(String(item?.id)))) {
    throw new Error("forbidden_school_change");
  }
  full.schoolItems = [
    ...array(full.schoolItems).filter((item: any) => n(item?.userId) !== childId),
    ...ownSchoolItems
  ];

  const otherBoardIds = new Set(array(full.boardPosts).filter((post: any) => n(post?.authorUserId) !== childId).map((post: any) => String(post?.id)));
  const ownPosts = array(incoming.boardPosts).filter((post: any) => n(post?.authorUserId) === childId);
  if (!uniqueIds(ownPosts) || ownPosts.some((post: any) => otherBoardIds.has(String(post?.id)))) throw new Error("forbidden_board_change");

  const existingOwnPosts = new Map(array(full.boardPosts)
    .filter((post: any) => n(post?.authorUserId) === childId)
    .map((post: any) => [String(post.id), post]));

  full.boardPosts = [
    ...array(full.boardPosts).filter((post: any) => n(post?.authorUserId) !== childId),
    ...ownPosts.map((post: any) => {
      const old = existingOwnPosts.get(String(post?.id));
      return {
        ...post,
        id: String(post?.id || crypto.randomUUID()),
        authorUserId: childId,
        pinned: old ? old.pinned === true : false,
        userIds: array(post?.userIds).map(n).filter(Boolean),
        attachments: array(post?.attachments),
        createdAt: old?.createdAt || post?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    })
  ];

  full.version = Math.max(n(full.version), n(incoming.version));
  return stripPasswords(full);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ ok: false, error: "unauthorized" }, 401);

    const { data: userResult, error: userError } = await admin.auth.getUser(token);
    const user = userResult?.user;
    if (userError || !user) return json({ ok: false, error: "unauthorized" }, 401);

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

    const [{ data: family, error: familyError }, { data: document, error: documentError }] = await Promise.all([
      admin.from("families").select("id,name").eq("id", familyId).single(),
      admin.from("family_documents").select("family_id,data,revision,updated_at,updated_by").eq("family_id", familyId).single()
    ]);

    if (familyError || documentError || !document) return json({ ok: false, error: "family_document_not_found" }, 404);

    const fullData = stripSensitiveData(document.data || {});
    const childId = role === "child" ? appUserId(fullData, user.id) : 0;
    if (role === "child" && !childId) return json({ ok: false, error: "child_identity_not_linked" }, 403);

    if (action === "read") {
      let output = role === "child" ? redactForChild(fullData, childId) : fullData;
      try {
        const finance = await callFinanceGateway(supabaseUrl, anonKey, authHeader, "read", familyId);
        output = mergeFinanceSnapshot(output, finance);
      } catch (financeError) {
        console.warn("family_gateway_finance_read_fallback", {
          familyId,
          userId: user.id,
          reason: financeError instanceof Error ? financeError.message : String(financeError)
        });
      }
      return json({
        ok: true,
        family: { id: family.id, name: family.name },
        role,
        revision: Number(document.revision || 0),
        updatedAt: document.updated_at,
        updatedBy: document.updated_by,
        data: output
      });
    }

    if (action !== "save") return json({ ok: false, error: "unsupported_action" }, 400);

    const expectedRevision = Number(body?.expectedRevision);
    const incoming = body?.data;
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) return json({ ok: false, error: "invalid_revision" }, 400);
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return json({ ok: false, error: "invalid_document" }, 400);

    const encoded = new TextEncoder().encode(JSON.stringify(incoming));
    if (encoded.byteLength > MAX_DOCUMENT_BYTES) return json({ ok: false, error: "document_too_large" }, 413);

    if (Number(document.revision || 0) !== expectedRevision) {
      let latest = role === "child" ? redactForChild(fullData, childId) : fullData;
      try {
        const finance = await callFinanceGateway(supabaseUrl, anonKey, authHeader, "read", familyId);
        latest = mergeFinanceSnapshot(latest, finance);
      } catch {
        // Family revision conflict remains actionable even if finance refresh is temporarily unavailable.
      }
      return json({
        ok: false,
        error: "revision_conflict",
        revision: Number(document.revision || 0),
        data: latest
      });
    }

    const normalizedClient = incoming?.storageModel === "normalized-v1";
    if (!normalizedClient) {
      try {
        await callFinanceGateway(supabaseUrl, anonKey, authHeader, "sync", familyId, incoming);
      } catch (financeError) {
        const message = financeError instanceof Error ? financeError.message : "finance_sync_failed";
        console.warn("legacy_finance_sync_denied", { familyId, userId: user.id, role, reason: message });
        return json({ ok: false, error: message }, 403);
      }
    }

    let nextData: any;
    try {
      const familyIncoming = stripFinanceData(incoming);
      nextData = stripSensitiveData(role === "child" ? mergeChildChanges(fullData, familyIncoming, childId) : familyIncoming);
    } catch (validationError) {
      const message = validationError instanceof Error ? validationError.message : "forbidden_change";
      console.warn("family_document_save_denied", { familyId, userId: user.id, role, reason: message });
      return json({ ok: false, error: message }, 403);
    }

    const nextRevision = expectedRevision + 1;
    const { data: updated, error: updateError } = await admin
      .from("family_documents")
      .update({
        data: nextData,
        revision: nextRevision,
        updated_by: user.id,
        updated_at: new Date().toISOString()
      })
      .eq("family_id", familyId)
      .eq("revision", expectedRevision)
      .select("revision")
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updated) {
      const { data: latest } = await admin
        .from("family_documents")
        .select("data,revision")
        .eq("family_id", familyId)
        .single();
      let latestOutput = role === "child"
        ? redactForChild(stripSensitiveData(latest?.data || {}), childId)
        : stripSensitiveData(latest?.data || {});
      try {
        const finance = await callFinanceGateway(supabaseUrl, anonKey, authHeader, "read", familyId);
        latestOutput = mergeFinanceSnapshot(latestOutput, finance);
      } catch {
        // Keep the family conflict response usable even during a temporary finance outage.
      }
      return json({
        ok: false,
        error: "revision_conflict",
        revision: Number(latest?.revision || expectedRevision),
        data: latestOutput
      });
    }

    let normalizedData: any = undefined;
    if (role === "child") {
      normalizedData = redactForChild(nextData, childId);
      try {
        const finance = await callFinanceGateway(supabaseUrl, anonKey, authHeader, "read", familyId);
        normalizedData = mergeFinanceSnapshot(normalizedData, finance);
      } catch {
        // The child save itself succeeded; polling will refresh finance if needed.
      }
    }

    return json({
      ok: true,
      revision: Number(updated.revision || nextRevision),
      data: normalizedData,
      normalized: role === "child"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("family_document_gateway_error", message);
    return json({ ok: false, error: "server_error" }, 500);
  }
});
