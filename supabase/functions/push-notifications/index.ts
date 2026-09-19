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
const buildPayload=(cats:any[])=>{const c:any=copy[cats[0] as any]||copy.board;return cats.length===1?{title:c[0],body:c[1],url:"/?page="+c[2],tag:"verdofamily-"+cats[0]}:{title:"VerdoFamily aggiornato",body:"Ci sono novità in più sezioni della famiglia.",url:"/?page="+c[2],tag:"verdofamily-family-update"}};
const array=(v:any)=>Array.isArray(v)?v:[];
const n=(v:any)=>Number(v||0);
const reminderTiming=(minutes:number)=>{
 if(minutes<=0) return "Adesso";
 if(minutes<60) return `Tra ${minutes} minuti`;
 if(minutes===60) return "Tra 1 ora";
 if(minutes<1440 && minutes%60===0) return `Tra ${minutes/60} ore`;
 if(minutes===1440) return "Tra 1 giorno";
 if(minutes%1440===0) return `Tra ${minutes/1440} giorni`;
 return "A breve";
};
const deadlineTiming=(days:number)=>days<=0?"Scade oggi":days===1?"Scade domani":`Scade tra ${days} giorni`;
const familyContextCache=new Map<string,Promise<any>>();
const getFamilyContext=(sb:any,familyId:string)=>{
 if(!familyContextCache.has(familyId)) familyContextCache.set(familyId,(async()=>{
  const [{data:doc},{data:people}]=await Promise.all([
   sb.from("family_documents").select("data").eq("family_id",familyId).maybeSingle(),
   sb.from("family_people").select("legacy_user_id,auth_user_id,display_name").eq("family_id",familyId)
  ]);
  const data=doc?.data||{};
  const users=array(data.users);
  const authToLegacy=new Map((people||[]).filter((p:any)=>p.auth_user_id).map((p:any)=>[String(p.auth_user_id),n(p.legacy_user_id)]));
  return {data,users,authToLegacy};
 })());
 return familyContextCache.get(familyId)!;
};
const detailMode=(ctx:any,authUserId:string)=>{
 const legacy=ctx.authToLegacy.get(String(authUserId));
 const user=ctx.users.find((u:any)=>n(u?.id)===n(legacy));
 return user?.prefs?.notificationDetail==="private"?"private":"full";
};
const userName=(ctx:any,userId:any)=>ctx.users.find((u:any)=>n(u?.id)===n(userId))?.name||"";
const schoolTypeLabel=(type:any)=>({
 homework:"Compito",test:"Verifica",oral:"Interrogazione",material:"Materiale",
 circular:"Circolare",permission:"Autorizzazione",trip:"Uscita",payment:"Pagamento"
} as any)[String(type||"")]||"Scuola";

