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

type NormalizedRecord = {
  category: "visit" | "therapy" | "record";
  entityId: string;
  personId: string;
  title: string;
  personName: string;
  description: string;
};

function parseRecordId(recordId: string) {
  const match = recordId.match(/^(visit|therapy|health-record)-(\d+)$/);
  if (!match) return null;
  return {
    kind: match[1] as "visit" | "therapy" | "health-record",
    legacyId: Number(match[2])
  };
}

async function normalizedRecordInfo(admin: any, familyId: string, recordId: string): Promise<NormalizedRecord | null> {
  const parsed = parseRecordId(recordId);
  if (!parsed) return null;

  let row: any = null;
  let error: any = null;
  let category: NormalizedRecord["category"] = "record";

  if (parsed.kind === "visit") {
    const result = await admin
      .from("health_visits")
      .select("id,person_id,title,specialty,doctor,facility,purpose")
      .eq("family_id", familyId)
      .eq("legacy_id", parsed.legacyId)
      .maybeSingle();
    row = result.data;
    error = result.error;
    category = "visit";
  } else if (parsed.kind === "therapy") {
    const result = await admin
      .from("health_therapies")
      .select("id,person_id,title,prescriber,purpose")
      .eq("family_id", familyId)
      .eq("legacy_id", parsed.legacyId)
      .maybeSingle();
    row = result.data;
    error = result.error;
    category = "therapy";
  } else {
    const result = await admin
      .from("health_records")
      .select("id,person_id,title,provider")
      .eq("family_id", familyId)
      .eq("legacy_id", parsed.legacyId)
      .maybeSingle();
    row = result.data;
    error = result.error;
    category = "record";
  }

  if (error) throw error;
  if (!row) return null;

  const { data: person, error: personError } = await admin
    .from("family_people")
    .select("display_name")
    .eq("id", row.person_id)
    .eq("family_id", familyId)
    .maybeSingle();
  if (personError) throw personError;

  return {
    category,
    entityId: String(row.id),
    personId: String(row.person_id),
    title: String(row.title || "Documento sanitario"),
    personName: String(person?.display_name || "Familiare"),
    description: [row.specialty, row.doctor, row.facility, row.provider, row.prescriber, row.purpose]
      .filter(Boolean)
      .join(" · ")
  };
}

async function attachmentAccessInfo(admin: any, familyId: string, path: string) {
  const { data: attachment, error } = await admin
    .from("health_attachments")
    .select("id,visit_id,therapy_id,record_id,storage_path")
    .eq("family_id", familyId)
    .eq("storage_path", path)
    .maybeSingle();
  if (error) throw error;
  if (!attachment) return null;

  let personId = "";
  if (attachment.visit_id) {
    const { data } = await admin.from("health_visits").select("person_id").eq("id", attachment.visit_id).maybeSingle();
    personId = String(data?.person_id || "");
  } else if (attachment.therapy_id) {
    const { data } = await admin.from("health_therapies").select("person_id").eq("id", attachment.therapy_id).maybeSingle();
    personId = String(data?.person_id || "");
  } else if (attachment.record_id) {
    const { data } = await admin.from("health_records").select("person_id").eq("id", attachment.record_id).maybeSingle();
    personId = String(data?.person_id || "");
  }
  return { attachment, personId };
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

  const info = await normalizedRecordInfo(admin, familyId, recordId);
  if (!info) throw new Error("health_record_not_found");
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
    let membershipRole = "";
    let childPersonId = "";

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
      membershipRole = String(membership.role || "adult");

      if (membershipRole === "child") {
        const { data: person, error: personError } = await admin
          .from("family_people")
          .select("id")
          .eq("family_id", familyId)
          .eq("auth_user_id", user.id)
          .maybeSingle();
        if (personError || !person) return json({ ok: false, error: "child_identity_not_linked" }, 403);
        childPersonId = String(person.id);
      }
    }

    if (action === "upload") {
      if (serverMode) return json({ ok: false, error: "upload_requires_user" }, 403);
      if (!recordId) return json({ ok: false, error: "record_id_required" }, 400);
      if (membershipRole === "child") return json({ ok: false, error: "health_read_only_for_child" }, 403);
      const record = await normalizedRecordInfo(admin, familyId, recordId);
      if (!record) return json({ ok: false, error: "health_record_not_found" }, 404);
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

      const attachmentId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const metadata = {
        id: attachmentId,
        family_id: familyId,
        visit_id: record.category === "visit" ? record.entityId : null,
        therapy_id: record.category === "therapy" ? record.entityId : null,
        record_id: record.category === "record" ? record.entityId : null,
        storage_path: objectPath,
        file_name: file.name,
        mime_type: file.type,
        file_size: file.size,
        created_at: createdAt
      };
      const { error: metadataError } = await admin.from("health_attachments").insert(metadata);
      if (metadataError) {
        await admin.storage.from("health-attachments").remove([objectPath]).catch(() => {});
        throw metadataError;
      }

      return json({
        ok: true,
        attachment: {
          id: attachmentId,
          name: file.name,
          path: objectPath,
          mimeType: file.type,
          size: file.size,
          createdAt,
          driveBackup
        }
      });
    }

    if (!path || !path.startsWith(`${familyId}/`)) return json({ ok: false, error: "invalid_path" }, 400);
    const pathRecordId = path.split("/")[1] || "";
    if (!recordId) recordId = pathRecordId;
    if (recordId !== pathRecordId) return json({ ok: false, error: "record_path_mismatch" }, 400);

    if (!serverMode) {
      const access = await attachmentAccessInfo(admin, familyId, path);
      if (!access) return json({ ok: false, error: "attachment_not_found" }, 404);
      if (membershipRole === "child" && access.personId !== childPersonId) {
        return json({ ok: false, error: "forbidden_health_record" }, 403);
      }
      if ((action === "delete" || req.method === "DELETE") && membershipRole === "child") {
        return json({ ok: false, error: "health_read_only_for_child" }, 403);
      }
    }

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
      // Keep the private binary object for historical backup restores.
      // Access is revoked immediately by removing its normalized metadata row.
      const { error: metadataError } = await admin
        .from("health_attachments")
        .delete()
        .eq("family_id", familyId)
        .eq("storage_path", path);
      if (metadataError) throw metadataError;
      return json({ ok: true, retainedForRestore: true });
    }

    return json({ ok: false, error: "unsupported_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message }, 500);
  }
});
