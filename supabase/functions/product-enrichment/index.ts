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

const USER_AGENT = "VerdoFamily/1.0 (https://verdofamily.vercel.app)";
const PRODUCT_FIELDS = [
  "code","product_name","product_name_it","generic_name","brands","quantity",
  "image_front_small_url","image_front_url","nutrition_grades","nutriscore_grade",
  "nova_group","ecoscore_grade","ingredients_text","ingredients_text_it",
  "allergens","allergens_tags","categories","categories_tags","labels","labels_tags",
  "nutriments"
].join(",");

const arr = (value: any) => Array.isArray(value) ? value : [];
const s = (value: any) => String(value ?? "").trim();

function normalizeText(value: string) {
  return s(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string) {
  return normalizeText(value).split(" ").filter(token => token.length > 1);
}

function textScore(query: string, product: any, brandHint = "") {
  const q = normalizeText(query);
  const name = normalizeText(product?.product_name_it || product?.product_name || product?.generic_name || "");
  const brand = normalizeText(product?.brands || "");
  const haystack = normalizeText(`${name} ${brand}`);
  if (!q || !haystack) return 0;

  let score = 0;
  if (haystack === q) score = 1;
  else if (haystack.includes(q)) score = 0.94;
  else if (q.includes(name) && name.length >= 5) score = 0.9;

  const qTokens = tokens(q);
  const hTokens = new Set(tokens(haystack));
  if (qTokens.length) {
    const matched = qTokens.filter(token => hTokens.has(token)).length;
    const recall = matched / qTokens.length;
    score = Math.max(score, recall * 0.88);
  }

  const hint = normalizeText(brandHint);
  if (hint && brand && (brand.includes(hint) || hint.includes(brand))) score = Math.min(1, score + 0.08);
  return Math.max(0, Math.min(1, score));
}

function cleanTags(value: any, fallback = "") {
  const values = arr(value).length ? arr(value).map(s) : s(fallback).split(",").map(s);
  return values
    .filter(Boolean)
    .map(tag => tag.replace(/^[a-z]{2}:/i, "").replace(/-/g, " "))
    .slice(0, 12);
}

function numberOrUndefined(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function technicalInfo(product: any, confidence: number) {
  const code = s(product?.code);
  const nutriments = product?.nutriments || {};
  const info: any = {
    source: "openfoodfacts",
    sourceUrl: code ? `https://world.openfoodfacts.org/product/${encodeURIComponent(code)}` : undefined,
    retrievedAt: new Date().toISOString(),
    confidence: Math.max(0, Math.min(1, Number(confidence) || 0)),
    barcode: code || undefined,
    displayName: s(product?.product_name_it || product?.product_name || product?.generic_name) || undefined,
    brand: s(product?.brands) || undefined,
    imageUrl: s(product?.image_front_small_url || product?.image_front_url) || undefined,
    packageQuantity: s(product?.quantity) || undefined,
    ingredients: s(product?.ingredients_text_it || product?.ingredients_text) || undefined,
    allergens: cleanTags(product?.allergens_tags, product?.allergens),
    categories: cleanTags(product?.categories_tags, product?.categories),
    labels: cleanTags(product?.labels_tags, product?.labels),
    nutriScore: s(product?.nutriscore_grade || product?.nutrition_grades).toUpperCase() || undefined,
    novaGroup: numberOrUndefined(product?.nova_group),
    ecoScore: s(product?.ecoscore_grade).toUpperCase() || undefined,
    nutriments: {
      energyKcal100g: numberOrUndefined(nutriments?.["energy-kcal_100g"]),
      fat100g: numberOrUndefined(nutriments?.fat_100g),
      saturatedFat100g: numberOrUndefined(nutriments?.["saturated-fat_100g"]),
      carbohydrates100g: numberOrUndefined(nutriments?.carbohydrates_100g),
      sugars100g: numberOrUndefined(nutriments?.sugars_100g),
      fiber100g: numberOrUndefined(nutriments?.fiber_100g),
      proteins100g: numberOrUndefined(nutriments?.proteins_100g),
      salt100g: numberOrUndefined(nutriments?.salt_100g)
    }
  };

  if (!Object.values(info.nutriments).some(value => value !== undefined)) delete info.nutriments;
  for (const key of Object.keys(info)) {
    if (info[key] === undefined || info[key] === "" || (Array.isArray(info[key]) && !info[key].length)) delete info[key];
  }
  return info;
}

async function fetchByBarcode(barcode: string) {
  const clean = barcode.replace(/\D/g, "");
  if (clean.length < 8 || clean.length > 14) return null;
  const url = `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(clean)}?fields=${encodeURIComponent(PRODUCT_FIELDS)}`;
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept": "application/json" }
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  const product = payload?.product || null;
  return product?.code ? product : null;
}

function extractSearchHits(payload: any) {
  const raw = arr(payload?.hits).length
    ? payload.hits
    : arr(payload?.products).length
      ? payload.products
      : arr(payload?.items).length
        ? payload.items
        : arr(payload?.results);
  return raw.map((item: any) => item?._source || item?.document || item).filter(Boolean);
}

async function searchByText(query: string, brandHint = "") {
  const clean = s(query).slice(0, 140);
  if (normalizeText(clean).length < 3) return [];
  const params = new URLSearchParams({
    q: clean,
    langs: "it:en",
    page_size: "3",
    page: "1",
    fields: PRODUCT_FIELDS
  });
  const response = await fetch(`https://search.openfoodfacts.org/search?${params.toString()}`, {
    headers: { "User-Agent": USER_AGENT, "Accept": "application/json" }
  });
  if (!response.ok) return [];
  const payload = await response.json().catch(() => ({}));
  return extractSearchHits(payload)
    .map((product: any) => ({ product, score: textScore(clean, product, brandHint) }))
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 3);
}

async function lookupOne(item: any) {
  const key = s(item?.key);
  const barcode = s(item?.barcode).replace(/\D/g, "");
  const name = s(item?.name);
  const brand = s(item?.brand);
  const observedText = s(item?.observedText);
  const query = [brand, name, observedText].filter(Boolean).join(" ").slice(0, 160);

  if (barcode) {
    const product = await fetchByBarcode(barcode);
    if (product) {
      const info = technicalInfo(product, 1);
      return {
        key,
        autoApply: true,
        confidence: 1,
        match: info,
        candidates: [{ confidence: 1, info }]
      };
    }
  }

  const hits = await searchByText(query || name, brand);
  const candidates = hits.map((hit: any) => ({
    confidence: hit.score,
    info: technicalInfo(hit.product, hit.score)
  }));
  const top = candidates[0];
  const autoApply = !!top && top.confidence >= 0.82;
  return {
    key,
    autoApply,
    confidence: top?.confidence || 0,
    match: top?.info || null,
    candidates
  };
}

async function rateLimit(client: any, scope: string, subjectKey: string, limit: number, windowSeconds: number) {
  const { data, error } = await client.rpc("system_security_rate_limit", {
    p_scope: scope,
    p_subject_key: subjectKey,
    p_limit: limit,
    p_window_seconds: windowSeconds
  });
  if (error) throw error;
  return data === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const client = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ ok: false, error: "unauthorized" }, 401);

    const { data: userResult, error: userError } = await client.auth.getUser(token);
    const user = userResult?.user;
    if (userError || !user) return json({ ok: false, error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const familyId = s(body?.familyId);
    if (!familyId) return json({ ok: false, error: "family_id_required" }, 400);

    const { data: membership, error: memberError } = await client
      .from("family_members")
      .select("role")
      .eq("family_id", familyId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (memberError || !membership) return json({ ok: false, error: "forbidden" }, 403);

    if (body?.action === "status") {
      return json({ ok: true, provider: "openfoodfacts", automaticLimit: 20 });
    }

    const allowed = await rateLimit(client, "product_enrichment_lookup", `${user.id}:${familyId}`, 60, 3600);
    if (!allowed) return json({ ok: false, error: "rate_limited" }, 429);

    if (body?.action === "lookup") {
      const result = await lookupOne(body?.item || {});
      return json({ ok: true, provider: "openfoodfacts", result });
    }

    if (body?.action === "batch") {
      const items = arr(body?.items).slice(0, 20);
      if (!items.length) return json({ ok: true, provider: "openfoodfacts", results: [] });

      const settled = await Promise.allSettled(items.map(lookupOne));
      const results = settled.map((entry, index) => entry.status === "fulfilled"
        ? entry.value
        : { key: s(items[index]?.key), autoApply: false, confidence: 0, match: null, candidates: [] });

      await client.rpc("system_security_audit", {
        p_actor_user_id: user.id,
        p_family_id: familyId,
        p_event_type: "product_enrichment_batch",
        p_success: true,
        p_severity: "info",
        p_target_type: "pantry",
        p_target_id: familyId,
        p_metadata: {
          requested: items.length,
          matched: results.filter((row: any) => row?.match).length,
          automatic: results.filter((row: any) => row?.autoApply).length
        }
      }).catch(() => null);

      return json({ ok: true, provider: "openfoodfacts", results });
    }

    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (error) {
    console.error("product-enrichment", error);
    return json({ ok: false, error: "server_error" }, 500);
  }
});
