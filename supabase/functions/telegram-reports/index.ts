import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", ...cors }
});

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const SECTION_KEYS = ["agenda", "meals", "shopping", "lowStock", "deadlines", "todos", "chores", "school"] as const;
type SectionKey = typeof SECTION_KEYS[number];

type ReportSchedule = {
  id: string;
  family_id: string;
  user_id: string;
  name: string;
  enabled: boolean;
  time_local: string;
  timezone: string;
  days: number[];
  target_day_offset: number;
  scope: "personal" | "family";
  sections: Record<SectionKey, boolean>;
  include_health: boolean;
};

function configured() {
  return Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && TELEGRAM_BOT_TOKEN);
}

async function telegramApi(method: string, payload: Record<string, unknown> = {}) {
  if (!TELEGRAM_BOT_TOKEN) throw new Error("telegram_not_configured");
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok) {
    throw new Error(data?.description || `telegram_${method}_${response.status}`);
  }
  return data.result;
}

async function getBotIdentity() {
  const me = await telegramApi("getMe");
  return {
    id: me?.id,
    username: String(me?.username || ""),
    firstName: String(me?.first_name || "VerdoFamily")
  };
}

async function sendTelegram(chatId: number | string, text: string) {
  const safeText = text.length > 4000 ? `${text.slice(0, 3950)}\n\n…report abbreviato` : text;
  return telegramApi("sendMessage", {
    chat_id: chatId,
    text: safeText,
    disable_web_page_preview: true
  });
}

async function authenticatedMember(req: Request, familyId: string) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("missing_auth");

  const { data: userResult, error: userError } = await admin.auth.getUser(token);
  if (userError || !userResult?.user) throw new Error("invalid_auth");

  const { data: membership, error } = await admin
    .from("family_members")
    .select("family_id,user_id,role")
    .eq("family_id", familyId)
    .eq("user_id", userResult.user.id)
    .maybeSingle();

  if (error || !membership) throw new Error("not_family_member");
  return { user: userResult.user, membership };
}

async function validCron(req: Request) {
  const supplied = req.headers.get("x-cron-secret") || "";
  if (!supplied) return false;
  const { data } = await admin
    .from("telegram_bot_state")
    .select("value")
    .eq("key", "cron_secret")
    .maybeSingle();
  return Boolean(data?.value && supplied === data.value);
}

function sanitizeSections(value: any): Record<SectionKey, boolean> {
  const source = value && typeof value === "object" ? value : {};
  return {
    agenda: source.agenda !== false,
    meals: source.meals !== false,
    shopping: source.shopping !== false,
    lowStock: source.lowStock === true,
    deadlines: source.deadlines !== false,
    todos: source.todos !== false,
    chores: source.chores === true,
    school: source.school !== false
  };
}

function sanitizeDays(value: any): number[] {
  const raw = Array.isArray(value) ? value.map(Number) : [1, 2, 3, 4, 5, 6, 7];
  const days = [...new Set(raw.filter(day => Number.isInteger(day) && day >= 1 && day <= 7))].sort();
  return days.length ? days : [1, 2, 3, 4, 5, 6, 7];
}

function normalizeSchedule(row: any): ReportSchedule {
  return {
    id: String(row.id),
    family_id: String(row.family_id),
    user_id: String(row.user_id),
    name: String(row.name || "Report"),
    enabled: row.enabled !== false,
    time_local: String(row.time_local || "07:30").slice(0, 5),
    timezone: String(row.timezone || "Europe/Rome"),
    days: sanitizeDays(row.days),
    target_day_offset: Number(row.target_day_offset || 0) === 1 ? 1 : 0,
    scope: row.scope === "family" ? "family" : "personal",
    sections: sanitizeSections(row.sections),
    include_health: row.include_health === true
  };
}

