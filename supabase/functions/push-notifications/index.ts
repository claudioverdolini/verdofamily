import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import webpush from "npm:web-push@3.6.7";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-push-secret","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...CORS,"Content-Type":"application/json"}});
const allowed=["calendar","deadlines","chores","school","board","shopping"];
const copy:any={
 calendar:["Calendario aggiornato","Ci sono novità negli impegni della famiglia.","calendar"],
 deadlines:["Scadenze aggiornate","Lo scadenziario familiare è stato aggiornato.","deadlines"],
 chores:["Compiti e paghette aggiornati","Ci sono novità nelle attività della famiglia.","chores"],
 school:["Scuola aggiornata","Ci sono novità nell'area scuola.","school"],
 board:["Bacheca aggiornata","È disponibile un nuovo aggiornamento per la famiglia.","board"],
 shopping:["Spesa e dispensa aggiornate","Ci sono novità nella lista spesa o nelle scorte.","shopping"]
};
const topicPrefs=(v:any)=>Object.fromEntries(allowed.map(k=>[k,typeof v?.[k]==="boolean"?v[k]:true]));

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:CORS});
 if(req.method!=="POST") return reply({ok:false,error:"method_not_allowed"},405);
 try{
  const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
  const b=await req.json().catch(()=>({})), familyId=String(b.familyId||"");
  const {data:v}=await sb.from("push_vapid_config").select("public_key,private_key,subject").eq("id",true).maybeSingle();
  if(!v) return reply({ok:false,error:"push_not_configured"},503);

  webpush.setVapidDetails(v.subject,v.public_key,v.private_key);
  const send=async(rows:any[],payload:any)=>{
   let sent=0,stale=0;
   for(const r of rows){
    try{await webpush.sendNotification({endpoint:r.endpoint,keys:{p256dh:r.p256dh,auth:r.auth}},JSON.stringify(payload),{TTL:300});sent++}
    catch(e:any){const st=Number(e?.statusCode||0); if(st===404||st===410){stale++;await sb.from("push_subscriptions").delete().eq("id",r.id)}}
   }
   return {sent,stale};
  };

  const buildPayload=(cats:any[])=>{const c:any=copy[cats[0] as any];return cats.length===1?{title:c[0],body:c[1],url:"/?page="+c[2],tag:"verdofamily-"+cats[0]}:{title:"VerdoFamily aggiornato",body:"Ci sono novità in più sezioni della famiglia.",url:"/?page="+c[2],tag:"verdofamily-family-update"}};

  if(b.action==="notify-system" || b.action==="process-scheduled"){
   const supplied=req.headers.get("x-push-secret")||"";
   const {data:secretRow}=await sb.from("system_settings").select("value").eq("key","push_cron_secret").maybeSingle();
   if(!supplied||!secretRow?.value||supplied!==secretRow.value) return reply({ok:false,error:"unauthorized"},401);

   if(b.action==="process-scheduled"){
    const {data:due,error:dueErr}=await sb.rpc("push_due_scheduled_reminders",{p_now:new Date().toISOString()});
    if(dueErr) throw dueErr;
    let sent=0,duplicate=0,failed=0,stale=0,recipients=0;
    const reminders=Array.isArray(due)?due.slice(0,250):[];

    for(const reminder of reminders){
     const targetIds=Array.isArray(reminder.target_user_ids)?reminder.target_user_ids.filter(Boolean):[];
     if(!targetIds.length) continue;
     const {data:rows,error:rowsErr}=await sb
       .from("push_subscriptions")
       .select("id,user_id,endpoint,p256dh,auth,topics")
       .eq("family_id",reminder.family_id)
       .in("user_id",targetIds);
     if(rowsErr) throw rowsErr;

     const targets=(rows||[]).filter((r:any)=>topicPrefs(r.topics)[reminder.category]!==false);
     recipients+=targets.length;

     for(const r of targets){
      const {data:claim,error:claimErr}=await sb
        .from("push_delivery_logs")
        .insert({
          family_id:reminder.family_id,
          user_id:r.user_id,
          subscription_id:r.id,
          notification_key:String(reminder.notification_key),
          category:String(reminder.category),
          status:"sending"
        })
        .select("id")
        .maybeSingle();

      if(claimErr){
       if(String(claimErr.code||"")==="23505"){duplicate++;continue}
       throw claimErr;
      }
      if(!claim?.id){duplicate++;continue}

      try{
       await webpush.sendNotification(
        {endpoint:r.endpoint,keys:{p256dh:r.p256dh,auth:r.auth}},
        JSON.stringify({
          title:String(reminder.title||"Promemoria VerdoFamily"),
          body:String(reminder.body||"Hai un promemoria in programma."),
          url:String(reminder.url||"/"),
          tag:String(reminder.tag||"verdofamily-reminder")
        }),
        {TTL:900}
       );
       sent++;
       await sb.from("push_delivery_logs").update({status:"sent",sent_at:new Date().toISOString(),error:null}).eq("id",claim.id);
      }catch(e:any){
       const st=Number(e?.statusCode||0);
       if(st===404||st===410) stale++;
       failed++;
       await sb.from("push_delivery_logs").update({
        status:"error",
        error:String(e?.message||("push_error_"+st)).slice(0,1000)
       }).eq("id",claim.id);
      }
     }
    }
    return reply({ok:true,checked:reminders.length,recipients,sent,duplicate,failed,stale});
   }

   if(!familyId) return reply({ok:false,error:"family_id_required"},400);
   const cats=[...new Set((Array.isArray(b.categories)?b.categories:[]).filter((x:any)=>allowed.includes(x)))];
   if(!cats.length) return reply({ok:false,error:"categories_required"},400);
   let q=sb.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth,topics").eq("family_id",familyId);
   const exclude=String(b.excludeUserId||""); if(exclude) q=q.neq("user_id",exclude);
   const {data:rows,error}=await q; if(error) throw error;
   const targets=(rows||[]).filter((r:any)=>cats.some((c:any)=>topicPrefs(r.topics)[c]!==false));
   return reply({ok:true,recipients:targets.length,...await send(targets,buildPayload(cats))});
  }

  if(!familyId) return reply({ok:false,error:"family_id_required"},400);
  const h=req.headers.get("authorization")||"", token=h.startsWith("Bearer ")?h.slice(7):"";
  const {data:ur}=await sb.auth.getUser(token); const user=ur?.user;
  if(!user) return reply({ok:false,error:"unauthorized"},401);
  const {data:m}=await sb.from("family_members").select("role").eq("family_id",familyId).eq("user_id",user.id).maybeSingle();
  if(!m) return reply({ok:false,error:"forbidden"},403);

  if(b.action==="status"){
   let q=sb.from("push_subscriptions").select("id",{count:"exact",head:true}).eq("family_id",familyId).eq("user_id",user.id);
   const endpoint=String(b.endpoint||"").trim(); if(endpoint) q=q.eq("endpoint",endpoint);
   const {count}=await q;
   return reply({ok:true,configured:true,publicKey:v.public_key,subscribed:(count||0)>0});
  }
  if(b.action==="subscribe"){
   const s=b.subscription||{}, endpoint=String(s.endpoint||""), p256dh=String(s.keys?.p256dh||""), auth=String(s.keys?.auth||"");
   if(!endpoint.startsWith("https://")||!p256dh||!auth) return reply({ok:false,error:"invalid_subscription"},400);
   const {error}=await sb.from("push_subscriptions").upsert({family_id:familyId,user_id:user.id,endpoint,p256dh,auth,topics:topicPrefs(b.topics),user_agent:String(b.userAgent||"").slice(0,500)||null,timezone:String(b.timezone||"Europe/Rome").slice(0,80),updated_at:new Date().toISOString(),last_seen_at:new Date().toISOString()},{onConflict:"endpoint"});
   if(error) throw error; return reply({ok:true,subscribed:true});
  }
  if(b.action==="unsubscribe"){
   const endpoint=String(b.endpoint||"");
   if(endpoint) await sb.from("push_subscriptions").delete().eq("family_id",familyId).eq("user_id",user.id).eq("endpoint",endpoint);
   return reply({ok:true,subscribed:false});
  }
  if(b.action==="preferences"){
   const {error}=await sb.from("push_subscriptions").update({topics:topicPrefs(b.topics),updated_at:new Date().toISOString(),last_seen_at:new Date().toISOString()}).eq("family_id",familyId).eq("user_id",user.id);
   if(error) throw error; return reply({ok:true});
  }

  if(b.action==="test"){
   let q=sb.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("family_id",familyId).eq("user_id",user.id);
   if(b.endpoint) q=q.eq("endpoint",String(b.endpoint));
   const {data:rows}=await q; if(!rows?.length) return reply({ok:false,error:"no_subscription"},404);
   return reply({ok:true,...await send(rows,{title:"VerdoFamily",body:"Le notifiche push sono attive su questo dispositivo.",url:"/?page=settings",tag:"verdofamily-push-test"})});
  }
  if(b.action==="notify-family"){
   const cats=[...new Set((Array.isArray(b.categories)?b.categories:[]).filter((x:any)=>allowed.includes(x)))];
   if(!cats.length) return reply({ok:false,error:"categories_required"},400);
   const {data:rate,error:rateErr}=await sb.rpc("system_security_rate_limit",{p_scope:"push_notify_family",p_subject_key:user.id+":"+familyId,p_limit:80,p_window_seconds:3600});
   if(rateErr) throw rateErr; if(rate!==true) return reply({ok:false,error:"rate_limited"},429);
   const {data:rows,error}=await sb.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth,topics").eq("family_id",familyId).neq("user_id",user.id);
   if(error) throw error;
   const targets=(rows||[]).filter((r:any)=>cats.some((c:any)=>topicPrefs(r.topics)[c]!==false));
   return reply({ok:true,recipients:targets.length,...await send(targets,buildPayload(cats))});
  }
  return reply({ok:false,error:"unknown_action"},400);
 }catch(e:any){console.error("push-notifications",e?.message||e);return reply({ok:false,error:e?.message||"internal_error"},500)}
});