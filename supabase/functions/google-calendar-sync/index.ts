import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", ...cors }
});

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID") || "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET") || "";
const TOKEN_SECRET = Deno.env.get("GOOGLE_CALENDAR_TOKEN_KEY") || "";
const APP_URL = (Deno.env.get("GOOGLE_CALENDAR_APP_URL") || "https://verdofamily.vercel.app").replace(/\/$/, "");
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-calendar-sync?callback=1`;
const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
];

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

type Connection = {
  id: string;
  family_id: string;
  user_id: string;
  google_email?: string | null;
  refresh_token_enc?: string | null;
  personal_calendar_id?: string | null;
  personal_calendar_name?: string | null;
  family_calendar_id?: string | null;
  family_calendar_name?: string | null;
  family_event_target?: "personal" | "shared" | "both";
  enabled?: boolean;
};

type CalendarMeta = {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
  timeZone?: string;
};

type ConnectionContext = {
  connection: Connection;
  accessToken: string;
  calendars: CalendarMeta[];
};

function configured() {
  return !!(SUPABASE_URL && SERVICE_ROLE_KEY && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && TOKEN_SECRET);
}

function redirectResult(kind: string, reason = "") {
  const url = new URL(APP_URL + "/");
  url.searchParams.set("googleCalendar", kind);
  if (reason) url.searchParams.set("reason", reason.slice(0, 120));
  return Response.redirect(url.toString(), 302);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function encryptionKey() {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN_SECRET));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptText(value: string) {
  if (!TOKEN_SECRET) throw new Error("token_encryption_not_configured");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey();
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

async function decryptText(value: string) {
  if (!TOKEN_SECRET) throw new Error("token_encryption_not_configured");
  const [ivPart, dataPart] = String(value || "").split(".");
  if (!ivPart || !dataPart) throw new Error("invalid_encrypted_token");
  const key = await encryptionKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(ivPart) },
    key,
    base64ToBytes(dataPart)
  );
  return new TextDecoder().decode(decrypted);
}

async function authenticatedMember(req: Request, familyId: string) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("missing_auth");
  const { data: userResult, error: userError } = await admin.auth.getUser(token);
  if (userError || !userResult?.user) throw new Error("invalid_auth");
  const user = userResult.user;
  const { data: membership, error } = await admin
    .from("family_members")
    .select("family_id,user_id,role")
    .eq("family_id", familyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !membership) throw new Error("not_family_member");
  return { user, membership };
}

async function tokenRequest(params: URLSearchParams) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error_description || payload?.error || `google_token_${response.status}`);
  return payload;
}

async function refreshAccessToken(connection: Connection) {
  if (!connection.refresh_token_enc) throw new Error("google_not_connected");
  const refreshToken = await decryptText(connection.refresh_token_enc);
  const payload = await tokenRequest(new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  }));
  if (!payload.access_token) throw new Error("google_access_token_missing");
  return String(payload.access_token);
}

async function calendarList(accessToken: string): Promise<CalendarMeta[]> {
  const response = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250&minAccessRole=writer", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `calendar_list_${response.status}`);
  return (payload.items || []).map((item: any) => ({
    id: String(item.id || ""),
    summary: String(item.summary || item.id || "Calendario"),
    primary: !!item.primary,
    accessRole: item.accessRole,
    timeZone: item.timeZone || "Europe/Rome"
  })).filter((item: CalendarMeta) => item.id);
}

function calendarForId(calendars: CalendarMeta[], requested: string) {
  if (requested === "primary") return calendars.find(item => item.primary) || calendars[0];
  return calendars.find(item => item.id === requested);
}

function addOneDay(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const value = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12));
  value.setUTCDate(value.getUTCDate() + 1);
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function addMinutesLocal(date: string, time: string, minutes: number) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const value = new Date(Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0));
  value.setUTCMinutes(value.getUTCMinutes() + minutes);
  const nextDate = `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  const nextTime = `${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}`;
  return { date: nextDate, time: nextTime };
}

function googleEventBody(event: any, familyId: string, timeZone: string, participantNames: string[]) {
  const description = [
    event.notes ? String(event.notes) : "",
    participantNames.length ? `Partecipanti: ${participantNames.join(", ")}` : "",
    "Gestito da VerdoFamily"
  ].filter(Boolean).join("\n\n");

  const base: any = {
    summary: String(event.title || "Impegno VerdoFamily"),
    description,
    extendedProperties: {
      private: {
        verdoFamilyId: familyId,
        verdoFamilyEventId: String(event.id)
      }
    }
  };

  if (!event.time) {
    base.start = { date: event.date };
    base.end = { date: addOneDay(event.date) };
    return base;
  }

  let endDate = event.date;
  let endTime = event.endTime || "";
  if (!endTime) {
    const calculated = addMinutesLocal(event.date, event.time, 60);
    endDate = calculated.date;
    endTime = calculated.time;
  } else if (endTime <= event.time) {
    endDate = addOneDay(event.date);
  }

  base.start = { dateTime: `${event.date}T${event.time}:00`, timeZone };
  base.end = { dateTime: `${endDate}T${endTime}:00`, timeZone };
  return base;
}