function datePlusDays(date: string, offset: number) {
  const [y, m, d] = date.split("-").map(Number);
  const value = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12));
  value.setUTCDate(value.getUTCDate() + offset);
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function dateParts(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

function daysBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T12:00:00Z`).getTime();
  const end = new Date(`${endDate}T12:00:00Z`).getTime();
  return Math.round((end - start) / 86400000);
}

function monthDiff(startDate: string, date: string) {
  const start = dateParts(startDate);
  const target = dateParts(date);
  return (target.year - start.year) * 12 + (target.month - start.month);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
}

function clampedRoutineDate(year: number, month: number, preferredDay: number) {
  const day = Math.min(preferredDay, daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function routineDueOn(routine: any, date: string) {
  if (!routine || routine.active === false || !routine.startDate || date < String(routine.startDate)) return false;
  if (routine.endDate && date > String(routine.endDate)) return false;

  const frequency = String(routine.frequency || "weekly");
  if (frequency === "daily") return true;

  if (frequency === "weekly" || frequency === "fortnightly") {
    const diff = daysBetween(String(routine.startDate), date);
    const interval = frequency === "weekly" ? 7 : 14;
    return diff >= 0 && diff % interval === 0;
  }

  const start = dateParts(String(routine.startDate));
  const target = dateParts(date);
  const months = monthDiff(String(routine.startDate), date);
  if (months < 0) return false;

  if (frequency === "monthly") {
    return date === clampedRoutineDate(target.year, target.month, start.day);
  }

  if (frequency === "semiannual") {
    return months % 6 === 0 && date === clampedRoutineDate(target.year, target.month, start.day);
  }

  if (frequency === "yearly") {
    return target.month === start.month && date === clampedRoutineDate(target.year, start.month, start.day);
  }

  return false;
}

function routineCompletedOn(completions: any[], routineId: number, date: string) {
  return (Array.isArray(completions) ? completions : []).some((item: any) =>
    Number(item?.routineId || 0) === Number(routineId) && String(item?.date || "") === date
  );
}

function pantryAverageDailyUse(data: any, itemId: number, asOfDate: string, lookbackDays = 30) {
  const fromDate = datePlusDays(asOfDate, -Math.max(1, lookbackDays) + 1);
  const movements = (Array.isArray(data?.pantryMovements) ? data.pantryMovements : [])
    .filter((movement: any) =>
      Number(movement?.pantryItemId || 0) === Number(itemId) &&
      String(movement?.date || "") >= fromDate &&
      String(movement?.date || "") <= asOfDate
    );
  const manualConsumed = movements
    .filter((movement: any) => movement?.reason === "manual" && Number(movement?.delta || 0) < 0)
    .reduce((sum: number, movement: any) => sum + Math.abs(Number(movement?.delta || 0)), 0);
  const mealNet = movements
    .filter((movement: any) => movement?.reason === "meal")
    .reduce((sum: number, movement: any) => sum + Number(movement?.delta || 0), 0);
  const consumed = manualConsumed + Math.max(0, -mealNet);
  return consumed > 0 ? consumed / Math.max(1, lookbackDays) : 0;
}

function pantryDaysRemaining(data: any, item: any, asOfDate: string) {
  const daily = pantryAverageDailyUse(data, Number(item?.id || 0), asOfDate);
  if (daily <= 0) return null;
  return Math.max(0, Number(item?.qty || 0) / daily);
}

function pantryNeedsRestock(data: any, item: any, asOfDate: string) {
  const low = Number(item?.minQty || 0) > 0 && Number(item?.qty || 0) <= Number(item?.minQty || 0);
  const days = pantryDaysRemaining(data, item, asOfDate);
  return low || (item?.autoRestock !== false && days !== null && days <= 7);
}

function pantryLocationLabel(value: string) {
  if (value === "fridge") return "Frigo";
  if (value === "freezer") return "Freezer";
  return "Dispensa";
}

function weekdayFromDate(date: string) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function zonedNow(timeZone: string) {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
  } catch {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map(part => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const hhmm = `${parts.hour}:${parts.minute}`;
  return { date, hhmm, weekday: weekdayFromDate(date) };
}

function minutesOfDay(hhmm: string) {
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function niceDate(date: string) {
  const formatted = new Intl.DateTimeFormat("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${date}T12:00:00Z`));
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function listLines(items: string[], emptyLabel: string, max = 12) {
  if (!items.length) return [`• ${emptyLabel}`];
  const visible = items.slice(0, max).map(item => `• ${item}`);
  if (items.length > max) visible.push(`• …e altri ${items.length - max}`);
  return visible;
}

