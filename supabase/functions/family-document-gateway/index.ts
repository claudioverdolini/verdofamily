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

function changedRecord(previous: any[], next: any[], key = "id") {
  const before = new Map(array(previous).map((item: any) => [String(item?.[key] ?? ""), item]));
  const added = array(next).find((item: any) => {
    const id = String(item?.[key] ?? "");
    return id && !before.has(id);
  });
  if (added) return { before: null, after: added };
  const changed = array(next).find((item: any) => {
    const id = String(item?.[key] ?? "");
    return id && before.has(id) && JSON.stringify(before.get(id)) !== JSON.stringify(item);
  });
  return changed ? { before: before.get(String(changed?.[key] ?? "")), after: changed } : null;
}

function familyPushDetails(previous: any, next: any) {
  const details: any[] = [];

  const boardChange = changedRecord(previous?.boardPosts || [], next?.boardPosts || []);
  if (boardChange?.after) {
    const post = boardChange.after;
    details.push({
      category: "board",
      id: String(post?.id || ""),
      type: String(post?.type || "message"),
      title: String(post?.title || ""),
      preview: String(post?.body || "").replace(/\s+/g, " ").slice(0, 90),
      authorUserId: n(post?.authorUserId)
    });
  }

  const shoppingChange = changedRecord(previous?.shopping || [], next?.shopping || []);
  if (shoppingChange?.after) {
    const item = shoppingChange.after;
    const action = !shoppingChange.before
      ? "added"
      : item?.taken === true && shoppingChange.before?.taken !== true
        ? "taken"
        : "updated";
    details.push({
      category: "shopping",
      id: n(item?.id),
      action,
      item: String(item?.name || ""),
      qty: item?.qty ?? "",
      unit: String(item?.unit || "")
    });
  } else {
    const pantryChange = changedRecord(previous?.pantry || [], next?.pantry || []);
    if (pantryChange?.after) {
      const item = pantryChange.after;
      const beforeQty = Number(pantryChange.before?.qty ?? item?.qty ?? 0);
      const afterQty = Number(item?.qty ?? 0);
      const minQty = Number(item?.minQty ?? 0);
      const action = !pantryChange.before
        ? "pantry_added"
        : minQty > 0 && afterQty <= minQty && afterQty < beforeQty
          ? "pantry_low"
          : "updated";
      details.push({
        category: "shopping",
        id: n(item?.id),
        action,
        item: String(item?.name || ""),
        qty: item?.qty ?? "",
        unit: String(item?.unit || "")
      });
    }
  }

  return details;
}

function familyChangeModules(previous: any, next: any) {
  const changed = (a: any, b: any) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
  const modules: string[] = [];
  const checks: Array<[string, any, any]> = [
    ["profile", previous?.users, next?.users],
    ["calendar", previous?.calendarEvents, next?.calendarEvents],
    ["deadlines", previous?.deadlines, next?.deadlines],
    ["categories", previous?.categories, next?.categories],
    ["pantry", previous?.pantry, next?.pantry],
    ["pantry", previous?.pantryMovements, next?.pantryMovements],
    ["shopping", previous?.shopping, next?.shopping],
    ["meals", previous?.dishes, next?.dishes],
    ["meals", previous?.mealPlans, next?.mealPlans],
    ["todos", previous?.todos, next?.todos],
    ["routines", previous?.routines, next?.routines],
    ["routines", previous?.routineCompletions, next?.routineCompletions],
    ["board", previous?.boardPosts, next?.boardPosts],
    ["approvals", previous?.approvalRequests, next?.approvalRequests],
    ["settings", previous?.assistantName, next?.assistantName]
  ];
  for (const [module, before, after] of checks) {
    if (changed(before, after) && !modules.includes(module)) modules.push(module);
  }
  return modules;
}

function familyPushCategories(previous: any, next: any) {
  const categories: string[] = [];
  const changed = (a: any, b: any) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
  if (changed(previous?.calendarEvents || [], next?.calendarEvents || [])) categories.push("calendar");
  if (changed(previous?.deadlines || [], next?.deadlines || [])) categories.push("deadlines");
  if (changed(previous?.boardPosts || [], next?.boardPosts || [])) categories.push("board");
  if (
    changed(previous?.shopping || [], next?.shopping || []) ||
    changed(previous?.pantry || [], next?.pantry || []) ||
    changed(previous?.pantryMovements || [], next?.pantryMovements || [])
  ) categories.push("shopping");

  if (changed(previous?.approvalRequests || [], next?.approvalRequests || [])) {
    const beforeIds = new Set(array(previous?.approvalRequests).map((item: any) => String(item?.id || "")));
    const added = array(next?.approvalRequests).filter((item: any) => item?.id && !beforeIds.has(String(item.id)));
    for (const request of added) {
      const kind = String(request?.kind || "");
      const topic = kind === "calendar"
        ? "calendar"
        : kind === "deadline"
          ? "deadlines"
          : kind === "school"
            ? "school"
            : kind === "shopping"
              ? "shopping"
              : "chores";
      if (!categories.includes(topic)) categories.push(topic);
    }
  }
  return categories;
}


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