async function googleEventRequest(accessToken: string, method: string, calendarId: string, eventId: string | null, body?: any) {
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const url = eventId ? `${base}/${encodeURIComponent(eventId)}?sendUpdates=none` : `${base}?sendUpdates=none`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  return { response, payload };
}

function eventParticipantUsers(event: any, users: any[]) {
  if (event?.audience === "family") return users;
  const ids = Array.isArray(event?.userIds) && event.userIds.length
    ? event.userIds.map(Number)
    : [Number(event?.userId || 0)].filter(Boolean);
  const wanted = new Set(ids);
  return users.filter(user => wanted.has(Number(user?.id)));
}

async function syncAll(familyId: string) {
  const [{ data: document, error: docError }, { data: connectionRows, error: connError }, { data: linkRows, error: linkError }] = await Promise.all([
    admin.from("family_documents").select("data").eq("family_id", familyId).single(),
    admin.from("google_calendar_connections").select("*").eq("family_id", familyId).eq("enabled", true),
    admin.from("google_calendar_event_links").select("*").eq("family_id", familyId)
  ]);
  if (docError) throw docError;
  if (connError) throw connError;
  if (linkError) throw linkError;

  const connections = (connectionRows || []).filter((row: any) => row.refresh_token_enc) as Connection[];
  if (!connections.length) return { ok: true, synced: 0, deleted: 0, connections: 0 };

  const contexts: ConnectionContext[] = [];
  const connectionErrors: Array<{ userId: string; error: string }> = [];
  for (const connection of connections) {
    try {
      const accessToken = await refreshAccessToken(connection);
      const calendars = await calendarList(accessToken);
      contexts.push({ connection, accessToken, calendars });
    } catch (error: any) {
      connectionErrors.push({ userId: connection.user_id, error: error?.message || "google_connection_error" });
    }
  }

  const appData: any = document?.data || {};
  const events = Array.isArray(appData.calendarEvents) ? appData.calendarEvents : [];
  const users = Array.isArray(appData.users) ? appData.users : [];
  const links = Array.isArray(linkRows) ? linkRows : [];
  const linkMap = new Map<string, any>();
  for (const link of links) linkMap.set(`${link.calendar_event_id}|${link.target_key}`, link);
  const desiredCompositeKeys = new Set<string>();
  let synced = 0;

  for (const event of events) {
    if (!event?.id || !event?.date || !event?.title) continue;
    const participants = eventParticipantUsers(event, users);
    const participantCloudIds = new Set(participants.map((user: any) => String(user?.cloudUserId || "")).filter(Boolean));
    const participantNames = participants.map((user: any) => String(user?.name || "")).filter(Boolean);
    const desiredTargets = new Map<string, { context: ConnectionContext; calendarId: string; targetKind: "personal" | "shared" }>();

    if (event?.audience === "family") {
      for (const context of contexts) {
        const mode = context.connection.family_event_target || "personal";
        if (mode === "personal" || mode === "both") {
          const calendarId = context.connection.personal_calendar_id || "primary";
          const key = `personal:${context.connection.user_id}:${calendarId}`;
          desiredTargets.set(key, { context, calendarId, targetKind: "personal" });
        }
        if ((mode === "shared" || mode === "both") && context.connection.family_calendar_id) {
          const calendarId = context.connection.family_calendar_id;
          const key = `shared:${calendarId}`;
          if (!desiredTargets.has(key)) desiredTargets.set(key, { context, calendarId, targetKind: "shared" });
        }
      }
    } else {
      for (const context of contexts) {
        if (!participantCloudIds.has(context.connection.user_id)) continue;
        const calendarId = context.connection.personal_calendar_id || "primary";
        const key = `personal:${context.connection.user_id}:${calendarId}`;
        desiredTargets.set(key, { context, calendarId, targetKind: "personal" });
      }
    }

    for (const [targetKey, target] of desiredTargets) {
      const compositeKey = `${event.id}|${targetKey}`;
      desiredCompositeKeys.add(compositeKey);
      const meta = calendarForId(target.context.calendars, target.calendarId);
      if (!meta) continue;
      const body = googleEventBody(event, familyId, meta.timeZone || "Europe/Rome", participantNames);
      const existing = linkMap.get(compositeKey);
      let googleEventId = existing?.google_event_id || "";

      if (googleEventId) {
        const updated = await googleEventRequest(target.context.accessToken, "PATCH", target.calendarId, googleEventId, body);
        if (updated.response.status === 404 || updated.response.status === 410) googleEventId = "";
        else if (!updated.response.ok) throw new Error(updated.payload?.error?.message || `google_event_update_${updated.response.status}`);
      }

      if (!googleEventId) {
        const created = await googleEventRequest(target.context.accessToken, "POST", target.calendarId, null, body);
        if (!created.response.ok || !created.payload?.id) throw new Error(created.payload?.error?.message || `google_event_create_${created.response.status}`);
        googleEventId = String(created.payload.id);
      }

      const payload = {
        family_id: familyId,
        calendar_event_id: Number(event.id),
        connection_id: target.context.connection.id,
        target_key: targetKey,
        target_kind: target.targetKind,
        google_calendar_id: target.calendarId,
        google_event_id: googleEventId,
        updated_at: new Date().toISOString()
      };
      if (existing?.id) await admin.from("google_calendar_event_links").update(payload).eq("id", existing.id);
      else await admin.from("google_calendar_event_links").insert(payload);
      synced += 1;
    }
  }

  let deleted = 0;
  for (const link of links) {
    const compositeKey = `${link.calendar_event_id}|${link.target_key}`;
    if (desiredCompositeKeys.has(compositeKey)) continue;
    const context = contexts.find(item => item.connection.id === link.connection_id)
      || contexts.find(item => calendarForId(item.calendars, link.google_calendar_id));
    if (!context) continue;
    const removed = await googleEventRequest(context.accessToken, "DELETE", link.google_calendar_id, link.google_event_id);
    if (removed.response.ok || removed.response.status === 404 || removed.response.status === 410) {
      await admin.from("google_calendar_event_links").delete().eq("id", link.id);
      deleted += 1;
    }
  }

  return { ok: true, synced, deleted, connections: contexts.length, connectionErrors };
}