function eventForUser(event: any, appUserId: number | null) {
  if (event?.audience === "family") return true;
  if (!appUserId) return false;
  const ids = Array.isArray(event?.userIds) && event.userIds.length
    ? event.userIds.map(Number)
    : [Number(event?.userId || 0)];
  return ids.includes(appUserId);
}

function itemForUser(item: any, appUserId: number | null) {
  return Boolean(appUserId && Number(item?.userId || 0) === appUserId);
}

function userName(data: any, id: number) {
  return String((data?.users || []).find((user: any) => Number(user?.id) === Number(id))?.name || "");
}

function isHealthCalendarEvent(event: any) {
  return Boolean(event?.linkedHealthVisitId || event?.linkedHealthReminderType);
}

function isHealthDeadline(item: any) {
  return ["medicine", "therapy", "visit", "health-record"].includes(String(item?.kind || ""));
}

async function buildReport(schedule: ReportSchedule) {
  const [
    { data: document, error },
    { data: membership, error: membershipError },
    { data: financeData, error: financeError },
    { data: schoolData, error: schoolError }
  ] = await Promise.all([
    admin
      .from("family_documents")
      .select("data")
      .eq("family_id", schedule.family_id)
      .single(),
    admin
      .from("family_members")
      .select("role")
      .eq("family_id", schedule.family_id)
      .eq("user_id", schedule.user_id)
      .maybeSingle(),
    admin.rpc("system_finance_snapshot", { p_family_id: schedule.family_id }),
    admin.rpc("system_school_snapshot", { p_family_id: schedule.family_id })
  ]);
  if (error) throw error;
  if (financeError) throw financeError;
  if (schoolError) throw schoolError;
  if (membershipError || !membership) throw new Error("report_user_not_family_member");

  const role = String(membership.role || "adult");
  const isChild = role === "child";
  const includeHealth = !isChild && schedule.include_health === true;
  const data: any = document?.data || {};
  if (financeData && typeof financeData === "object") {
    data.chores = Array.isArray(financeData.chores) ? financeData.chores : [];
    data.recurringChores = Array.isArray(financeData.recurringChores) ? financeData.recurringChores : [];
    data.transactions = Array.isArray(financeData.transactions) ? financeData.transactions : [];
    const walletMap = new Map((Array.isArray(financeData.wallets) ? financeData.wallets : []).map((wallet: any) => [Number(wallet.userId), Number(wallet.balance || 0)]));
    data.users = (Array.isArray(data.users) ? data.users : []).map((user: any) =>
      walletMap.has(Number(user.id)) ? { ...user, balance: walletMap.get(Number(user.id)) } : user
    );
  }
  if (schoolData && typeof schoolData === "object") {
    data.schoolSubjects = Array.isArray(schoolData.schoolSubjects) ? schoolData.schoolSubjects : [];
    data.schoolTimetable = Array.isArray(schoolData.schoolTimetable) ? schoolData.schoolTimetable : [];
    data.schoolItems = Array.isArray(schoolData.schoolItems) ? schoolData.schoolItems : [];
  }
  const users = Array.isArray(data.users) ? data.users : [];
  const appUser = users.find((user: any) => String(user?.cloudUserId || "") === schedule.user_id) || null;
  const appUserId = appUser ? Number(appUser.id) : null;
  const local = zonedNow(schedule.timezone);
  const targetDate = datePlusDays(local.date, schedule.target_day_offset);
  const scopeFamily = !isChild && schedule.scope === "family";
  const titlePrefix = schedule.target_day_offset === 1 ? "🌙 Domani" : "☀️ Oggi";
  const lines: string[] = [
    `${titlePrefix} · ${schedule.name}`,
    `📅 ${niceDate(targetDate)}`
  ];

  if (schedule.sections.agenda) {
    const events = (Array.isArray(data.calendarEvents) ? data.calendarEvents : [])
      .filter((event: any) => String(event?.date || "") === targetDate)
      .filter((event: any) => includeHealth || !isHealthCalendarEvent(event))
      .filter((event: any) => scopeFamily || eventForUser(event, appUserId))
      .sort((a: any, b: any) => String(a?.time || "99:99").localeCompare(String(b?.time || "99:99")))
      .map((event: any) => {
        const time = event?.time ? `${String(event.time).slice(0, 5)} · ` : "";
        if (!scopeFamily) return `${time}${event.title}`;
        const ids = Array.isArray(event?.userIds) && event.userIds.length
          ? event.userIds
          : event?.audience === "family" ? [] : [event?.userId];
        const names = ids.map((id: any) => userName(data, Number(id))).filter(Boolean);
        const who = event?.audience === "family" ? "Famiglia" : names.join(", ");
        return `${time}${event.title}${who ? ` (${who})` : ""}`;
      });
    lines.push("", "📆 Impegni", ...listLines(events, "Nessun impegno"));
  }

  if (schedule.sections.meals) {
    const dishes = new Map((Array.isArray(data.dishes) ? data.dishes : []).map((dish: any) => [Number(dish.id), dish]));
    const meals = (Array.isArray(data.mealPlans) ? data.mealPlans : [])
      .filter((plan: any) => String(plan?.date || "") === targetDate)
      .filter((plan: any) => scopeFamily || itemForUser(plan, appUserId))
      .map((plan: any) => {
        const dish: any = dishes.get(Number(plan.dishId));
        const person = scopeFamily ? userName(data, Number(plan.userId)) : "";
        return `${String(plan.slot || "Pasto")}: ${String(dish?.name || "Da definire")}${person ? ` · ${person}` : ""}`;
      });
    lines.push("", "🍽️ Pasti", ...listLines(meals, "Nessun pasto programmato"));
  }

  if (schedule.sections.shopping) {
    const shopping = (Array.isArray(data.shopping) ? data.shopping : [])
      .filter((item: any) => !item?.taken)
      .map((item: any) => `${item.name}${Number(item.qty || 0) ? ` × ${item.qty}${item.unit ? ` ${item.unit}` : ""}` : ""}`);
    lines.push("", "🛻 Da comprare", ...listLines(shopping, "Lista vuota", 15));
  }

  if (schedule.sections.lowStock) {
    const pantry = Array.isArray(data.pantry) ? data.pantry : [];
    const restock = pantry
      .filter((item: any) => pantryNeedsRestock(data, item, targetDate))
      .map((item: any) => {
        const days = pantryDaysRemaining(data, item, targetDate);
        const why = days !== null && days <= 7 ? ` · ~${Math.max(0, Math.ceil(days))}g autonomia` : (Number(item.minQty || 0) > 0 ? ` · min ${item.minQty}` : "");
        return `${item.name}: ${item.qty}${item.unit ? ` ${item.unit}` : ""} · ${pantryLocationLabel(String(item.location || "pantry"))}${why}`;
      });

    const expiring = pantry
      .filter((item: any) => item?.expiryDate && String(item.expiryDate) <= datePlusDays(targetDate, 7))
      .sort((a: any, b: any) => String(a.expiryDate).localeCompare(String(b.expiryDate)))
      .map((item: any) => {
        const diff = daysBetween(targetDate, String(item.expiryDate));
        const when = diff < 0 ? `scaduto da ${Math.abs(diff)}g` : diff === 0 ? "scade oggi" : `scade tra ${diff}g`;
        return `${item.name}: ${when} · ${pantryLocationLabel(String(item.location || "pantry"))}`;
      });

    lines.push("", "📦 Scorte & scadenze", ...listLines([...restock, ...expiring], "Nessun prodotto da reintegrare o in scadenza"));
  }

  if (schedule.sections.deadlines) {
    const deadlines = (Array.isArray(data.deadlines) ? data.deadlines : [])
      .filter((item: any) => !item?.done && String(item?.date || "") === targetDate)
      .filter((item: any) => includeHealth || !isHealthDeadline(item))
      .filter((item: any) => scopeFamily || itemForUser(item, appUserId))
      .map((item: any) => `${item.title}${scopeFamily ? (userName(data, Number(item.userId)) ? ` · ${userName(data, Number(item.userId))}` : "") : ""}`);
    lines.push("", "⟰ Scadenze", ...listLines(deadlines, "Nessuna scadenza"));
  }

  if (schedule.sections.todos) {
    const todos = (Array.isArray(data.todos) ? data.todos : [])
      .filter((item: any) => !item?.done)
      .filter((item: any) => scopeFamily || itemForUser(item, appUserId))
      .map((item: any) => `${item.title}${scopeFamily ? (userName(data, Number(item.userId)) ? ` · ${userName(data, Number(item.userId))}` : "") : ""}`);

    const completions = Array.isArray(data.routineCompletions) ? data.routineCompletions : [];
    const routines = (Array.isArray(data.routines) ? data.routines : [])
      .filter((item: any) => routineDueOn(item, targetDate))
      .filter((item: any) => !routineCompletedOn(completions, Number(item.id), targetDate))
      .filter((item: any) => scopeFamily || itemForUser(item, appUserId))
      .map((item: any) => `🔁 ${item.title}${scopeFamily ? (userName(data, Number(item.userId)) ? ` · ${userName(data, Number(item.userId))}` : "") : ""}`);

    lines.push("", "✅ Da fare & routine", ...listLines([...routines, ...todos], "Nessuna attività"));
  }

  if (schedule.sections.school) {
    const subjects = new Map((Array.isArray(data.schoolSubjects) ? data.schoolSubjects : []).map((subject: any) => [Number(subject.id), subject]));
    const schoolItems = (Array.isArray(data.schoolItems) ? data.schoolItems : [])
      .filter((item: any) => !item?.done && String(item?.date || "") === targetDate)
      .filter((item: any) => scopeFamily || itemForUser(item, appUserId))
      .map((item: any) => {
        const student = scopeFamily ? userName(data, Number(item.userId)) : "";
        const subject: any = item.subjectId ? subjects.get(Number(item.subjectId)) : null;
        const typeLabels: Record<string, string> = {
          homework: "Compito",
          test: "Verifica",
          oral: "Interrogazione",
          material: "Materiale",
          circular: "Circolare",
          permission: "Autorizzazione",
          trip: "Gita/Uscita",
          payment: "Pagamento"
        };
        const prefix = typeLabels[String(item.type || "")] || "Scuola";
        const amount = item.type === "payment" && Number(item.amount || 0) > 0 ? ` · € ${Number(item.amount).toFixed(2).replace(".", ",")}` : "";
        return `${prefix}: ${item.title}${subject?.name ? ` · ${subject.name}` : ""}${student ? ` · ${student}` : ""}${amount}`;
      });

    const day = weekdayFromDate(targetDate);
    const lessons = (Array.isArray(data.schoolTimetable) ? data.schoolTimetable : [])
      .filter((entry: any) => Number(entry?.weekday || 0) === day)
      .filter((entry: any) => scopeFamily || itemForUser(entry, appUserId))
      .sort((a: any, b: any) => Number(a.order || 0) - Number(b.order || 0))
      .map((entry: any) => {
        const subject: any = subjects.get(Number(entry.subjectId));
        const student = scopeFamily ? userName(data, Number(entry.userId)) : "";
        return `${entry.order ? `${entry.order}ª · ` : ""}${subject?.name || "Materia"}${student ? ` · ${student}` : ""}`;
      });

    if (lessons.length || schoolItems.length) {
      lines.push("", "🎒 Scuola");
      if (lessons.length) lines.push(...listLines(lessons, "", 12));
      if (schoolItems.length) lines.push(...listLines(schoolItems, "", 12));
    } else {
      lines.push("", "🎒 Scuola", "• Nessun impegno scolastico");
    }
  }

  if (schedule.sections.chores) {
    const chores = (Array.isArray(data.chores) ? data.chores : [])
      .filter((item: any) => !item?.done && String(item?.deadline || "") === targetDate)
      .filter((item: any) => scopeFamily || itemForUser(item, appUserId))
      .map((item: any) => `${item.title}${scopeFamily ? (userName(data, Number(item.userId)) ? ` · ${userName(data, Number(item.userId))}` : "") : ""}`);
    lines.push("", "🧁 Compiti", ...listLines(chores, "Nessun compito"));
  }

  if (!includeHealth) {
    lines.push("", "🔒 Dati salute esclusi");
  }

  return lines.join("\n");
}

