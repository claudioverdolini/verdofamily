import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS"
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", ...cors }
});

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

function safeName(name: string) {
  return (name || "allegato")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "allegato";
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

function recordInfo(recordId: string, documentData: any) {
  const match = recordId.match(/-(\d+)$/);
  const id = match ? Number(match[1]) : 0;
  const deadlines = Array.isArray(documentData?.deadlines) ? documentData.deadlines : [];
  const users = Array.isArray(documentData?.users) ? documentData.users : [];
  const record = deadlines.find((item: any) => Number(item?.id) === id);
  const person = users.find((item: any) => Number(item?.id) === Number(record?.userId));
  const category = recordId.startsWith("visit-") ? "visit" : recordId.startsWith("therapy-") ? "therapy" : "record";
  return {
    category,
    title: String(record?.title || "Documento sanitario"),
    personName: String(person?.name || "Famiglia"),
    description: [record?.specialty, record?.doctor, record?.provider, record?.purpose].filter(Boolean).join(" · ")
  };
}

async function backupToDrive(admin: any, familyId: string, recordId: string, fileName: string, mimeType: string, bytes: Uint8Array) {
  const { data: cfg, error: cfgError } = await admin
    .from("drive_backup_configs")
    .select("webhook_url,webhook_secret,enabled")
    .eq("family_id", familyId)
    .maybeSingle();
  if (cfgError) throw cfgError;
  if (!cfg?.enabled || !cfg?.webhook_url || !cfg?.webhook_secret) {
    return { ok: false, skipped: true, error: "drive_backup_not_configured" };
  }

  const { data: doc, error: docError } = await admin
    .from("family_documents")
    .select("data")
    .eq("family_id", familyId)
    .single();
  if (docError) throw docError;

  const info = recordInfo(recordId, doc?.data || {});
  const payload = {
    type: "health_attachment",
    secret: cfg.webhook_secret,
    familyId,
    category: info.category,
    personName: info.personName,
    recordTitle: info.title,
    description: info.description,
    fileName,
    mimeType: mimeType || "application/octet-stream",
    contentBase64: bytesToBase64(bytes)
  };

  const response = await fetch(cfg.webhook_url, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  if (!response.ok || parsed?.ok !== true) {
    throw new Error(parsed?.error || `drive_webhook_http_${response.status}`);
  }
  return { ok: true, fileId: parsed?.fileId || null, fileName: parsed?.fileName || null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST" && req.method !== "DELETE") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

    const providedCronSecret = req.headers.get("x-cron-secret") || "";
    let serverMode = false;
    let user: any = null;

    if (providedCronSecret) {
      const { data: secretRow, error: secretError } = await admin
        .from("system_settings")
        .select("value")
        .eq("key", "drive_backup_cron_secret")
        .single();
      if (secretError || !secretRow?.value || providedCronSecret !== secretRow.value) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
      serverMode = true;
    } else {
      const authHeader = req.headers.get("authorization") || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (!token) return json({ ok: false, error: "unauthorized" }, 401);
      const { data: userResult, error: userError } = await admin.auth.getUser(token);
      user = userResult?.user;
      if (userError || !user) return json({ ok: false, error: "unauthorized" }, 401);
    }

    const contentType = req.headers.get("content-type") || "";
    let action = "";
    let familyId = "";
    let recordId = "";
    let path = "";
    let file: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      action = String(form.get("action") || "upload");
      familyId = String(form.get("familyId") || "").trim();
      recordId = String(form.get("recordId") || "").trim();
      const candidate = form.get("file");
      file = candidate instanceof File ? candidate : null;
    } else {
      const body = await req.json().catch(() => ({}));
      action = String(body?.action || (req.method === "DELETE" ? "delete" : "signed-url"));
      familyId = String(body?.familyId || "").trim();
      recordId = String(body?.recordId || "").trim();
      path = String(body?.path || "").trim();
    }

    if (!familyId) return json({ ok: false, error: "family_id_required" }, 400);

    if (!serverMode) {
      const { data: membership, error: memberError } = await admin
        .from("family_members")
        .select("role")
        .eq("family_id", familyId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (memberError || !membership) return json({ ok: false, error: "forbidden" }, 403);
    }

    if (action === "upload") {
      if (serverMode) return json({ ok: false, error: "upload_requires_user" }, 403);
      if (!recordId) return json({ ok: false, error: "record_id_required" }, 400);
      if (!file) return json({ ok: false, error: "file_required" }, 400);
      if (file.size <= 0 || file.size > MAX_BYTES) return json({ ok: false, error: "file_too_large" }, 413);
      if (!ALLOWED.has(file.type)) return json({ ok: false, error: "file_type_not_allowed" }, 415);

      const objectPath = `${familyId}/${recordId}/${crypto.randomUUID()}-${safeName(file.name)}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { error: uploadError } = await admin.storage
        .from("health-attachments")
        .upload(objectPath, bytes, { contentType: file.type, cacheControl: "3600", upsert: false });
      if (uploadError) throw uploadError;

      let driveBackup: any = null;
      try {
        driveBackup = await backupToDrive(admin, familyId, recordId, file.name, file.type, bytes);
      } catch (driveError) {
        driveBackup = { ok: false, error: driveError instanceof Error ? driveError.message : String(driveError) };
        console.error("health_attachment_drive_backup_failed", driveBackup.error);
      }

      return json({
        ok: true,
        attachment: {
          id: crypto.randomUUID(),
          name: file.name,
          path: objectPath,
          mimeType: file.type,
          size: file.size,
          createdAt: new Date().toISOString(),
          driveBackup
        }
      });
    }

    if (!path || !path.startsWith(`${familyId}/`)) return json({ ok: false, error: "invalid_path" }, 400);

    if (action === "backup-existing") {
      if (!recordId) return json({ ok: false, error: "record_id_required" }, 400);
      const { data: blob, error: downloadError } = await admin.storage.from("health-attachments").download(path);
      if (downloadError || !blob) throw downloadError || new Error("file_not_found");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const fileName = path.split("/").pop()?.replace(/^[0-9a-f-]{36}-/, "") || "allegato";
      const driveBackup = await backupToDrive(admin, familyId, recordId, fileName, blob.type || "application/octet-stream", bytes);
      return json({ ok: true, driveBackup });
    }

    if (action === "signed-url") {
      const { data, error } = await admin.storage.from("health-attachments").createSignedUrl(path, 600);
      if (error) throw error;
      return json({ ok: true, signedUrl: data?.signedUrl || null });
    }

    if (action === "delete" || req.method === "DELETE") {
      const { error } = await admin.storage.from("health-attachments").remove([path]);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ ok: false, error: "unsupported_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message }, 500);
  }
});