async function handleCallback(url: URL) {
  if (!configured()) return redirectResult("error", "not_configured");
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const oauthError = url.searchParams.get("error") || "";
  if (oauthError) return redirectResult("error", oauthError);
  if (!code || !state) return redirectResult("error", "missing_code_or_state");

  const { data: stateRow, error: stateError } = await admin
    .from("google_calendar_oauth_states")
    .select("state,family_id,user_id,expires_at")
    .eq("state", state)
    .maybeSingle();
  if (stateError || !stateRow) return redirectResult("error", "invalid_state");
  if (new Date(stateRow.expires_at).getTime() < Date.now()) {
    await admin.from("google_calendar_oauth_states").delete().eq("state", state);
    return redirectResult("error", "expired_state");
  }

  const { data: callbackMembership, error: callbackMemberError } = await admin
    .from("family_members")
    .select("role")
    .eq("family_id", stateRow.family_id)
    .eq("user_id", stateRow.user_id)
    .maybeSingle();
  if (callbackMemberError || !callbackMembership || String(callbackMembership.role || "") === "child") {
    await admin.from("google_calendar_oauth_states").delete().eq("state", state);
    return redirectResult("error", "adult_or_admin_required");
  }

  try {
    const tokenPayload = await tokenRequest(new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code"
    }));

    const userInfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokenPayload.access_token}` }
    });
    const userInfo = await userInfoResponse.json().catch(() => ({}));

    const { data: existing } = await admin
      .from("google_calendar_connections")
      .select("*")
      .eq("family_id", stateRow.family_id)
      .eq("user_id", stateRow.user_id)
      .maybeSingle();

    const refreshTokenEnc = tokenPayload.refresh_token
      ? await encryptText(String(tokenPayload.refresh_token))
      : existing?.refresh_token_enc;
    if (!refreshTokenEnc) throw new Error("google_refresh_token_missing");

    const row = {
      family_id: stateRow.family_id,
      user_id: stateRow.user_id,
      google_email: userInfo?.email || existing?.google_email || null,
      refresh_token_enc: refreshTokenEnc,
      personal_calendar_id: existing?.personal_calendar_id || "primary",
      personal_calendar_name: existing?.personal_calendar_name || "Calendario principale",
      family_calendar_id: existing?.family_calendar_id || null,
      family_calendar_name: existing?.family_calendar_name || null,
      family_event_target: existing?.family_event_target || "personal",
      enabled: true,
      connected_at: existing?.connected_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const { error: upsertError } = await admin
      .from("google_calendar_connections")
      .upsert(row, { onConflict: "family_id,user_id" });
    if (upsertError) throw upsertError;
    await admin.from("google_calendar_oauth_states").delete().eq("state", state);
    await syncAll(stateRow.family_id).catch(error => console.error("initial calendar sync", error));
    return redirectResult("connected");
  } catch (error: any) {
    console.error("google oauth callback", error);
    await admin.from("google_calendar_oauth_states").delete().eq("state", state);
    return redirectResult("error", error?.message || "oauth_failed");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("callback") === "1") return handleCallback(url);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const action = String(body?.action || "status");
  const familyId = String(body?.familyId || "");
  if (!familyId) return json({ error: "family_id_required" }, 400);

  try {
    const { user, membership } = await authenticatedMember(req, familyId);
    const memberRole = String(membership?.role || "adult");
    const isChild = memberRole === "child";
    if (action === "status") {
      const { data: connection } = await admin
        .from("google_calendar_connections")
        .select("id,google_email,personal_calendar_id,personal_calendar_name,family_calendar_id,family_calendar_name,family_event_target,enabled,connected_at,updated_at,refresh_token_enc")
        .eq("family_id", familyId)
        .eq("user_id", user.id)
        .maybeSingle();
      return json({
        ok: true,
        configured: configured(),
        connected: !!(connection?.enabled && connection?.refresh_token_enc),
        redirectUri: REDIRECT_URI,
        connection: connection ? {
          id: connection.id,
          googleEmail: connection.google_email,
          personalCalendarId: connection.personal_calendar_id || "primary",
          personalCalendarName: connection.personal_calendar_name || "Calendario principale",
          familyCalendarId: connection.family_calendar_id || "",
          familyCalendarName: connection.family_calendar_name || "",
          familyEventTarget: connection.family_event_target || "personal",
          enabled: !!connection.enabled,
          connectedAt: connection.connected_at,
          updatedAt: connection.updated_at
        } : null
      });
    }

    if (!configured()) return json({ error: "google_calendar_not_configured", redirectUri: REDIRECT_URI }, 503);

    if (action === "auth-url") {
      if (isChild) return json({ error: "adult_or_admin_required" }, 403);
      await admin.from("google_calendar_oauth_states").delete().lt("expires_at", new Date().toISOString());
      const state = crypto.randomUUID();
      const { error } = await admin.from("google_calendar_oauth_states").insert({
        state,
        family_id: familyId,
        user_id: user.id,
        return_to: APP_URL
      });
      if (error) throw error;
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
      authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");
      authUrl.searchParams.set("include_granted_scopes", "true");
      authUrl.searchParams.set("scope", SCOPES.join(" "));
      authUrl.searchParams.set("state", state);
      return json({ ok: true, url: authUrl.toString(), redirectUri: REDIRECT_URI });
    }

    const { data: connection, error: connectionError } = await admin
      .from("google_calendar_connections")
      .select("*")
      .eq("family_id", familyId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (connectionError) throw connectionError;

    if (action === "disconnect") {
      if (connection?.id) {
        await admin.from("google_calendar_connections").update({
          enabled: false,
          refresh_token_enc: null,
          updated_at: new Date().toISOString()
        }).eq("id", connection.id);
      }
      return json({ ok: true });
    }

    if (!connection?.enabled || !connection?.refresh_token_enc) return json({ error: "google_not_connected" }, 409);

    if (action === "calendars") {
      const accessToken = await refreshAccessToken(connection as Connection);
      const calendars = await calendarList(accessToken);
      return json({ ok: true, calendars });
    }

    if (action === "save-settings") {
      if (isChild) return json({ error: "adult_or_admin_required" }, 403);
      const accessToken = await refreshAccessToken(connection as Connection);
      const calendars = await calendarList(accessToken);
      const personalId = String(body?.personalCalendarId || "primary");
      const familyIdChoice = String(body?.familyCalendarId || "");
      const target = ["personal", "shared", "both"].includes(body?.familyEventTarget) ? body.familyEventTarget : "personal";
      const personalMeta = calendarForId(calendars, personalId);
      if (!personalMeta) return json({ error: "personal_calendar_not_writable" }, 400);
      const familyMeta = familyIdChoice ? calendarForId(calendars, familyIdChoice) : null;
      if ((target === "shared" || target === "both") && !familyMeta) return json({ error: "family_calendar_required" }, 400);
      const { error } = await admin.from("google_calendar_connections").update({
        personal_calendar_id: personalId,
        personal_calendar_name: personalMeta.summary,
        family_calendar_id: familyMeta?.id || null,
        family_calendar_name: familyMeta?.summary || null,
        family_event_target: target,
        updated_at: new Date().toISOString()
      }).eq("id", connection.id);
      if (error) throw error;
      const result = await syncAll(familyId);
      return json({ ok: true, result });
    }

    if (action === "sync-all") {
      if (isChild) return json({ error: "adult_or_admin_required" }, 403);
      return json(await syncAll(familyId));
    }

    return json({ error: "unknown_action" }, 400);
  } catch (error: any) {
    console.error("google-calendar-sync", action, error);
    const code = String(error?.message || "");
    const status = code === "missing_auth" || code === "invalid_auth" ? 401 : code === "not_family_member" ? 403 : 500;
    return json({ error: code || "google_calendar_sync_failed" }, status);
  }
});
