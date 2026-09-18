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

function stripSensitiveFromFamilyData(value: any) {
  const data = value && typeof value === "object" && !Array.isArray(value)
    ? structuredClone(value)
    : {};
  data.deadlines = Array.isArray(data.deadlines)
    ? data.deadlines.filter((item: any) => !["medicine","therapy","visit","health-record"].includes(String(item?.kind || "")))
    : [];
  data.users = Array.isArray(data.users)
    ? data.users.map((user: any) => ({ ...user, balance: 0, password: "" }))
    : [];
  data.chores = [];
  data.recurringChores = [];
  data.transactions = [];
  data.schoolSubjects = [];
  data.schoolTimetable = [];
  data.schoolItems = [];
  return data;
}

function isAcceptedAppsScriptRedirect(response: Response) {
  if (response.status < 300 || response.status >= 400) return false;
  const location = response.headers.get("location") || "";
  try {
    const host = new URL(location).hostname.toLowerCase();
    return host === "script.googleusercontent.com" || host.endsWith(".googleusercontent.com");
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const client = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    const providedCronSecret = req.headers.get("x-cron-secret") || "";
    let targetFamilyId: string | null = null;
    let cronMode = false;

    if (providedCronSecret) {
      const { data: secretRow, error: secretError } = await client
        .from("system_settings")
        .select("value")
        .eq("key", "drive_backup_cron_secret")
        .single();
      if (secretError || !secretRow?.value || providedCronSecret !== secretRow.value) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
      cronMode = true;
    } else {
      const authHeader = req.headers.get("authorization") || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (!token) return json({ ok: false, error: "unauthorized" }, 401);

      const { data: userResult, error: userError } = await client.auth.getUser(token);
      const user = userResult?.user;
      if (userError || !user) return json({ ok: false, error: "unauthorized" }, 401);

      targetFamilyId = String(body?.familyId || "").trim() || null;
      if (!targetFamilyId) return json({ ok: false, error: "family_id_required" }, 400);

      const { data: membership, error: memberError } = await client
        .from("family_members")
        .select("role")
        .eq("family_id", targetFamilyId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (memberError || !membership || !["admin", "adult"].includes(String(membership.role || ""))) {
        return json({ ok: false, error: "adult_or_admin_required" }, 403);
      }
    }

    let cfgQuery = client
      .from("drive_backup_configs")
      .select("family_id,webhook_url,webhook_secret")
      .eq("enabled", true);
    if (!cronMode && targetFamilyId) cfgQuery = cfgQuery.eq("family_id", targetFamilyId);

    const { data: configs, error: cfgError } = await cfgQuery;
    if (cfgError) throw cfgError;
    if (!configs?.length) return json({ ok: false, error: "backup_not_configured" }, 404);

    const results: Array<Record<string, unknown>> = [];

    for (const cfg of configs) {
      const familyId = cfg.family_id;
      const attemptedAt = new Date().toISOString();
      await client.from("drive_backup_configs").update({ last_attempt_at: attemptedAt, last_error: null }).eq("family_id", familyId);

      try {
        const [
          { data: family, error: famError },
          { data: doc, error: docError },
          { data: healthData, error: healthError },
          { data: financeData, error: financeError },
          { data: schoolData, error: schoolError }
        ] = await Promise.all([
          client.from("families").select("name").eq("id", familyId).single(),
          client.from("family_documents").select("data,revision,updated_at").eq("family_id", familyId).single(),
          client.rpc("system_health_snapshot", { p_family_id: familyId }),
          client.rpc("system_finance_snapshot", { p_family_id: familyId }),
          client.rpc("system_school_snapshot", { p_family_id: familyId })
        ]);
        if (famError) throw famError;
        if (docError) throw docError;
        if (healthError) throw healthError;
        if (financeError) throw financeError;
        if (schoolError) throw schoolError;

        const familyData = stripSensitiveFromFamilyData(doc.data || {});
        const normalizedHealth = healthData || { version: 1, items: [] };
        const normalizedFinance = financeData || { version: 1, wallets: [], chores: [], recurringChores: [], transactions: [] };
        const normalizedSchool = schoolData || { version: 1, schoolSubjects: [], schoolTimetable: [], schoolItems: [] };

        await client.from("family_backups").insert({
          family_id: familyId,
          revision: Number(doc.revision || 0),
          data: familyData,
          health_data: normalizedHealth,
          finance_data: normalizedFinance,
          school_data: normalizedSchool,
          backup_format_version: 4,
          reason: cronMode ? "google_drive_export" : "manual_google_drive_export",
          created_by: null
        });

        const payload = {
          secret: cfg.webhook_secret,
          app: "VerdoFamily",
          schemaVersion: 4,
          familyId,
          familyName: family?.name || "Famiglia",
          revision: Number(doc.revision || 0),
          sourceUpdatedAt: doc.updated_at,
          exportedAt: new Date().toISOString(),
          data: familyData,
          healthData: normalizedHealth,
          financeData: normalizedFinance,
          schoolData: normalizedSchool
        };

        // Google Apps Script ContentService intentionally answers through a 3xx
        // redirect to script.googleusercontent.com. Following that redirect from
        // server runtimes can yield a 404 even though doPost has already run and
        // the Drive file has been created. Keep the redirect manual and consider
        // only the trusted Google content redirect an accepted execution.
        const response = await fetch(cfg.webhook_url, {
          method: "POST",
          redirect: "manual",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(payload)
        });

        let parsed: any = null;
        let acceptedRedirect = false;
        if (isAcceptedAppsScriptRedirect(response)) {
          acceptedRedirect = true;
        } else {
          const text = await response.text();
          try { parsed = JSON.parse(text); } catch { parsed = null; }
          if (!response.ok || parsed?.ok !== true) {
            throw new Error(parsed?.error || `drive_webhook_http_${response.status}`);
          }
        }

        const successAt = new Date().toISOString();
        await client.from("drive_backup_configs").update({ last_success_at: successAt, last_error: null }).eq("family_id", familyId);
        results.push({
          familyId,
          ok: true,
          acceptedRedirect,
          fileId: parsed?.fileId || null,
          fileName: parsed?.fileName || null,
          successAt
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await client.from("drive_backup_configs").update({ last_error: message.slice(0, 1000) }).eq("family_id", familyId);
        results.push({ familyId, ok: false, error: message });
      }
    }

    return json({ ok: results.every(r => r.ok === true), processed: results.length, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, 500);
  }
});