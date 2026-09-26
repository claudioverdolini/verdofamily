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

const MAX_BASE64_CHARS = 26_000_000;
const SUPPORTED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"]);

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

async function audit(client: any, event: {
  actorUserId?: string | null;
  familyId?: string | null;
  eventType: string;
  success?: boolean;
  severity?: "info" | "warning" | "critical";
  metadata?: Record<string, unknown>;
}) {
  const { error } = await client.rpc("system_security_audit", {
    p_actor_user_id: event.actorUserId || null,
    p_family_id: event.familyId || null,
    p_event_type: event.eventType,
    p_success: event.success !== false,
    p_severity: event.severity || "info",
    p_target_type: "pantry_vision",
    p_target_id: event.familyId || null,
    p_metadata: event.metadata || {}
  });
  if (error) console.warn("security_audit_failed", error.message);
}

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

    const action = String(body?.action || "");
    if (!["analyze", "analyze-receipt", "analyze-receipt-text", "estimate-residual"].includes(action)) return json({ ok: false, error: "unknown_action" }, 400);
    if (!geminiKey) return json({ ok: false, error: "vision_not_configured" }, 503);

    const allowed = await rateLimit(
      client,
      action === "estimate-residual" ? "pantry_vision_residual" : action === "analyze-receipt" ? "receipt_vision_analyze" : action === "analyze-receipt-text" ? "receipt_text_analyze" : "pantry_vision_analyze",
      `${user.id}:${familyId}`,
      action === "estimate-residual" ? 30 : action === "analyze-receipt" ? 30 : action === "analyze-receipt-text" ? 40 : 20,
      3600
    );
    if (!allowed) {
      await audit(client, {
        actorUserId: user.id,
        familyId,
        eventType: action === "estimate-residual" ? "pantry_residual_rate_limited" : "pantry_vision_rate_limited",
        success: false,
        severity: "warning"
      });
      return json({ ok: false, error: "rate_limited" }, 429);
    }


    if (action === "analyze-receipt-text") {
      const receiptText = String(body?.receiptText || "").trim().slice(0, 20000);
      if (!receiptText) return json({ ok: false, error: "receipt_text_required" }, 400);

      const { data: receiptDoc, error: receiptDocError } = await client
        .from("family_documents")
        .select("data")
        .eq("family_id", familyId)
        .single();
      if (receiptDocError) return json({ ok: false, error: "family_data_unavailable" }, 500);

      const familyData = (receiptDoc?.data || {}) as any;
      const pantry = Array.isArray(familyData?.pantry) ? familyData.pantry : [];
      const categories = Array.isArray(familyData?.categories) ? familyData.categories : ["Generico"];
      const existing = pantry.slice(0, 350).map((item: any) => ({
        name: String(item?.name || ""),
        brand: String(item?.brand || item?.productInfo?.brand || ""),
        category: String(item?.category || "Generico"),
        unit: String(item?.unit || "pz"),
        location: ["pantry","fridge","freezer"].includes(String(item?.location || "")) ? String(item.location) : "pantry"
      })).filter((item: any) => item.name);

      const receiptPrompt = `Sei il correttore intelligente OCR degli scontrini di VerdoFamily.
Hai a disposizione SOLO testo OCR rumoroso estratto da uno scontrino. Devi trasformarlo in dati utili senza inventare prodotti.

Regole:
- Ricostruisci solo prodotti che riesci a identificare con sufficiente affidabilità dal testo.
- Elimina righe fiscali, indirizzi, intestazioni, IVA, pagamenti, sconti generici, punti, carte, subtotali e totale.
- Se una sequenza è incomprensibile NON trasformarla in un nome prodotto: omettila.
- detectedName deve essere breve e umano, per esempio "Banane", "Yogurt greco", "Pasta spaghetti".
- observedText conserva la breve dicitura OCR da cui hai ricavato il prodotto.
- matchName deve essere ESATTAMENTE uno dei nomi del catalogo solo se chiaramente compatibile; altrimenti stringa vuota.
- qty è la quantità acquistata; se non deducibile usa 1.
- unit tra pz, g, kg, ml, l.
- totalPrice è il totale della riga se leggibile, altrimenti 0.
- unitPrice è il prezzo unitario se deducibile, altrimenti 0.
- category deve preferibilmente essere una categoria disponibile.
- location: freezer per surgelati/gelati; fridge per alimenti freschi e refrigerati; pantry per prodotti a temperatura ambiente e prodotti casa.
- Se il prodotto esiste già, preferisci categoria, unità e location del catalogo.
- confidence tra 0 e 1; ometti prodotti sotto 0,45.
- merchant, date (YYYY-MM-DD) e total vanno estratti solo se sufficientemente leggibili.
- rawText deve essere una versione ripulita e leggibile del testo, senza spazzatura OCR.

Categorie: ${JSON.stringify(categories)}
Catalogo esistente: ${JSON.stringify(existing)}

TESTO OCR:
${receiptText}

Restituisci esclusivamente JSON conforme allo schema.`;

      const receiptSchema = {
        type: "OBJECT",
        properties: {
          merchant: { type: "STRING" },
          date: { type: "STRING" },
          total: { type: "NUMBER" },
          rawText: { type: "STRING" },
          items: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                detectedName: { type: "STRING" },
                matchName: { type: "STRING" },
                qty: { type: "NUMBER" },
                unit: { type: "STRING", enum: ["pz","g","kg","ml","l"] },
                category: { type: "STRING" },
                location: { type: "STRING", enum: ["pantry","fridge","freezer"] },
                totalPrice: { type: "NUMBER" },
                unitPrice: { type: "NUMBER" },
                confidence: { type: "NUMBER" },
                observedText: { type: "STRING" },
                brand: { type: "STRING" },
                variant: { type: "STRING" },
                packageSize: { type: "STRING" }
              },
              required: ["detectedName","matchName","qty","unit","category","location","totalPrice","unitPrice","confidence","observedText","brand","variant","packageSize"]
            }
          }
        },
        required: ["merchant","date","total","rawText","items"]
      };

      const requestBody = JSON.stringify({
        contents: [{ role: "user", parts: [{ text: receiptPrompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      });

      let result: any = null;
      let usedModel = "";
      let lastStatus = 0;
      let lastMessage = "";

      for (const model of geminiModels) {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
          body: requestBody
        });
        const candidate = await response.json().catch(() => ({}));
        if (response.ok) { result = candidate; usedModel = model; break; }
        lastStatus = response.status;
        lastMessage = String(candidate?.error?.message || `gemini_http_${response.status}`);
        const lower = lastMessage.toLowerCase();
        const retryable = [400, 404, 429, 500, 502, 503, 504].includes(response.status)
          || lower.includes("high demand") || lower.includes("overloaded")
          || lower.includes("temporarily") || lower.includes("unavailable");
        if (!retryable) return json({ ok: false, error: lastMessage }, response.status >= 500 ? 502 : 400);
      }

      if (!result || !usedModel) {
        return json({ ok: false, error: "Correzione OCR intelligente non disponibile.", code: "ai_temporarily_unavailable", lastStatus, lastMessage }, 503);
      }

      const output = textPart(result);
      if (!output) return json({ ok: false, error: "empty_receipt_text_response" }, 502);

      let parsed: any;
      try { parsed = JSON.parse(output); } catch { return json({ ok: false, error: "invalid_receipt_text_response" }, 502); }

      const normalizedItems = (Array.isArray(parsed?.items) ? parsed.items : []).slice(0, 120).map((item: any) => ({
        detectedName: String(item?.detectedName || "").trim().slice(0, 180),
        matchName: String(item?.matchName || "").trim().slice(0, 180),
        qty: Math.max(0.01, Math.min(999, Number(item?.qty) || 1)),
        unit: ["pz","g","kg","ml","l"].includes(String(item?.unit || "")) ? String(item.unit) : "pz",
        category: String(item?.category || "Generico").trim() || "Generico",
        location: ["pantry","fridge","freezer"].includes(String(item?.location || "")) ? String(item.location) : "pantry",
        totalPrice: Math.max(0, Number(item?.totalPrice) || 0),
        unitPrice: Math.max(0, Number(item?.unitPrice) || 0),
        confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0)),
        observedText: String(item?.observedText || "").trim().slice(0, 220),
        brand: String(item?.brand || "").trim().slice(0, 120),
        variant: String(item?.variant || "").trim().slice(0, 120),
        packageSize: String(item?.packageSize || "").trim().slice(0, 100)
      })).filter((item: any) => item.detectedName && item.confidence >= 0.45);

      await audit(client, {
        actorUserId: user.id,
        familyId,
        eventType: "receipt_text_analyzed",
        metadata: { model: usedModel, items: normalizedItems.length }
      });

      return json({
        ok: true,
        model: usedModel,
        merchant: String(parsed?.merchant || "").trim().slice(0, 160),
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed?.date || "")) ? String(parsed.date) : "",
        total: Math.max(0, Number(parsed?.total) || 0),
        rawText: String(parsed?.rawText || "").trim().slice(0, 12000),
        items: normalizedItems
      });
    }

    const imageData = String(body?.imageData || "").replace(/^data:[^;]+;base64,/, "");
    const mimeType = String(body?.mimeType || "image/jpeg").toLowerCase();
    if (!SUPPORTED_MIME.has(mimeType)) return json({ ok: false, error: "unsupported_image_type" }, 400);
    if (!imageData || imageData.length > MAX_BASE64_CHARS) return json({ ok: false, error: "image_too_large" }, 413);

    if (action === "estimate-residual") {
      const productName = String(body?.productName || "prodotto").trim().slice(0, 160);
      const packageHint = String(body?.packageHint || "").trim().slice(0, 100);
      const residualPrompt = `Analizza questa foto come seconda foto di una confezione GIÀ APERTA di "${productName}".
L'obiettivo è stimare esclusivamente quanto prodotto rimane dentro la confezione.

Regole:
- Considera solo il contenuto realmente visibile.
- percentRemaining deve essere una stima da 0 a 100 del contenuto residuo rispetto a una confezione piena.
- Se dalla foto o dal suggerimento formato puoi stimare anche una quantità fisica, usa estimatedQuantity e unit (g, kg, ml, l o pz).
- Se la quantità fisica non è affidabile, estimatedQuantity deve essere 0 e unit stringa vuota: in questo caso il percentuale residua è comunque utile.
- confidence è tra 0 e 1.
- Non inventare pesi o volumi non deducibili.
- note deve spiegare in pochissime parole su cosa si basa la stima.
${packageHint ? `Formato noto/indicato: ${packageHint}` : ""}

Restituisci esclusivamente il JSON conforme allo schema.`;

      const residualSchema = {
        type: "OBJECT",
        properties: {
          percentRemaining: { type: "NUMBER" },
          estimatedQuantity: { type: "NUMBER" },
          unit: { type: "STRING" },
          confidence: { type: "NUMBER" },
          note: { type: "STRING" }
        },
        required: ["percentRemaining", "estimatedQuantity", "unit", "confidence", "note"]
      };

      const residualRequest = JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { inlineData: { mimeType, data: imageData } },
            { text: residualPrompt }
          ]
        }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: residualSchema
        }
      });

      let residualResult: any = null;
      let residualModel = "";
      let residualLastStatus = 0;
      let residualLastMessage = "";

      for (const model of geminiModels) {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": geminiKey
          },
          body: residualRequest
        });
        const candidate = await response.json().catch(() => ({}));
        if (response.ok) {
          residualResult = candidate;
          residualModel = model;
          break;
        }
        residualLastStatus = response.status;
        residualLastMessage = String(candidate?.error?.message || `gemini_http_${response.status}`);
        const lower = residualLastMessage.toLowerCase();
        const retryable = [400, 404, 429, 500, 502, 503, 504].includes(response.status)
          || lower.includes("high demand")
          || lower.includes("overloaded")
          || lower.includes("temporarily")
          || lower.includes("unavailable");
        if (!retryable) return json({ ok: false, error: residualLastMessage }, response.status >= 500 ? 502 : 400);
      }

      if (!residualResult || !residualModel) {
        return json({
          ok: false,
          error: "La stima del residuo non è disponibile in questo momento.",
          code: "ai_temporarily_unavailable",
          lastStatus: residualLastStatus,
          lastMessage: residualLastMessage
        }, 503);
      }

      const residualOutput = textPart(residualResult);
      if (!residualOutput) return json({ ok: false, error: "empty_residual_response" }, 502);

      let residualParsed: any;
      try { residualParsed = JSON.parse(residualOutput); } catch { return json({ ok: false, error: "invalid_residual_response" }, 502); }

      const percentRemaining = Math.max(0, Math.min(100, Number(residualParsed?.percentRemaining) || 0));
      const estimatedQuantity = Math.max(0, Number(residualParsed?.estimatedQuantity) || 0);
      const residualUnit = ["g","kg","ml","l","pz"].includes(String(residualParsed?.unit || "")) ? String(residualParsed.unit) : "";
      const confidence = Math.max(0, Math.min(1, Number(residualParsed?.confidence) || 0));
      const note = String(residualParsed?.note || "").trim().slice(0, 300);

      await audit(client, {
        actorUserId: user.id,
        familyId,
        eventType: "pantry_residual_estimated",
        metadata: { model: residualModel, confidence, hasQuantity: estimatedQuantity > 0 }
      });

      return json({
        ok: true,
        model: residualModel,
        percentRemaining,
        estimatedQuantity,
        unit: residualUnit,
        confidence,
        note
      });
    }


    if (action === "analyze-receipt") {
      const { data: receiptDoc, error: receiptDocError } = await client
        .from("family_documents")
        .select("data")
        .eq("family_id", familyId)
        .single();
      if (receiptDocError) return json({ ok: false, error: "family_data_unavailable" }, 500);

      const familyData = (receiptDoc?.data || {}) as any;
      const pantry = Array.isArray(familyData?.pantry) ? familyData.pantry : [];
      const categories = Array.isArray(familyData?.categories) ? familyData.categories : ["Generico"];
      const existing = pantry.slice(0, 350).map((item: any) => ({
        name: String(item?.name || ""),
        brand: String(item?.brand || item?.productInfo?.brand || ""),
        category: String(item?.category || "Generico"),
        unit: String(item?.unit || "pz"),
        location: ["pantry","fridge","freezer"].includes(String(item?.location || "")) ? String(item.location) : "pantry"
      })).filter((item: any) => item.name);

      const receiptPrompt = `Sei il motore di lettura scontrini di VerdoFamily. Analizza la FOTO dello scontrino direttamente: non limitarti a trascrivere OCR rumoroso.

Obiettivo:
1) riconoscere esercente, data e totale;
2) individuare SOLO le righe che rappresentano veri prodotti acquistati;
3) ricostruire per ogni riga un nome prodotto breve e sensato in italiano, anche quando le abbreviazioni dello scontrino sono difficili;
4) associare, quando sei davvero sicuro, un prodotto già presente nel catalogo;
5) decidere automaticamente dove va conservato l'articolo.

Regole importanti:
- NON usare frammenti illeggibili o sequenze OCR senza senso come nome prodotto.
- Se una riga non è abbastanza comprensibile per identificare almeno il tipo di prodotto, omettila invece di inventare.
- Escludi totale, subtotale, sconti generici, IVA, pagamenti, carte, punti, cauzioni, righe fiscali, intestazioni e messaggi promozionali.
- detectedName deve essere un nome umano e conciso (es. "Yogurt greco", "Banane", "Pasta spaghetti", "Detersivo piatti").
- observedText può contenere la breve dicitura effettivamente letta sullo scontrino.
- matchName deve essere ESATTAMENTE uno dei nomi del catalogo esistente solo se è chiaramente lo stesso prodotto; altrimenti stringa vuota.
- qty: quantità acquistata. Se non è deducibile usa 1.
- unit: pz per confezioni; usa g/kg/ml/l solo se lo scontrino indica davvero una quantità venduta a peso/volume.
- totalPrice: prezzo totale della riga dopo eventuale quantità, se leggibile; altrimenti 0.
- unitPrice: prezzo unitario se deducibile, altrimenti 0.
- category: preferisci una categoria già censita; se non è possibile usa Generico.
- location deve essere:
  * freezer per surgelati, gelati e prodotti chiaramente congelati;
  * fridge per carne/pesce freschi, salumi, latticini freschi, yogurt, formaggi, pasta fresca e prodotti normalmente refrigerati;
  * pantry per pasta/riso/conserve/bevande a lunga conservazione, snack, prodotti casa/igiene e tutto ciò che normalmente si conserva a temperatura ambiente.
- Se matchName corrisponde a un prodotto esistente, usa preferibilmente la sua location già censita.
- confidence da 0 a 1. Sotto 0,45 sii molto prudente e ometti la riga se il prodotto non è identificabile.
- rawText: restituisci una ricostruzione leggibile e sintetica dello scontrino, non rumore OCR.
- date: YYYY-MM-DD se leggibile, altrimenti stringa vuota.
- total: totale pagato se leggibile, altrimenti 0.

Categorie disponibili: ${JSON.stringify(categories)}
Catalogo esistente: ${JSON.stringify(existing)}

Restituisci esclusivamente JSON conforme allo schema.`;

      const receiptSchema = {
        type: "OBJECT",
        properties: {
          merchant: { type: "STRING" },
          date: { type: "STRING" },
          total: { type: "NUMBER" },
          rawText: { type: "STRING" },
          items: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                detectedName: { type: "STRING" },
                matchName: { type: "STRING" },
                qty: { type: "NUMBER" },
                unit: { type: "STRING", enum: ["pz","g","kg","ml","l"] },
                category: { type: "STRING" },
                location: { type: "STRING", enum: ["pantry","fridge","freezer"] },
                totalPrice: { type: "NUMBER" },
                unitPrice: { type: "NUMBER" },
                confidence: { type: "NUMBER" },
                observedText: { type: "STRING" },
                brand: { type: "STRING" },
                variant: { type: "STRING" },
                packageSize: { type: "STRING" }
              },
              required: ["detectedName","matchName","qty","unit","category","location","totalPrice","unitPrice","confidence","observedText","brand","variant","packageSize"]
            }
          }
        },
        required: ["merchant","date","total","rawText","items"]
      };

      const receiptRequest = JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { inlineData: { mimeType, data: imageData } },
            { text: receiptPrompt }
          ]
        }],
        generationConfig: {
          responseMimeType: "application/json"
        }
      });

      let receiptResult: any = null;
      let receiptModel = "";
      let receiptLastStatus = 0;
      let receiptLastMessage = "";

      for (const model of geminiModels) {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": geminiKey
          },
          body: receiptRequest
        });
        const candidate = await response.json().catch(() => ({}));
        if (response.ok) {
          receiptResult = candidate;
          receiptModel = model;
          break;
        }
        receiptLastStatus = response.status;
        receiptLastMessage = String(candidate?.error?.message || `gemini_http_${response.status}`);
        const lower = receiptLastMessage.toLowerCase();
        const retryable = [400, 404, 429, 500, 502, 503, 504].includes(response.status)
          || lower.includes("high demand")
          || lower.includes("overloaded")
          || lower.includes("temporarily")
          || lower.includes("unavailable");
        if (!retryable) return json({ ok: false, error: receiptLastMessage }, response.status >= 500 ? 502 : 400);
      }

      if (!receiptResult || !receiptModel) {
        return json({
          ok: false,
          error: "Il riconoscimento intelligente dello scontrino non è disponibile in questo momento.",
          code: "ai_temporarily_unavailable",
          lastStatus: receiptLastStatus,
          lastMessage: receiptLastMessage
        }, 503);
      }

      const receiptOutput = textPart(receiptResult);
      if (!receiptOutput) return json({ ok: false, error: "empty_receipt_response" }, 502);

      let parsed: any;
      try { parsed = JSON.parse(receiptOutput); } catch { return json({ ok: false, error: "invalid_receipt_response" }, 502); }

      const normalizedItems = (Array.isArray(parsed?.items) ? parsed.items : []).slice(0, 120).map((item: any) => ({
        detectedName: String(item?.detectedName || "").trim().slice(0, 180),
        matchName: String(item?.matchName || "").trim().slice(0, 180),
        qty: Math.max(0.01, Math.min(999, Number(item?.qty) || 1)),
        unit: ["pz","g","kg","ml","l"].includes(String(item?.unit || "")) ? String(item.unit) : "pz",
        category: String(item?.category || "Generico").trim() || "Generico",
        location: ["pantry","fridge","freezer"].includes(String(item?.location || "")) ? String(item.location) : "pantry",
        totalPrice: Math.max(0, Number(item?.totalPrice) || 0),
        unitPrice: Math.max(0, Number(item?.unitPrice) || 0),
        confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0)),
        observedText: String(item?.observedText || "").trim().slice(0, 220),
        brand: String(item?.brand || "").trim().slice(0, 120),
        variant: String(item?.variant || "").trim().slice(0, 120),
        packageSize: String(item?.packageSize || "").trim().slice(0, 100)
      })).filter((item: any) => item.detectedName && item.confidence >= 0.35);

      const merchant = String(parsed?.merchant || "").trim().slice(0, 160);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(parsed?.date || "")) ? String(parsed.date) : "";
      const total = Math.max(0, Number(parsed?.total) || 0);
      const rawText = String(parsed?.rawText || "").trim().slice(0, 12000);

      await audit(client, {
        actorUserId: user.id,
        familyId,
        eventType: "receipt_vision_analyzed",
        metadata: { model: receiptModel, items: normalizedItems.length, merchant: merchant.slice(0, 60) }
      });

      return json({
        ok: true,
        model: receiptModel,
        merchant,
        date,
        total,
        rawText,
        items: normalizedItems
      });
    }

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
    const prompt = `Sei il riconoscimento fotografico dell'inventario di VerdoFamily. Analizza SOLO ciò che è realmente visibile nella foto (scaffale, dispensa, frigorifero o prodotti appoggiati).\n\nObiettivo: individuare prodotti alimentari e prodotti domestici acquistabili che l'utente può voler caricare nell'inventario. Non elencare mobili, contenitori generici, piatti, elettrodomestici o oggetti non pertinenti. Non inventare prodotti nascosti o non leggibili.\n\nRegole:\n- Per ogni prodotto restituisci un nome breve in italiano. Includi marca/variante solo se chiaramente visibile e utile. Il testo letto sulle confezioni è solo un indizio: NON restituire lunghi frammenti OCR come nome prodotto.\n- Riconosci anche frutta e verdura sfusa quando è visivamente identificabile. Se una bilancia/etichetta leggibile indica chiaramente il peso, puoi usare g o kg; altrimenti usa pz.\n- Stima la quantità di confezioni effettivamente visibili. Se è dubbia usa 1 e abbassa la confidenza. Ignora prodotti quasi completamente nascosti.\n- unit deve essere una tra pz, g, kg, ml, l; normalmente usa pz per confezioni intere.\n- confidence è tra 0 e 1.\n- observedText contiene poche parole realmente lette sulla confezione, se disponibili.\n- brand contiene la marca solo se chiaramente visibile, altrimenti stringa vuota.\n- variant contiene solo la variante/linea utile a distinguere il prodotto (es. "Integrale", "Zero", "Classico", "Limone"), solo se leggibile; altrimenti stringa vuota.\n- packageSize contiene il formato dichiarato sulla confezione (es. "500 g", "1 L", "6 x 1,5 L"), solo se leggibile; altrimenti stringa vuota.\n- barcode contiene esclusivamente le cifre del codice EAN/UPC se è chiaramente leggibile nella foto; se non sei sicuro usa stringa vuota. Non inventare mai un barcode.\n- matchName deve essere ESATTAMENTE uno dei nomi del catalogo esistente solo quando ritieni che sia lo stesso prodotto; altrimenti stringa vuota.\n- category deve essere preferibilmente una delle categorie disponibili; se non sei sicuro usa Generico.\n- Raggruppa confezioni identiche in una sola riga con qty maggiore di 1.\n\nCategorie disponibili: ${JSON.stringify(categories)}\nCatalogo esistente: ${JSON.stringify(existing)}\n\nRestituisci esclusivamente il JSON conforme allo schema.`;

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
              location: { type: "STRING", enum: ["pantry", "fridge", "freezer"] },
              confidence: { type: "NUMBER" },
              observedText: { type: "STRING" },
              brand: { type: "STRING" },
              variant: { type: "STRING" },
              packageSize: { type: "STRING" },
              barcode: { type: "STRING" },
              packageState: { type: "STRING", enum: ["sealed", "opened", "possibly_opened", "unknown"] },
              openReason: { type: "STRING" },
              expiryDate: { type: "STRING" },
              notes: { type: "STRING" }
            },
            required: ["detectedName", "matchName", "qty", "unit", "category", "location", "confidence", "observedText", "brand", "variant", "packageSize", "barcode", "packageState", "openReason", "expiryDate", "notes"]
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
      const retryable = [400, 404, 429, 500, 502, 503, 504].includes(response.status)
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

    const normalizedItems = items.map((item: any) => ({
      detectedName: String(item?.detectedName || "").trim(),
      matchName: String(item?.matchName || "").trim(),
      qty: Math.max(1, Math.min(99, Number(item?.qty) || 1)),
      unit: ["pz", "g", "kg", "ml", "l"].includes(item?.unit) ? item.unit : "pz",
      category: String(item?.category || "Generico").trim() || "Generico",
      location: ["pantry","fridge","freezer"].includes(String(item?.location || "")) ? String(item.location) : locationHint,
      confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0)),
      observedText: String(item?.observedText || "").trim(),
      brand: String(item?.brand || "").trim().slice(0, 100),
      variant: String(item?.variant || "").trim().slice(0, 120),
      packageSize: String(item?.packageSize || "").trim().slice(0, 80),
      barcode: /^\d{8,14}$/.test(String(item?.barcode || "").replace(/\D/g, "")) ? String(item.barcode).replace(/\D/g, "") : "",
      packageState: ["sealed", "opened", "possibly_opened", "unknown"].includes(String(item?.packageState || "")) ? String(item.packageState) : "unknown",
      openReason: String(item?.openReason || "").trim().slice(0, 240),
      expiryDate: /^\d{4}-\d{2}-\d{2}$/.test(String(item?.expiryDate || "")) ? String(item.expiryDate) : "",
      notes: String(item?.notes || "").trim()
    })).filter((item: any) => item.detectedName);

    await audit(client, {
      actorUserId: user.id,
      familyId,
      eventType: "pantry_vision_analyzed",
      metadata: { model: usedModel, items: normalizedItems.length }
    });

    return json({
      ok: true,
      model: usedModel,
      items: normalizedItems
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, 500);
  }
});