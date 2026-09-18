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

const healthKinds = new Set(["medicine", "therapy", "visit", "health-record"]);
const arr = (value: any) => Array.isArray(value) ? value : [];
const num = (value: any) => Number(value || 0);
const text = (value: any) => String(value ?? "").trim();
const nullable = (value: any) => {
  const v = text(value);
  return v || null;
};
const positive = (value: any) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const nonNegative = (value: any) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function attachmentShape(row: any) {
  return {
    id: String(row.id),
    name: String(row.file_name || "allegato"),
    path: String(row.storage_path || ""),
    mimeType: row.mime_type || undefined,
    size: row.file_size === null || row.file_size === undefined ? undefined : Number(row.file_size),
    createdAt: row.created_at || new Date().toISOString()
  };
}

function dbError(error: any, label: string) {
  if (!error) return;
  throw new Error(`${label}: ${error.message || String(error)}`);
}

async function readHealth(client: any, familyId: string) {
  const [peopleR, medicinesR, packagesR, therapiesR, linesR, visitsR, recordsR, attachmentsR] = await Promise.all([
    client.from("family_people").select("id,legacy_user_id,auth_user_id,display_name,role").eq("family_id", familyId),
    client.from("health_medicines").select("*").eq("family_id", familyId),
    client.from("health_medicine_packages").select("*").eq("family_id", familyId),
    client.from("health_therapies").select("*").eq("family_id", familyId),
    client.from("health_therapy_medicines").select("*").eq("family_id", familyId),
    client.from("health_visits").select("*").eq("family_id", familyId),
    client.from("health_records").select("*").eq("family_id", familyId),
    client.from("health_attachments").select("*").eq("family_id", familyId)
  ]);

  for (const [label, result] of [
    ["people", peopleR], ["medicines", medicinesR], ["packages", packagesR], ["therapies", therapiesR],
    ["therapy medicines", linesR], ["visits", visitsR], ["records", recordsR], ["attachments", attachmentsR]
  ] as const) dbError(result.error, label);

  const people = peopleR.data || [];
  const personLegacy = new Map(people.map((row: any) => [String(row.id), Number(row.legacy_user_id)]));
  const attachments = attachmentsR.data || [];
  const attachmentsFor = (key: "visit_id" | "therapy_id" | "record_id", id: string) =>
    attachments.filter((item: any) => String(item[key] || "") === id).map(attachmentShape);

  const packages = packagesR.data || [];
  const lines = linesR.data || [];
  const medicineLegacy = new Map((medicinesR.data || []).map((row: any) => [String(row.id), Number(row.legacy_id)]));

  const medicines = (medicinesR.data || []).map((row: any) => ({
    id: Number(row.legacy_id),
    title: String(row.title || "Medicinale"),
    date: row.legacy_date || packages.filter((pkg: any) => pkg.medicine_id === row.id && pkg.expiry_date).map((pkg: any) => pkg.expiry_date).sort()[0] || new Date().toISOString().slice(0, 10),
    userId: 0,
    done: !!row.archived,
    kind: "medicine",
    activeIngredient: row.active_ingredient || "",
    purpose: row.purpose || "",
    notes: row.notes || "",
    defaultPackageSize: row.default_package_size === null ? undefined : Number(row.default_package_size),
    packages: packages
      .filter((pkg: any) => pkg.medicine_id === row.id)
      .sort((a: any, b: any) => Number(a.legacy_id) - Number(b.legacy_id))
      .map((pkg: any) => ({
        id: Number(pkg.legacy_id),
        expiryDate: pkg.expiry_date || "",
        quantity: Number(pkg.quantity || 0),
        packageSize: pkg.package_size === null ? undefined : Number(pkg.package_size),
        lot: pkg.lot || "",
        addedAt: pkg.added_at || ""
      }))
  }));

  const therapies = (therapiesR.data || []).map((row: any) => ({
    id: Number(row.legacy_id),
    title: String(row.title || "Terapia"),
    date: row.legacy_date || row.end_date || row.start_date,
    userId: personLegacy.get(String(row.person_id)) || 0,
    done: !!row.archived,
    kind: "therapy",
    prescriber: row.prescriber || "",
    purpose: row.purpose || "",
    notes: row.notes || "",
    therapyStartDate: row.start_date,
    therapyEndDate: row.end_date || "",
    therapyMedicines: lines
      .filter((line: any) => line.therapy_id === row.id)
      .sort((a: any, b: any) => Number(a.legacy_id) - Number(b.legacy_id))
      .map((line: any) => ({
        id: Number(line.legacy_id),
        medicineId: medicineLegacy.get(String(line.medicine_id)) || 0,
        tabletsPerDose: Number(line.tablets_per_dose || 1),
        dosesPerDay: Number(line.doses_per_day || 1),
        usage: line.usage || ""
      })),
    attachments: attachmentsFor("therapy_id", String(row.id))
  }));

  const visits = (visitsR.data || []).map((row: any) => ({
    id: Number(row.legacy_id),
    title: String(row.title || "Visita"),
    date: row.visit_date,
    time: row.visit_time ? String(row.visit_time).slice(0, 5) : "",
    userId: personLegacy.get(String(row.person_id)) || 0,
    done: row.status !== "scheduled",
    kind: "visit",
    healthStatus: row.status,
    specialty: row.specialty || "",
    doctor: row.doctor || "",
    facility: row.facility || "",
    purpose: row.purpose || "",
    outcome: row.outcome || "",
    notes: row.notes || "",
    nextVisitDate: row.next_visit_date || "",
    followUpEvery: row.follow_up_every ?? undefined,
    followUpUnit: row.follow_up_unit || "months",
    followUpVisitId: row.follow_up_visit_legacy_id ?? undefined,
    followUpSourceId: row.follow_up_source_legacy_id ?? undefined,
    autoGenerated: !!row.auto_generated,
    calendarEventId: row.calendar_event_id ?? undefined,
    bookingReminderEvery: row.booking_reminder_every ?? undefined,
    bookingReminderUnit: row.booking_reminder_unit || "days",
    bookingReminderEventId: row.booking_reminder_event_id ?? undefined,
    attachments: attachmentsFor("visit_id", String(row.id))
  }));

  const records = (recordsR.data || []).map((row: any) => ({
    id: Number(row.legacy_id),
    title: String(row.title || "Documento sanitario"),
    date: row.record_date,
    userId: personLegacy.get(String(row.person_id)) || 0,
    done: false,
    kind: "health-record",
    healthRecordKind: row.record_kind || "document",
    provider: row.provider || "",
    result: row.result || "",
    notes: row.notes || "",
    attachments: attachmentsFor("record_id", String(row.id))
  }));

  return {
    people: people.map((row: any) => ({
      id: String(row.id),
      legacyUserId: Number(row.legacy_user_id),
      authUserId: row.auth_user_id || null,
      displayName: row.display_name,
      role: row.role
    })),
    items: [...medicines, ...therapies, ...visits, ...records]
  };
}