async function getUpdateOffset() {
  const { data } = await admin
    .from("telegram_bot_state")
    .select("value")
    .eq("key", "update_offset")
    .maybeSingle();
  return Number(data?.value || 0);
}

async function setUpdateOffset(offset: number) {
  await admin
    .from("telegram_bot_state")
    .upsert({ key: "update_offset", value: String(offset), updated_at: new Date().toISOString() });
}

async function processTelegramUpdates() {
  if (!configured()) return { processed: 0, linked: 0 };
  const currentOffset = await getUpdateOffset();
  const updates = await telegramApi("getUpdates", {
    offset: currentOffset ? currentOffset + 1 : undefined,
    limit: 100,
    timeout: 0,
    allowed_updates: ["message"]
  });

  let maxUpdateId = currentOffset;
  let processed = 0;
  let linked = 0;

  for (const update of Array.isArray(updates) ? updates : []) {
    maxUpdateId = Math.max(maxUpdateId, Number(update?.update_id || 0));
    const message = update?.message;
    const text = String(message?.text || "").trim();
    const match = text.match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]+))?$/i);
    if (!match) continue;
    processed += 1;

    const chatId = Number(message?.chat?.id || 0);
    if (!chatId) continue;
    if (message?.chat?.type !== "private") {
      await sendTelegram(chatId, "Per collegare VerdoFamily, apri il bot in una chat privata.");
      continue;
    }

    const token = String(match[1] || "");
    if (!token) {
      await sendTelegram(chatId, "Apri il collegamento generato da VerdoFamily → Impostazioni → Report automatici.");
      continue;
    }

    const { data: linkRow } = await admin
      .from("telegram_link_tokens")
      .select("token,family_id,user_id,expires_at,used_at")
      .eq("token", token)
      .maybeSingle();

    if (!linkRow || linkRow.used_at || new Date(linkRow.expires_at).getTime() < Date.now()) {
      await sendTelegram(chatId, "Questo collegamento è scaduto. Generane uno nuovo da VerdoFamily.");
      continue;
    }

    const { data: chatOwner } = await admin
      .from("telegram_connections")
      .select("id,user_id")
      .eq("chat_id", chatId)
      .maybeSingle();

    if (chatOwner && chatOwner.user_id !== linkRow.user_id) {
      await sendTelegram(chatId, "Questo account Telegram è già collegato a un altro utente VerdoFamily.");
      continue;
    }

    const connectionRow = {
      family_id: linkRow.family_id,
      user_id: linkRow.user_id,
      chat_id: chatId,
      telegram_user_id: message?.from?.id || null,
      telegram_username: message?.from?.username || null,
      telegram_first_name: message?.from?.first_name || null,
      enabled: true,
      updated_at: new Date().toISOString()
    };

    const { error: upsertError } = await admin
      .from("telegram_connections")
      .upsert(connectionRow, { onConflict: "family_id,user_id" });

    if (upsertError) {
      await sendTelegram(chatId, "Non sono riuscito a completare il collegamento. Riprova da VerdoFamily.");
      continue;
    }

    await admin
      .from("telegram_link_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("token", token);

    linked += 1;
    await sendTelegram(chatId, "✅ Telegram collegato a VerdoFamily.\n\nDa ora puoi ricevere qui i report automatici configurati nell'app.");
  }

  if (maxUpdateId > currentOffset) await setUpdateOffset(maxUpdateId);
  await admin.from("telegram_link_tokens").delete().lt("expires_at", new Date().toISOString());
  return { processed, linked };
}

