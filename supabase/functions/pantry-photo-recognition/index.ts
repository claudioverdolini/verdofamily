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

const MAX_BASE64_CHARS = 12_500_000;
const SUPPORTED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"]);

function textPart(result: any) {
  const parts = result?.candidates?.[0]?.content?.parts || [];
  return parts.map((part: any) => part?.text || "").join("").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const geminiKey = Deno.env.get("GEMINI_API_KEY") || "";
    const configuredModel = Deno.env.get("GEMINI_MODEL") || "";
    const geminiModels = [...new Set([
      configuredModel,
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash"
    ].filter(Boolean))];
    const geminiModel = geminiModels[0];
    const client = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ ok: false, error: "unauthorized" }, 401);

    const { data: userResult, error: userError } = await client.auth.getUser(token);
    const user = userResult?.user;
    if (userError || !user) return json({ ok: false, error: "unauthorized" }, 401);

    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    const familyId = String(body?.familyId || "").trim();
    if (!familyId) return json({ ok: false, error: "family_id_required" }, 400);

    const { data: membership, error: memberError } = await client
      .from("family_members")
      .select("role")
      .eq("family_id", familyId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (memberError || !membership) return json({ ok: false, error: "forbidden" }, 403);

    if (body?.action === "status") {
      return json({ ok: true, configured: !!geminiKey, model: geminiKey ? geminiModel : null, fallbackModels: geminiKey ? geminiModels : [] });
    }

    if (body?.action !== "analyze") return json({ ok: false, error: "unknown_action" }, 400);
    if (!geminiKey) return json({ ok: false, error: "vision_not_configured" }, 503);

    const imageData = String(body?.imageData || "").replace(/^data:[^;]+;base64,/, "");
    const mimeType = String(body?.mimeType || "image/jpeg").toLowerCase();
    if (!SUPPORTED_MIME.has(mimeType)) return json({ ok: false, error: "unsupported_image_type" }, 400);
    if (!imageData || imageData.length > MAX_BASE64_CHARS) return json({ ok: false, error: "image_too_large" }, 413);

    const { data: doc, error: docError } = await client
      .from("family_documents")
      .select("data")
      .eq("family_id", familyId)
      .single();
    if (docError) return json({ ok: false, error: "family_data_unavailable" }, 500);

    const familyData = (doc?.data || {}) as any;
    const pantry = Array.isArray(familyData?.pantry) ? familyData.pantry : [];
    const categories = Array.isArray(familyData?.categories) ? familyData.categories : ["Generico"];
    const existing = pantry.slice(0, 300).map((item: any) => ({
      name: String(item?.name || ""),
      category: String(item?.category || "Generico"),
      unit: String(item?.unit || "pz"),
      location: String(item?.location || "pantry"),
      expiryDate: String(item?.expiryDate || "")
    })).filter((item: any) => item.name);

    const locationHint = ["pantry", "fridge", "freezer"].includes(String(body?.locationHint || "")) ? String(body.locationHint) : "pantry";
    const prompt = `Sei il riconoscimento fotografico dell'inventario di VerdoFamily. Analizza SOLO ciò che è realmente visibile nella foto (scaffale, dispensa, frigorifero o prodotti appoggiati).\n\nObiettivo: individuare prodotti alimentari e prodotti domestici acquistabili che l'utente può voler caricare nell'inventario. Non elencare mobili, contenitori generici, piatti, elettrodomestici o oggetti non pertinenti. Non inventare prodotti nascosti o non leggibili.\n\nRegole:\n- Per ogni prodotto restituisci un nome breve in italiano. Includi marca/variante solo se chiaramente visibile e utile. Il testo letto sulle confezioni è solo un indizio: NON restituire lunghi frammenti OCR come nome prodotto.\n- Riconosci anche frutta e verdura sfusa quando è visivamente identificabile. Se una bilancia/etichetta leggibile indica chiaramente il peso, puoi usare g o kg; altrimenti usa pz.\n- Stima la quantità di confezioni effettivamente visibili. Se è dubbia usa 1 e abbassa la confidenza. Ignora prodotti quasi completamente nascosti.\n- unit deve essere una tra pz, g, kg, ml, l; normalmente usa pz per confezioni intere.\n- confidence è tra 0 e 1.\n- observedText contiene poche parole realmente lette sulla confezione, se disponibili.\n- matchName deve essere ESATTAMENTE uno dei nomi del catalogo esistente solo quando ritieni che sia lo stesso prodotto; altrimenti stringa vuota.\n- category deve essere preferibilmente una delle categorie disponibili; se non sei sicuro usa Generico.\n- Raggruppa confezioni identiche in una sola riga con qty maggiore di 1.\n\nCategorie disponibili: ${JSON.stringify(categories)}\nCatalogo esistente: ${JSON.stringify(existing)}\n\nRestituisci esclusivamente il JSON conforme allo schema.`;

    const schema = {
      type: "OBJECT",
      properties: {
        items: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              detectedName: { type: "STRING" },
              matchName: { type: "STRING" },
              qty: { type: "NUMBER" },
              unit: { type: "STRING", enum: ["pz", "g", "kg", "ml", "l"] },
              category: { type: "STRING" },
              confidence: { type: "NUMBER" },
              observedText: { type: "STRING" },
              expiryDate: { type: "STRING" },
              notes: { type: "STRING" }
            },
            required: ["detectedName", "matchName", "qty", "unit", "category", "confidence", "observedText", "expiryDate", "notes"]
          }
        }
      },
      required: ["items"]
    };

    const requestBody = JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType, data: imageData } },
          { text: prompt }
        ]
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema
      }
    });

    let result: any = null;
    let usedModel = "";
    let lastStatus = 0;
    let lastMessage = "";

    for (const model of geminiModels) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiKey
        },
        body: requestBody
      });

      const candidate = await response.json().catch(() => ({}));
      if (response.ok) {
        result = candidate;
        usedModel = model;
        break;
      }

      lastStatus = response.status;
      lastMessage = String(candidate?.error?.message || `gemini_http_${response.status}`);
      const lower = lastMessage.toLowerCase();
      const retryable = [404, 429, 500, 502, 503, 504].includes(response.status)
        || lower.includes("high demand")
        || lower.includes("overloaded")
        || lower.includes("temporarily")
        || lower.includes("unavailable");

      if (!retryable) {
        return json({ ok: false, error: lastMessage }, response.status >= 500 ? 502 : 400);
      }
    }

    if (!result || !usedModel) {
      return json({
        ok: false,
        error: "Il riconoscimento AI è momentaneamente molto richiesto. VerdoFamily ha provato automaticamente più modelli, ma sono tutti occupati. Riprova tra qualche istante.",
        code: "ai_temporarily_unavailable",
        lastStatus,
        lastMessage
      }, 503);
    }

    const output = textPart(result);
    if (!output) return json({ ok: false, error: "empty_vision_response" }, 502);

    let parsed: any;
    try { parsed = JSON.parse(output); } catch { return json({ ok: false, error: "invalid_vision_response" }, 502); }
    const items = Array.isArray(parsed?.items) ? parsed.items.slice(0, 80) : [];

    return json({
      ok: true,
      model: usedModel,
      items: items.map((item: any) => ({
        detectedName: String(item?.detectedName || "").trim(),
        matchName: String(item?.matchName || "").trim(),
        qty: Math.max(1, Math.min(99, Number(item?.qty) || 1)),
        unit: ["pz", "g", "kg", "ml", "l"].includes(item?.unit) ? item.unit : "pz",
        category: String(item?.category || "Generico").trim() || "Generico",
        confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0)),
        observedText: String(item?.observedText || "").trim(),
        expiryDate: /^\d{4}-\d{2}-\d{2}$/.test(String(item?.expiryDate || "")) ? String(item.expiryDate) : "",
        notes: String(item?.notes || "").trim()
      })).filter((item: any) => item.detectedName)
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, 500);
  }
});