const systemPayload=(categories:any[],details:any[],authUserId:string,ctx:any)=>{
 const cats=array(categories).filter((x:any)=>allowed.includes(String(x)));
 const fallback=buildPayload(cats.length?cats:["board"]);
 if(detailMode(ctx,authUserId)==="private") return fallback;
 const usable=array(details).filter((d:any)=>d&&cats.includes(String(d.category||"")));
 if(usable.length!==1) return fallback;
 const d=usable[0];
 const category=String(d.category||"");
 if(category==="school"){
  const person=userName(ctx,d.userId);
  const subject=String(d.subject||"").trim();
  const date=String(d.date||"").trim();
  const meta=[schoolTypeLabel(d.type),subject,person,date?date.split("-").reverse().join("/"):""].filter(Boolean).join(" · ");
  return {title:String(d.title||"Aggiornamento scuola"),body:meta||fallback.body,url:"/?page=school",tag:"verdofamily-school-"+String(d.id||"update")};
 }
 if(category==="chores"){
  const person=userName(ctx,d.userId);
  const kind=String(d.kind||"chore");
  const amount=Number(d.amount||0);
  if(kind==="transaction"){
   const type=String(d.type||"");
   const action=type==="payment"?"Pagamento":type==="reversal"?"Storno":"Accredito";
   const meta=[action,person,amount?new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR"}).format(amount):""].filter(Boolean).join(" · ");
   return {title:String(d.title||"Paghetta aggiornata"),body:meta||fallback.body,url:"/?page=chores",tag:"verdofamily-wallet-"+String(d.id||"update")};
  }
  const status=String(d.status||"");
  const when=String(d.deadline||"");
  const statusText=kind==="recurring"
    ? (status==="new"?"Nuovo compito ricorrente":"Compito ricorrente aggiornato")
    : status==="pending"?"Completato · in attesa di approvazione"
      :status==="approved"?"Compito approvato"
      :status==="new"?"Nuovo compito":"Compito aggiornato";
  const reward=amount?new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR"}).format(amount):"";
  const meta=[statusText,person,when?("entro "+when.split("-").reverse().join("/")):"",reward].filter(Boolean).join(" · ");
  return {title:String(d.title||"Compiti e paghette"),body:meta||fallback.body,url:"/?page=chores",tag:"verdofamily-chore-"+String(d.id||"update")};
 }
 if(category==="board"){
  const author=userName(ctx,d.authorUserId);
  const kind=String(d.type||"message")==="reminder"?"Promemoria":String(d.type||"message")==="photo"?"Foto":String(d.type||"message")==="note"?"Nota":"Messaggio";
  const heading=String(d.title||d.preview||"").trim().slice(0,90)||("Nuovo "+kind.toLowerCase());
  const meta=[kind,author].filter(Boolean).join(" · ");
  return {title:heading,body:meta||fallback.body,url:"/?page=board",tag:"verdofamily-board-"+String(d.id||"update")};
 }
 if(category==="shopping"){
  const action=String(d.action||"updated");
  const item=String(d.item||"").trim();
  const qty=String(d.qty||"").trim();
  const unit=String(d.unit||"").trim();
  const label=action==="added"?"Aggiunto alla lista":action==="taken"?"Preso dalla lista":action==="pantry_low"?"Scorta da controllare":action==="pantry_added"?"Aggiunto in dispensa":"Spesa aggiornata";
  const meta=[item,[qty,unit].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
  return {title:label,body:meta||fallback.body,url:"/?page=shopping",tag:"verdofamily-shopping-"+String(d.id||"update")};
 }
 return fallback;
};

const scheduledPayload=(reminder:any,authUserId:string,ctx:any)=>{
 const generic={
  title:String(reminder.title||"Promemoria VerdoFamily"),
  body:String(reminder.body||"Hai un promemoria in programma."),
  url:String(reminder.url||"/"),
  tag:String(reminder.tag||"verdofamily-reminder")
 };
 const key=String(reminder.notification_key||"");
 const parts=key.split(":");
 const itemId=n(parts[2]);
 if(reminder.category==="calendar"){
  generic.url=`/?page=calendar&event=${itemId}`;
  if(detailMode(ctx,authUserId)==="private") return generic;
  const event=array(ctx.data?.calendarEvents).find((item:any)=>n(item?.id)===itemId);
  if(!event) return generic;
  const minutes=n(parts[parts.length-1]);
  const ids=event?.audience==="family"
   ? []
   : (array(event?.userIds).length?array(event.userIds).map(n):[n(event?.userId)]).filter(Boolean);
  const people=event?.audience==="family"
   ? "Famiglia"
   : ids.map((id:number)=>ctx.users.find((u:any)=>n(u?.id)===id)?.name).filter(Boolean).join(", ");
  const detail=[reminderTiming(minutes),event?.time?`ore ${event.time}`:"",people].filter(Boolean).join(" · ");
  return {title:String(event?.title||"Impegno VerdoFamily"),body:detail||generic.body,url:generic.url,tag:generic.tag};
 }
 if(reminder.category==="deadlines"){
  generic.url=`/?page=deadlines&deadline=${itemId}`;
  if(detailMode(ctx,authUserId)==="private") return generic;
  const deadline=array(ctx.data?.deadlines).find((item:any)=>n(item?.id)===itemId);
  if(!deadline) return generic;
  const days=n(parts[parts.length-1]);
  const person=ctx.users.find((u:any)=>n(u?.id)===n(deadline?.userId))?.name;
  const detail=[deadlineTiming(days),person].filter(Boolean).join(" · ");
  return {title:String(deadline?.title||"Scadenza VerdoFamily"),body:detail||generic.body,url:generic.url,tag:generic.tag};
 }
 return generic;
};

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


  if(b.action==="notify-system" || b.action==="process-scheduled"){
   const supplied=req.headers.get("x-push-secret")||"";
   const {data:secretRow}=await sb.from("system_settings").select("value").eq("key","push_cron_secret").maybeSingle();
   if(!supplied||!secretRow?.value||supplied!==secretRow.value) return reply({ok:false,error:"unauthorized"},401);

   if(b.action==="process-scheduled"){
    familyContextCache.clear();
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

      let claimId=claim?.id;
      if(claimErr){
       if(String(claimErr.code||"")==="23505"){
        const {data:retryClaim,error:retryErr}=await sb
          .from("push_delivery_logs")
          .update({status:"sending",error:null})
          .eq("subscription_id",r.id)
          .eq("notification_key",String(reminder.notification_key))
          .eq("status","error")
          .select("id")
          .maybeSingle();
        if(retryErr) throw retryErr;
        if(!retryClaim?.id){duplicate++;continue}
        claimId=retryClaim.id;
       }else throw claimErr;
      }
      if(!claimId){duplicate++;continue}

      try{
       await webpush.sendNotification(
        {endpoint:r.endpoint,keys:{p256dh:r.p256dh,auth:r.auth}},
        JSON.stringify(scheduledPayload(reminder,String(r.user_id),await getFamilyContext(sb,String(reminder.family_id)))),
        {TTL:900}
       );
       sent++;
       await sb.from("push_delivery_logs").update({status:"sent",sent_at:new Date().toISOString(),error:null}).eq("id",claimId);
      }catch(e:any){
       const st=Number(e?.statusCode||0);
       if(st===404||st===410) stale++;
       failed++;
       await sb.from("push_delivery_logs").update({
        status:"error",
        error:String(e?.message||("push_error_"+st)).slice(0,1000)
       }).eq("id",claimId);
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
   const ctx=await getFamilyContext(sb,familyId);
   let sent=0,stale=0;
   for(const r of targets){
    const payload=systemPayload(cats,array(b.details),String(r.user_id),ctx);
    const outcome=await send([r],payload);
    sent+=outcome.sent; stale+=outcome.stale;
   }
   return reply({ok:true,recipients:targets.length,sent,stale});
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