async function sendDueReports() {
  if (!configured()) return { sent: 0, skipped: 0, errors: 0 };

  const [{ data: schedules, error: scheduleError }, { data: connections, error: connectionError }] = await Promise.all([
    admin.from("report_schedules").select("*").eq("enabled", true).eq("channel", "telegram"),
    admin.from("telegram_connections").select("*").eq("enabled", true)
  ]);
  if (scheduleError) throw scheduleError;
  if (connectionError) throw connectionError;

  const connectionMap = new Map<string, any>();
  for (const connection of connections || []) {
    connectionMap.set(`${connection.family_id}|${connection.user_id}`, connection);
  }

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const raw of schedules || []) {
    const schedule = normalizeSchedule(raw);
    const connection = connectionMap.get(`${schedule.family_id}|${schedule.user_id}`);
    if (!connection?.chat_id) {
      skipped += 1;
      continue;
    }

    const local = zonedNow(schedule.timezone);
    if (!schedule.days.includes(local.weekday)) continue;

    const diff = minutesOfDay(local.hhmm) - minutesOfDay(schedule.time_local);
    if (diff < 0 || diff > 2) continue;

    const scheduledKey = `${local.date}|${schedule.time_local}`;
    const { data: existing } = await admin
      .from("report_delivery_logs")
      .select("id,status,attempts")
      .eq("schedule_id", schedule.id)
      .eq("scheduled_key", scheduledKey)
      .maybeSingle();

    if (existing?.status === "sent" || existing?.status === "sending" || Number(existing?.attempts || 0) >= 3) {
      skipped += 1;
      continue;
    }

    let logId = existing?.id;
    if (logId) {
      await admin
        .from("report_delivery_logs")
        .update({
          status: "sending",
          attempts: Number(existing.attempts || 0) + 1,
          error: null,
          updated_at: new Date().toISOString()
        })
        .eq("id", logId);
    } else {
      const { data: inserted, error } = await admin
        .from("report_delivery_logs")
        .insert({
          family_id: schedule.family_id,
          schedule_id: schedule.id,
          user_id: schedule.user_id,
          scheduled_key: scheduledKey,
          status: "sending",
          attempts: 1
        })
        .select("id")
        .single();
      if (error) {
        skipped += 1;
        continue;
      }
      logId = inserted.id;
    }

    try {
      const report = await buildReport(schedule);
      await sendTelegram(connection.chat_id, report);
      await admin
        .from("report_delivery_logs")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          message_preview: report.slice(0, 500),
          updated_at: new Date().toISOString()
        })
        .eq("id", logId);
      sent += 1;
    } catch (error: any) {
      errors += 1;
      await admin
        .from("report_delivery_logs")
        .update({
          status: "error",
          error: String(error?.message || error || "send_failed").slice(0, 1000),
          updated_at: new Date().toISOString()
        })
        .eq("id", logId);
    }
  }

  return { sent, skipped, errors };
}