function stripSchoolData(value: any) {
  const data = stripPasswords(value);
  data.schoolSubjects = [];
  data.schoolTimetable = [];
  data.schoolItems = [];
  return data;
}

function stripSensitiveData(value: any) {
  return stripSchoolData(stripFinanceData(stripHealthData(value)));
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

function mergeSchoolSnapshot(base: any, school: any) {
  const data = stripPasswords(base);
  if (!school || typeof school !== "object") return data;
  data.schoolSubjects = array(school.schoolSubjects);
  data.schoolTimetable = array(school.schoolTimetable);
  data.schoolItems = array(school.schoolItems);
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

async function callSchoolGateway(
  supabaseUrl: string,
  anonKey: string,
  authHeader: string,
  action: "read" | "sync",
  familyId: string,
  payload?: any
) {
  const response = await fetch(`${supabaseUrl}/functions/v1/school-data-gateway`, {
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
    throw new Error(String(result?.error || `school_gateway_http_${response.status}`));
  }
  return result;
}

async function securityRateLimit(admin: any, scope: string, subjectKey: string, limit: number, windowSeconds: number) {
  const { data, error } = await admin.rpc("system_security_rate_limit", {
    p_scope: scope,
    p_subject_key: subjectKey,
    p_limit: limit,
    p_window_seconds: windowSeconds
  });
  if (error) throw error;
  return data === true;
}

async function securityAudit(admin: any, event: {
  actorUserId?: string | null;
  familyId?: string | null;
  eventType: string;
  success?: boolean;
  severity?: "info" | "warning" | "critical";
  metadata?: Record<string, unknown>;
}) {
  const { error } = await admin.rpc("system_security_audit", {
    p_actor_user_id: event.actorUserId || null,
    p_family_id: event.familyId || null,
    p_event_type: event.eventType,
    p_success: event.success !== false,
    p_severity: event.severity || "info",
    p_target_type: "family_document",
    p_target_id: event.familyId || null,
    p_metadata: event.metadata || {}
  });
  if (error) console.warn("security_audit_failed", error.message);
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

  data.approvalRequests = array(data.approvalRequests).filter((request: any) =>
    n(request?.requestedByUserId) === childId
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

  const allowedApprovalKinds = new Set(["calendar","shopping","deadline","todo","school"]);
  const allowedApprovalActions = new Set(["create","update","delete"]);
  const currentRequests = array(full.approvalRequests);
  const incomingRequests = array(incoming.approvalRequests);
  const currentById = new Map(currentRequests.map((request: any) => [String(request?.id || ""), request]));
  const addedRequests: any[] = [];

  if (incomingRequests.length > 500) throw new Error("approval_payload_limit");
  for (const request of incomingRequests) {
    const id = String(request?.id || "").trim();
    const kind = String(request?.kind || "");
    const action = String(request?.action || "");
    const summary = String(request?.summary || "").trim();
    const payload = request?.payload;

    if (!id || n(request?.requestedByUserId) !== childId) throw new Error("forbidden_approval_request");
    if (!allowedApprovalKinds.has(kind) || !allowedApprovalActions.has(action)) throw new Error("invalid_approval_request");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid_approval_request");
    if (!summary || summary.length > 240) throw new Error("invalid_approval_request");

    const existing = currentById.get(id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(request)) throw new Error("forbidden_approval_change");
      continue;
    }

    addedRequests.push({
      id,
      kind,
      action,
      requestedByUserId: childId,
      createdAt: String(request?.createdAt || new Date().toISOString()),
      summary,
      payload: clone(payload)
    });
  }

  full.approvalRequests = [...currentRequests, ...addedRequests];

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
      try {
        const school = await callSchoolGateway(supabaseUrl, anonKey, authHeader, "read", familyId);
        output = mergeSchoolSnapshot(output, school);
      } catch (schoolError) {
        console.warn("family_gateway_school_read_fallback", {
          familyId,
          userId: user.id,
          reason: schoolError instanceof Error ? schoolError.message : String(schoolError)
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

    const saveAllowed = await securityRateLimit(admin, "family_document_save", `${user.id}:${familyId}`, 240, 600);
    if (!saveAllowed) {
      await securityAudit(admin, {
        actorUserId: user.id,
        familyId,
        eventType: "family_document_save_rate_limited",
        success: false,
        severity: "warning",
        metadata: { role }
      });
      return json({ ok: false, error: "rate_limited" }, 429);
    }

    if (Number(document.revision || 0) !== expectedRevision) {
      await securityAudit(admin, {
        actorUserId: user.id,
        familyId,
        eventType: "family_document_conflict",
        success: false,
        severity: "warning",
        metadata: {
          role,
          expectedRevision,
          currentRevision: Number(document.revision || 0),
          schemaVersion: Number(incoming?.version || 0)
        }
      });
      let latest = role === "child" ? redactForChild(fullData, childId) : fullData;
      try {
        const finance = await callFinanceGateway(supabaseUrl, anonKey, authHeader, "read", familyId);
        latest = mergeFinanceSnapshot(latest, finance);
      } catch {
        // Family revision conflict remains actionable even if finance refresh is temporarily unavailable.
      }
      try {
        const school = await callSchoolGateway(supabaseUrl, anonKey, authHeader, "read", familyId);
        latest = mergeSchoolSnapshot(latest, school);
      } catch {
        // Keep the family revision conflict actionable even if school refresh is temporarily unavailable.
      }
      return json({
        ok: false,
        error: "revision_conflict",
        revision: Number(document.revision || 0),
        data: latest
      });
    }

    const financeNormalizedClient = incoming?.storageModel === "normalized-v1" || incoming?.storageModel === "normalized-v2";
    const schoolNormalizedClient = incoming?.storageModel === "normalized-v2";
    if (!financeNormalizedClient) {
      try {
        await callFinanceGateway(supabaseUrl, anonKey, authHeader, "sync", familyId, incoming);
      } catch (financeError) {
        const message = financeError instanceof Error ? financeError.message : "finance_sync_failed";
        console.warn("legacy_finance_sync_denied", { familyId, userId: user.id, role, reason: message });
        return json({ ok: false, error: message }, 403);
      }
    }
    if (!schoolNormalizedClient) {
      try {
        await callSchoolGateway(supabaseUrl, anonKey, authHeader, "sync", familyId, incoming);
      } catch (schoolError) {
        const message = schoolError instanceof Error ? schoolError.message : "school_sync_failed";
        console.warn("legacy_school_sync_denied", { familyId, userId: user.id, role, reason: message });
        return json({ ok: false, error: message }, 403);
      }
    }

    let nextData: any;
    try {
      const familyIncoming = stripSchoolData(stripFinanceData(incoming));
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
      await securityAudit(admin, {
        actorUserId: user.id,
        familyId,
        eventType: "family_document_conflict",
        success: false,
        severity: "warning",
        metadata: {
          role,
          expectedRevision,
          currentRevision: null,
          schemaVersion: Number(incoming?.version || 0),
          stage: "atomic_update"
        }
      });
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
      try {
        const school = await callSchoolGateway(supabaseUrl, anonKey, authHeader, "read", familyId);
        latestOutput = mergeSchoolSnapshot(latestOutput, school);
      } catch {
        // Keep the family conflict response usable even during a temporary school outage.
      }
      return json({
        ok: false,
        error: "revision_conflict",
        revision: Number(latest?.revision || expectedRevision),
        data: latestOutput
      });
    }

    const pushCategories = familyPushCategories(fullData, nextData);
    await notifyFamilyPush(admin, supabaseUrl, familyId, pushCategories, user.id, familyPushDetails(fullData, nextData));

    await securityAudit(admin, {
      actorUserId: user.id,
      familyId,
      eventType: "family_document_saved",
      success: true,
      severity: "info",
      metadata: {
        role,
        fromRevision: expectedRevision,
        toRevision: Number(updated.revision || nextRevision),
        modules: familyChangeModules(fullData, nextData),
        schemaVersion: Number(nextData?.version || 0),
        storageModel: String(nextData?.storageModel || "")
      }
    });

    let normalizedData: any = undefined;
    if (role === "child") {
      normalizedData = redactForChild(nextData, childId);
      try {
        const finance = await callFinanceGateway(supabaseUrl, anonKey, authHeader, "read", familyId);
        normalizedData = mergeFinanceSnapshot(normalizedData, finance);
      } catch {
        // The child save itself succeeded; polling will refresh finance if needed.
      }
      try {
        const school = await callSchoolGateway(supabaseUrl, anonKey, authHeader, "read", familyId);
        normalizedData = mergeSchoolSnapshot(normalizedData, school);
      } catch {
        // The child save itself succeeded; polling will refresh school if needed.
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
