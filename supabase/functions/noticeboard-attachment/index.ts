import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS"
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", ...cors }
});

const BUCKET = "noticeboard-attachments";
const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg","image/png","image/webp","image/heic","image/heif"]);

function appUserId(documentData: any, cloudUserId: string) {
  const users = Array.isArray(documentData?.users) ? documentData.users : [];
  const user = users.find((item: any) => String(item?.cloudUserId || "") === cloudUserId);
  return user ? Number(user.id || 0) : 0;
}

function boardPost(documentData: any, postId: string) {
  const posts = Array.isArray(documentData?.boardPosts) ? documentData.boardPosts : [];
  return posts.find((item: any) => String(item?.id || "") === postId) || null;
}

function childCanViewPost(post: any, childId: number) {
  if (!post || !childId) return false;
  if (Number(post?.authorUserId || 0) === childId) return true;
  if (post?.audience === "family") return true;
  return Array.isArray(post?.userIds) && post.userIds.map(Number).includes(childId);
}

function safeName(name: string) {
  return (name || "foto")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "foto";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST" && req.method !== "DELETE") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ ok: false, error: "unauthorized" }, 401);

    const { data: userResult, error: userError } = await admin.auth.getUser(token);
    const user = userResult?.user;
    if (userError || !user) return json({ ok: false, error: "unauthorized" }, 401);

    const contentType = req.headers.get("content-type") || "";
    let action = "";
    let familyId = "";
    let postId = "";
    let path = "";
    let file: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      action = String(form.get("action") || "upload");
      familyId = String(form.get("familyId") || "").trim();
      postId = String(form.get("postId") || "").trim();
      const candidate = form.get("file");
      file = candidate instanceof File ? candidate : null;
    } else {
      const body = await req.json().catch(() => ({}));
      action = String(body?.action || (req.method === "DELETE" ? "delete" : "signed-url"));
      familyId = String(body?.familyId || "").trim();
      postId = String(body?.postId || "").trim();
      path = String(body?.path || "").trim();
    }

    if (!familyId) return json({ ok: false, error: "family_id_required" }, 400);

    const { data: membership, error: memberError } = await admin
      .from("family_members")
      .select("role")
      .eq("family_id", familyId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memberError || !membership) return json({ ok: false, error: "forbidden" }, 403);
    const memberRole = String(membership.role || "adult");
    let childId = 0;
    let documentData: any = null;

    if (memberRole === "child") {
      const { data: document, error: documentError } = await admin
        .from("family_documents")
        .select("data")
        .eq("family_id", familyId)
        .single();
      if (documentError || !document) return json({ ok: false, error: "family_document_not_found" }, 404);
      documentData = document.data || {};
      childId = appUserId(documentData, user.id);
      if (!childId) return json({ ok: false, error: "child_identity_not_linked" }, 403);
    }

    if (action === "upload") {
      if (!postId) return json({ ok: false, error: "post_id_required" }, 400);
      if (!file) return json({ ok: false, error: "file_required" }, 400);
      if (file.size <= 0 || file.size > MAX_BYTES) return json({ ok: false, error: "file_too_large" }, 413);
      if (!ALLOWED.has(file.type)) return json({ ok: false, error: "file_type_not_allowed" }, 415);

      const objectPath = `${familyId}/${postId}/${crypto.randomUUID()}-${safeName(file.name)}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { error: uploadError } = await admin.storage
        .from(BUCKET)
        .upload(objectPath, bytes, { contentType: file.type, cacheControl: "3600", upsert: false });
      if (uploadError) throw uploadError;

      return json({
        ok: true,
        attachment: {
          id: crypto.randomUUID(),
          name: file.name,
          path: objectPath,
          mimeType: file.type,
          size: file.size,
          createdAt: new Date().toISOString()
        }
      });
    }

    if (!path || !path.startsWith(`${familyId}/`)) return json({ ok: false, error: "invalid_path" }, 400);
    const pathPostId = path.split("/")[1] || "";
    if (postId && postId !== pathPostId) return json({ ok: false, error: "post_path_mismatch" }, 400);
    postId = postId || pathPostId;

    if (memberRole === "child") {
      const post = boardPost(documentData, postId);
      if (action === "signed-url" && !childCanViewPost(post, childId)) {
        return json({ ok: false, error: "forbidden_board_post" }, 403);
      }
      if ((action === "delete" || req.method === "DELETE") && Number(post?.authorUserId || 0) !== childId) {
        return json({ ok: false, error: "forbidden_board_post" }, 403);
      }
    }

    if (action === "signed-url") {
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 3600);
      if (error) throw error;
      return json({ ok: true, signedUrl: data?.signedUrl || null });
    }

    if (action === "delete" || req.method === "DELETE") {
      const { error } = await admin.storage.from(BUCKET).remove([path]);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ ok: false, error: "unsupported_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message }, 500);
  }
});