async function statusFor(familyId: string, userId: string) {
  const [{ data: connection }, { data: schedules }] = await Promise.all([
    admin
      .from("telegram_connections")
      .select("id,chat_id,telegram_username,telegram_first_name,enabled,linked_at,updated_at")
      .eq("family_id", familyId)
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("report_schedules")
      .select("*")
      .eq("family_id", familyId)
      .eq("user_id", userId)
      .order("time_local", { ascending: true })
  ]);

  let bot: any = null;
  let botError = "";
  if (configured()) {
    try {
      bot = await getBotIdentity();
    } catch (error: any) {
      botError = String(error?.message || "telegram_unavailable");
    }
  }

  return {
    ok: true,
    configured: configured(),
    bot,
    botError,
    connected: Boolean(connection?.enabled && connection?.chat_id),
    connection: connection ? {
      telegramUsername: connection.telegram_username || "",
      firstName: connection.telegram_first_name || "",
      linkedAt: connection.linked_at,
      updatedAt: connection.updated_at
    } : null,
    schedules: (schedules || []).map(normalizeSchedule)
  };
}

async function appAction(req: Request, body: any) {
  const action = String(body?.action || "status");
  const familyId = String(body?.familyId || "");
  if (!familyId) return json({ error: "family_id_required" }, 400);

  const { user, membership } = await authenticatedMember(req, familyId);
  const memberRole = String(membership?.role || "adult");

  if (action === "status") {
    return json(await statusFor(familyId, user.id));
  }

  if (!configured()) return json({ error: "telegram_not_configured" }, 503);

  if (action === "link-url") {
    const bot = await getBotIdentity();
    if (!bot.username) return json({ error: "telegram_bot_username_missing" }, 500);

    await admin
      .from("telegram_link_tokens")
      .delete()
      .eq("family_id", familyId)
      .eq("user_id", user.id)
      .is("used_at", null);

    const token = crypto.randomUUID().replace(/-/g, "");
    const { error } = await admin.from("telegram_link_tokens").insert({
      token,
      family_id: familyId,
      user_id: user.id
    });
    if (error) throw error;

    return json({
      ok: true,
      botUsername: bot.username,
      url: `https://t.me/${bot.username}?start=${token}`,
      startCommand: `/start ${token}`,
      expiresInMinutes: 30
    });
  }

  if (action === "poll-link") {
    await processTelegramUpdates();
    return json(await statusFor(familyId, user.id));
  }

  if (action === "disconnect") {
    await admin
      .from("telegram_connections")
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq("family_id", familyId)
      .eq("user_id", user.id);
    return json({ ok: true });
  }

  if (action === "save-schedule") {
    const id = body?.schedule?.id ? String(body.schedule.id) : "";
    const name = String(body?.schedule?.name || "Report").trim().slice(0, 80) || "Report";
    const timeLocal = String(body?.schedule?.time_local || body?.schedule?.timeLocal || "07:30").slice(0, 5);
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(timeLocal)) return json({ error: "invalid_time" }, 400);

    const requestedFamilyScope = body?.schedule?.scope === "family";
    const requestedHealth = body?.schedule?.include_health === true || body?.schedule?.includeHealth === true;
    if (memberRole === "child" && (requestedFamilyScope || requestedHealth)) {
      return json({ error: "child_report_scope_forbidden" }, 403);
    }

    const row = {
      family_id: familyId,
      user_id: user.id,
      name,
      enabled: body?.schedule?.enabled !== false,
      channel: "telegram",
      time_local: timeLocal,
      timezone: String(body?.schedule?.timezone || "Europe/Rome").slice(0, 80),
      days: sanitizeDays(body?.schedule?.days),
      target_day_offset: Number(body?.schedule?.target_day_offset ?? body?.schedule?.targetDayOffset ?? 0) === 1 ? 1 : 0,
      scope: requestedFamilyScope ? "family" : "personal",
      sections: sanitizeSections(body?.schedule?.sections),
      include_health: requestedHealth,
      updated_at: new Date().toISOString()
    };

    if (id) {
      const { error } = await admin
        .from("report_schedules")
        .update(row)
        .eq("id", id)
        .eq("family_id", familyId)
        .eq("user_id", user.id);
      if (error) throw error;
    } else {
      const { error } = await admin.from("report_schedules").insert(row);
      if (error) throw error;
    }
    return json(await statusFor(familyId, user.id));
  }

  if (action === "delete-schedule") {
    const scheduleId = String(body?.scheduleId || "");
    if (!scheduleId) return json({ error: "schedule_id_required" }, 400);
    const { error } = await admin
      .from("report_schedules")
      .delete()
      .eq("id", scheduleId)
      .eq("family_id", familyId)
      .eq("user_id", user.id);
    if (error) throw error;
    return json(await statusFor(familyId, user.id));
  }

  if (action === "send-test") {
    const scheduleId = String(body?.scheduleId || "");
    const [{ data: connection }, { data: scheduleRow }] = await Promise.all([
      admin
        .from("telegram_connections")
        .select("chat_id,enabled")
        .eq("family_id", familyId)
        .eq("user_id", user.id)
        .maybeSingle(),
      admin
        .from("report_schedules")
        .select("*")
        .eq("id", scheduleId)
        .eq("family_id", familyId)
        .eq("user_id", user.id)
        .maybeSingle()
    ]);
    if (!connection?.enabled || !connection?.chat_id) return json({ error: "telegram_not_connected" }, 409);
    if (!scheduleRow) return json({ error: "schedule_not_found" }, 404);

    const report = await buildReport(normalizeSchedule(scheduleRow));
    await sendTelegram(connection.chat_id, report);
    return json({ ok: true, preview: report });
  }

  return json({ error: "unknown_action" }, 400);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const action = String(body?.action || "status");

  try {
    if (action === "cron") {
      if (!await validCron(req)) return json({ error: "invalid_cron_secret" }, 401);
      const updates = await processTelegramUpdates();
      const reports = await sendDueReports();
      return json({ ok: true, updates, reports });
    }

    return await appAction(req, body);
  } catch (error: any) {
    console.error("telegram-reports", action, error);
    const code = String(error?.message || "telegram_reports_failed");
    const status =
      code === "missing_auth" || code === "invalid_auth" ? 401 :
      code === "not_family_member" ? 403 :
      code === "telegram_not_configured" ? 503 : 500;
    return json({ error: code }, status);
  }
});