async function syncHealth(userClient: any, admin: any, familyId: string, snapshot: any, userId: string) {
  const healthItems = arr(snapshot?.deadlines).filter((item: any) => healthKinds.has(String(item?.kind || "")));
  const users = arr(snapshot?.users);
  const payloadBytes = new TextEncoder().encode(JSON.stringify({ healthItems, users })).byteLength;
  if (payloadBytes > 5 * 1024 * 1024) throw new Error("health_payload_too_large");
  if (healthItems.length > 5000 || users.length > 200) throw new Error("health_payload_limit");

  const { data: membership, error: membershipError } = await admin
    .from("family_members")
    .select("role")
    .eq("family_id", familyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (membershipError || !membership || !["admin", "adult"].includes(String(membership.role || ""))) {
    throw new Error("adult_or_admin_required");
  }

  const peopleRows = users
    .filter((user: any) => Number(user?.id || 0) > 0)
    .map((user: any) => ({
      family_id: familyId,
      legacy_user_id: Number(user.id),
      auth_user_id: uuidPattern.test(String(user?.cloudUserId || "")) ? String(user.cloudUserId) : null,
      display_name: text(user?.name) || "Familiare",
      role: user?.role === "admin" ? "admin" : user?.role === "bimbo" ? "child" : "adult",
      updated_at: new Date().toISOString()
    }));

  if (peopleRows.length) {
    const { error } = await admin.from("family_people").upsert(peopleRows, { onConflict: "family_id,legacy_user_id" });
    dbError(error, "sync people");
  }

  const { data: people, error: peopleError } = await admin
    .from("family_people")
    .select("id,legacy_user_id")
    .eq("family_id", familyId);
  dbError(peopleError, "read people");
  const personByLegacy = new Map((people || []).map((row: any) => [Number(row.legacy_user_id), String(row.id)]));

  const medicines = healthItems.filter((item: any) => item.kind === "medicine");
  const medicineRows = medicines.map((item: any) => ({
    family_id: familyId,
    legacy_id: num(item.id),
    title: text(item.title) || "Medicinale",
    legacy_date: nullable(item.date),
    active_ingredient: nullable(item.activeIngredient),
    purpose: nullable(item.purpose),
    notes: nullable(item.notes),
    default_package_size: positive(item.defaultPackageSize),
    archived: item.done === true,
    updated_at: new Date().toISOString()
  })).filter((row: any) => row.legacy_id > 0);

  if (medicineRows.length) {
    const { error } = await userClient.from("health_medicines").upsert(medicineRows, { onConflict: "family_id,legacy_id" });
    dbError(error, "sync medicines");
  }

  const { data: medicineDb, error: medicineError } = await userClient
    .from("health_medicines")
    .select("id,legacy_id")
    .eq("family_id", familyId);
  dbError(medicineError, "read medicines");
  const medicineByLegacy = new Map((medicineDb || []).map((row: any) => [Number(row.legacy_id), String(row.id)]));

  const therapies = healthItems.filter((item: any) => item.kind === "therapy");
  const therapyRows = therapies.map((item: any) => ({
    family_id: familyId,
    legacy_id: num(item.id),
    person_id: personByLegacy.get(num(item.userId)),
    title: text(item.title) || "Terapia",
    legacy_date: nullable(item.date),
    start_date: nullable(item.therapyStartDate) || nullable(item.date),
    end_date: nullable(item.therapyEndDate),
    prescriber: nullable(item.prescriber),
    purpose: nullable(item.purpose),
    notes: nullable(item.notes),
    archived: item.done === true,
    updated_at: new Date().toISOString()
  })).filter((row: any) => row.legacy_id > 0 && row.person_id && row.start_date);

  if (therapyRows.length) {
    const { error } = await userClient.from("health_therapies").upsert(therapyRows, { onConflict: "family_id,legacy_id" });
    dbError(error, "sync therapies");
  }

  const visits = healthItems.filter((item: any) => item.kind === "visit");
  const visitRows = visits.map((item: any) => ({
    family_id: familyId,
    legacy_id: num(item.id),
    person_id: personByLegacy.get(num(item.userId)),
    title: text(item.title) || "Visita",
    visit_date: nullable(item.date),
    visit_time: nullable(item.time),
    status: ["scheduled","completed","cancelled"].includes(String(item.healthStatus))
      ? item.healthStatus
      : item.done ? "completed" : "scheduled",
    specialty: nullable(item.specialty),
    doctor: nullable(item.doctor),
    facility: nullable(item.facility),
    purpose: nullable(item.purpose),
    outcome: nullable(item.outcome),
    notes: nullable(item.notes),
    next_visit_date: nullable(item.nextVisitDate),
    follow_up_every: positive(item.followUpEvery),
    follow_up_unit: nullable(item.followUpUnit),
    follow_up_visit_legacy_id: positive(item.followUpVisitId),
    follow_up_source_legacy_id: positive(item.followUpSourceId),
    auto_generated: item.autoGenerated === true,
    calendar_event_id: positive(item.calendarEventId),
    booking_reminder_every: positive(item.bookingReminderEvery),
    booking_reminder_unit: nullable(item.bookingReminderUnit),
    booking_reminder_event_id: positive(item.bookingReminderEventId),
    updated_at: new Date().toISOString()
  })).filter((row: any) => row.legacy_id > 0 && row.person_id && row.visit_date);

  if (visitRows.length) {
    const { error } = await userClient.from("health_visits").upsert(visitRows, { onConflict: "family_id,legacy_id" });
    dbError(error, "sync visits");
  }

  const records = healthItems.filter((item: any) => item.kind === "health-record");
  const recordRows = records.map((item: any) => ({
    family_id: familyId,
    legacy_id: num(item.id),
    person_id: personByLegacy.get(num(item.userId)),
    title: text(item.title) || "Documento sanitario",
    record_date: nullable(item.date),
    record_kind: ["exam","report","vaccine","document","note"].includes(String(item.healthRecordKind))
      ? item.healthRecordKind : "document",
    provider: nullable(item.provider),
    result: nullable(item.result),
    notes: nullable(item.notes),
    updated_at: new Date().toISOString()
  })).filter((row: any) => row.legacy_id > 0 && row.person_id && row.record_date);

  if (recordRows.length) {
    const { error } = await userClient.from("health_records").upsert(recordRows, { onConflict: "family_id,legacy_id" });
    dbError(error, "sync records");
  }

  const [{ data: therapyDb, error: therapyError }, { data: visitDb, error: visitError }, { data: recordDb, error: recordError }] = await Promise.all([
    userClient.from("health_therapies").select("id,legacy_id").eq("family_id", familyId),
    userClient.from("health_visits").select("id,legacy_id").eq("family_id", familyId),
    userClient.from("health_records").select("id,legacy_id").eq("family_id", familyId)
  ]);
  dbError(therapyError, "read therapies");
  dbError(visitError, "read visits");
  dbError(recordError, "read records");

  const therapyByLegacy = new Map((therapyDb || []).map((row: any) => [Number(row.legacy_id), String(row.id)]));
  const visitByLegacy = new Map((visitDb || []).map((row: any) => [Number(row.legacy_id), String(row.id)]));
  const recordByLegacy = new Map((recordDb || []).map((row: any) => [Number(row.legacy_id), String(row.id)]));

  const packageRows: any[] = [];
  for (const item of medicines) {
    const medicineId = medicineByLegacy.get(num(item.id));
    if (!medicineId) continue;
    for (const [index, pkg] of arr(item.packages).entries()) {
      packageRows.push({
        family_id: familyId,
        medicine_id: medicineId,
        legacy_id: num(pkg?.id) || index + 1,
        expiry_date: nullable(pkg?.expiryDate),
        quantity: nonNegative(pkg?.quantity),
        package_size: positive(pkg?.packageSize),
        lot: nullable(pkg?.lot),
        added_at: nullable(pkg?.addedAt),
        updated_at: new Date().toISOString()
      });
    }
  }
  if (packageRows.length) {
    const { error } = await userClient.from("health_medicine_packages").upsert(packageRows, { onConflict: "medicine_id,legacy_id" });
    dbError(error, "sync packages");
  }

  const therapyMedicineRows: any[] = [];
  for (const item of therapies) {
    const therapyId = therapyByLegacy.get(num(item.id));
    if (!therapyId) continue;
    for (const [index, line] of arr(item.therapyMedicines).entries()) {
      const medicineId = medicineByLegacy.get(num(line?.medicineId));
      if (!medicineId) continue;
      therapyMedicineRows.push({
        family_id: familyId,
        therapy_id: therapyId,
        medicine_id: medicineId,
        legacy_id: num(line?.id) || index + 1,
        tablets_per_dose: positive(line?.tabletsPerDose) || 1,
        doses_per_day: positive(line?.dosesPerDay) || 1,
        usage: nullable(line?.usage),
        updated_at: new Date().toISOString()
      });
    }
  }
  if (therapyMedicineRows.length) {
    const { error } = await userClient.from("health_therapy_medicines").upsert(therapyMedicineRows, { onConflict: "therapy_id,legacy_id" });
    dbError(error, "sync therapy medicines");
  }

  const attachmentRows: any[] = [];
  const collectAttachments = (items: any[], type: "visit" | "therapy" | "record") => {
    for (const item of items) {
      const entityId = type === "visit"
        ? visitByLegacy.get(num(item.id))
        : type === "therapy"
          ? therapyByLegacy.get(num(item.id))
          : recordByLegacy.get(num(item.id));
      if (!entityId) continue;
      for (const attachment of arr(item.attachments)) {
        const path = text(attachment?.path);
        if (!path) continue;
        attachmentRows.push({
          family_id: familyId,
          visit_id: type === "visit" ? entityId : null,
          therapy_id: type === "therapy" ? entityId : null,
          record_id: type === "record" ? entityId : null,
          storage_path: path,
          file_name: text(attachment?.name) || "allegato",
          mime_type: nullable(attachment?.mimeType),
          file_size: num(attachment?.size) || null,
          created_at: attachment?.createdAt || new Date().toISOString()
        });
      }
    }
  };
  collectAttachments(visits, "visit");
  collectAttachments(therapies, "therapy");
  collectAttachments(records, "record");

  if (attachmentRows.length) {
    const { error } = await userClient.from("health_attachments").upsert(attachmentRows, { onConflict: "storage_path" });
    dbError(error, "sync attachments");
  }

  const keep = {
    medicines: new Set(medicines.map((item: any) => num(item.id)).filter(Boolean)),
    therapies: new Set(therapies.map((item: any) => num(item.id)).filter(Boolean)),
    visits: new Set(visits.map((item: any) => num(item.id)).filter(Boolean)),
    records: new Set(records.map((item: any) => num(item.id)).filter(Boolean)),
    attachmentPaths: new Set(attachmentRows.map((item: any) => item.storage_path)),
    packageKeys: new Set(packageRows.map((row: any) => `${row.medicine_id}|${row.legacy_id}`)),
    lineKeys: new Set(therapyMedicineRows.map((row: any) => `${row.therapy_id}|${row.legacy_id}`))
  };

  const [existingPackagesR, existingLinesR, existingAttachmentsR] = await Promise.all([
    userClient.from("health_medicine_packages").select("id,medicine_id,legacy_id").eq("family_id", familyId),
    userClient.from("health_therapy_medicines").select("id,therapy_id,legacy_id").eq("family_id", familyId),
    userClient.from("health_attachments").select("id,storage_path").eq("family_id", familyId)
  ]);
  dbError(existingPackagesR.error, "read packages cleanup");
  dbError(existingLinesR.error, "read therapy lines cleanup");
  dbError(existingAttachmentsR.error, "read attachments cleanup");

  for (const row of existingAttachmentsR.data || []) {
    if (!keep.attachmentPaths.has(String(row.storage_path))) {
      const { error } = await userClient.from("health_attachments").delete().eq("id", row.id);
      dbError(error, "delete attachment metadata");
    }
  }
  for (const row of existingLinesR.data || []) {
    if (!keep.lineKeys.has(`${row.therapy_id}|${row.legacy_id}`)) {
      const { error } = await userClient.from("health_therapy_medicines").delete().eq("id", row.id);
      dbError(error, "delete therapy line");
    }
  }
  for (const row of existingPackagesR.data || []) {
    if (!keep.packageKeys.has(`${row.medicine_id}|${row.legacy_id}`)) {
      const { error } = await userClient.from("health_medicine_packages").delete().eq("id", row.id);
      dbError(error, "delete package");
    }
  }

  for (const row of visitDb || []) {
    if (!keep.visits.has(Number(row.legacy_id))) {
      const { error } = await userClient.from("health_visits").delete().eq("id", row.id);
      dbError(error, "delete visit");
    }
  }
  for (const row of recordDb || []) {
    if (!keep.records.has(Number(row.legacy_id))) {
      const { error } = await userClient.from("health_records").delete().eq("id", row.id);
      dbError(error, "delete record");
    }
  }
  for (const row of therapyDb || []) {
    if (!keep.therapies.has(Number(row.legacy_id))) {
      const { error } = await userClient.from("health_therapies").delete().eq("id", row.id);
      dbError(error, "delete therapy");
    }
  }
  for (const row of medicineDb || []) {
    if (!keep.medicines.has(Number(row.legacy_id))) {
      const { error } = await userClient.from("health_medicines").delete().eq("id", row.id);
      dbError(error, "delete medicine");
    }
  }

  return readHealth(userClient, familyId);
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

    const { data: membership, error: memberError } = await admin
      .from("family_members")
      .select("role")
      .eq("family_id", familyId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (memberError || !membership) return json({ ok: false, error: "forbidden" }, 403);

    if (action === "read") {
      const data = await readHealth(userClient, familyId);
      return json({ ok: true, role: membership.role, ...data });
    }

    if (action === "sync") {
      if (!["admin","adult"].includes(String(membership.role || ""))) {
        return json({ ok: false, error: "adult_or_admin_required" }, 403);
      }
      const data = await syncHealth(userClient, admin, familyId, body?.data || {}, user.id);
      return json({ ok: true, role: membership.role, ...data });
    }

    return json({ ok: false, error: "unsupported_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("health-data-gateway", message);
    const status = message === "adult_or_admin_required" ? 403 : 500;
    return json({ ok: false, error: message === "adult_or_admin_required" ? message : "server_error" }, status);
  }
});
