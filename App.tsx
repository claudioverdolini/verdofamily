
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar as CalIcon,
  ShoppingCart,
  Users,
  Bell,
  ChefHat,
  ClipboardList,
  FolderClock,
  Settings,
  Upload,
  Download,
  Home,
  Lock,
  LogOut,
  KeyRound,
  Trash2,
  Plus,
} from "lucide-react";

/** FamilyHub – App.tsx (compact stable) – ver. 1.3.0 **/

const LS_KEY = "familyhub:data:v9";
const LS_SESSION = "familyhub:session:v1";

const giorni = [1,2,3,4,5,6,7];
const dayShort = ["Lun","Mar","Mer","Gio","Ven","Sab","Dom"];
const dayFull  = ["Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato","Domenica"];

const uid = (p="id") => `${p}-${Math.random().toString(36).slice(2,9)}`;
const fmtDate = (d: Date|string) => new Date(d).toISOString().slice(0,10);
const today = () => fmtDate(new Date());
const fmtDM = (d: Date) => `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;

// SHA-256 helper
async function sha256Hex(str: string){
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

// ---------- Default data
const DEFAULT_DATA = {
  settings: {
    famiglia: "Famiglia Verdolini",
    valuta: "€",
    inizioSettimana: 1,
    numeroWhatsApp: "",
    fuso: "Europe/Rome",
    carousel: { enabled: true, intervalMs: 4000 },
    google: { clientId: "", calendarId: "primary" },
    supabase: {
      enabled: true,
      url: "https://bmxkrmsiywdsjnyyokgt.supabase.co",
      anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJteGtybXNpeXdkc2pueXlva2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyNTcyMzAsImV4cCI6MjA3NzgzMzIzMH0.l5zWMCyydtAKIJUDq5XCWzqH_wzr_d-X7JiERINKEC0",
      table: "kv",
      recordId: "default",
      status: "idle",
    },
  },
  utenti: [
    { id: "u-admin", nome: "Admin", ruolo: "Admin", username: "admin", salt: null, pwHash: null, mustChange: false },
    { id: "u-adulto", nome: "Genitore", ruolo: "Adulto", username: "genitore", salt: null, pwHash: null, mustChange: false },
  ],
  permessi: {
    Admin: ["tutto"],
    Adulto: ["calendario","spesa","pasti","compiti","scadenze","notifiche","impostazioni"],
    Teen: ["pasti","compiti","calendario"],
    Bimbo: ["compiti"],
    Ospite: ["pasti"],
  },
  eventi: [],
  scadenze: [],
  dispensa: [],
  piatti: [
    { id:"pasta-al-pomodoro", nome:"Pasta al pomodoro", categoria:"Primi", richiede:[{nome:"Pasta",qta:100,unita:"g"},{nome:"Passata",qta:100,unita:"ml"}]},
    { id:"pollo-griglia", nome:"Pollo alla griglia", categoria:"Secondi", richiede:[{nome:"Petto di pollo",qta:1,unita:"pz"}]},
    { id:"insalata-mista", nome:"Insalata mista", categoria:"Contorni", richiede:[{nome:"Insalata",qta:1,unita:"pz"}]},
    { id:"yogurt", nome:"Yogurt bianco", categoria:"Altro", richiede:[{nome:"Yogurt",qta:1,unita:"pz"}]},
  ],
  menuSettimanale: [1,2,3,4,5,6,7].reduce((acc,g)=>({...acc,[g]:{
    colazione:[], merenda:[], pranzo:{primo:[],secondo:[],contorno:[]}, cena:{primo:[],secondo:[],contorno:[]}
  }}),{} as any),
  listaSpesa: [],
  compiti: [],
  cassaFigli: {} as Record<string,number>,
  pagamenti: [],
  schedules: [],
  homePhotos: [{ id: uid("ph"), url: "https://images.unsplash.com/photo-1519681393784-d120267933ba?q=80&w=1280", titolo: "Benvenuti in FamilyHub" }],
};

function loadData(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : DEFAULT_DATA;
  }catch(e){ return DEFAULT_DATA; }
}
function saveData(d:any){ localStorage.setItem(LS_KEY, JSON.stringify(d)); }

// ---------- UI primitives
const Section: React.FC<{title:string;icon?:React.ReactNode;actions?:React.ReactNode;children:React.ReactNode}> = ({title,icon,actions,children}) => (
  <div className="bg-white shadow-sm rounded-2xl p-4 md:p-6 mb-6">
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">{icon}<h2 className="text-xl md:text-2xl font-semibold">{title}</h2></div>
      <div className="flex gap-2">{actions}</div>
    </div>
    {children}
  </div>
);
const Pill: React.FC<{children:React.ReactNode}> = ({children}) => <span className="px-2 py-1 rounded-full text-xs bg-gray-100">{children}</span>;
const Logo = () => (<div className="flex items-center gap-2"><ChefHat className="w-5 h-5"/><span className="font-semibold">FamilyHub</span></div>);
const StatCard: React.FC<{title:string;value:React.ReactNode}> = ({title,value}) => (
  <div className="bg-white rounded-2xl p-4 shadow-sm"><div className="text-sm text-gray-500">{title}</div><div className="text-3xl font-semibold">{value}</div></div>
);

// ---------- Login
const LoginScreen: React.FC<{data:any; setSession: (s:any)=>void}> = ({data,setSession}) => {
  const [username,setUsername] = useState(""); const [password,setPassword] = useState(""); const [error,setError] = useState("");
  const utentiConCred = data.utenti.filter((u:any)=>u.username && u.salt && u.pwHash);

  const tryLogin = async () => {
    const u = data.utenti.find((x:any)=> x.username && x.username.toLowerCase()===username.toLowerCase());
    if(!u || !u.salt || !u.pwHash){ setError("Utente non trovato o credenziali mancanti"); return; }
    const hash = await sha256Hex(`${u.salt}:${password}`);
    if(hash===u.pwHash) setSession({userId:u.id, at:Date.now()}); else setError("Password/PIN errato");
  };
  const enterPreview = ()=> setSession({userId: data.utenti[0]?.id || "u-admin", at: Date.now(), demo:true});

  return (
    <div className="min-h-screen grid place-items-center bg-gray-50 p-6">
      <div className="bg-white rounded-2xl shadow-sm p-6 w-full max-w-sm">
        <div className="flex items-center gap-2 mb-4"><Lock className="w-5 h-5"/><h1 className="text-lg font-semibold">Accedi a FamilyHub</h1></div>
        <div className="space-y-2">
          <input className="border rounded-lg px-3 py-2 w-full" placeholder="Username" value={username} onChange={e=>setUsername(e.target.value)} />
          <input className="border rounded-lg px-3 py-2 w-full" placeholder="Password/PIN" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
          {error && <div className="text-sm text-red-600">{error}</div>}
          <button className="w-full px-3 py-2 rounded-xl bg-black text-white" onClick={tryLogin}>Entra</button>
          <button className="w-full px-3 py-2 rounded-xl bg-gray-100 mt-2" onClick={enterPreview}>Prova anteprima</button>
          {utentiConCred.length===0 && <p className="text-xs text-gray-500 mt-1">Suggerimento: entra in anteprima, vai su <b>Utenti</b> → <b>Credenziali</b> e crea username + PIN.</p>}
        </div>
      </div>
    </div>
  );
};

// ---------- Main App
export default function App(){
  const [data,setData] = useState<any>(loadData());
  const [session,setSession] = useState<any>(()=>{ try{ return JSON.parse(localStorage.getItem(LS_SESSION) || "null"); }catch{ return null; } });
  const [tab,setTab] = useState("dashboard");
  const [currentUserId,setCurrentUserId] = useState<string>(()=> session?.userId || (loadData().utenti[0]?.id) || "u-admin");

  useEffect(()=>{ saveData(data); },[data]);
  useEffect(()=>{ if(session) localStorage.setItem(LS_SESSION, JSON.stringify(session)); else localStorage.removeItem(LS_SESSION); },[session]);

  // Supabase auto-push debounce
  useEffect(()=>{
    const cfg = data.settings?.supabase;
    if(!cfg?.enabled || !cfg?.url || !cfg?.anonKey) return;
    const t = setTimeout(()=>{ supaPush(cfg, data).catch(()=>{}); }, 800);
    return ()=>clearTimeout(t);
  },[data]);

  // Supabase pull on mount
  useEffect(()=>{
    (async()=>{
      try{
        const cfg = data.settings?.supabase;
        if(cfg?.enabled && cfg.url && cfg.anonKey){
          const remote = await supaPull(cfg);
          if(remote?.settings){ setData(remote); saveData(remote); }
        }
      }catch{}
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // Notifications check each minute
  useEffect(()=>{
    const t = setInterval(()=>{
      const now = new Date(); const hh = String(now.getHours()).padStart(2,"0"); const mm = String(now.getMinutes()).padStart(2,"0");
      const dow = ((now.getDay()+6)%7)+1;
      setData((prev:any)=>{
        const due = prev.schedules.filter((s:any)=> s.attivo && (s.giorni||[]).includes(dow) && s.orario===`${hh}:${mm}`);
        if(due.length && "Notification" in window && Notification.permission==="granted"){
          due.forEach((s:any)=> new Notification("FamilyHub", { body: s.messaggio || s.titolo }));
        }
        return prev;
      });
    },60000);
    return ()=>clearInterval(t);
  },[]);
  useEffect(()=>{ if("Notification" in window && Notification.permission==="default") Notification.requestPermission(); },[]);
  useEffect(()=>{ if(session?.userId && data.utenti.some((u:any)=>u.id===session.userId)) setCurrentUserId(session.userId); },[session, data.utenti.length]);

  const currentUser = useMemo(()=> data.utenti.find((u:any)=>u.id===currentUserId),[data.utenti,currentUserId]);

  if(!session) return <LoginScreen data={data} setSession={setSession}/>;

  const nav = [
    { id: "dashboard", label:"Riepilogo", icon:<Home className="w-4 h-4" /> },
    { id: "utenti", label:"Utenti", icon:<Users className="w-4 h-4" /> },
    { id: "calendario", label:"Calendario", icon:<CalIcon className="w-4 h-4" /> },
    { id: "scadenze", label:"Scadenze", icon:<FolderClock className="w-4 h-4" /> },
    { id: "pasti", label:"Pasti & Dispensa", icon:<ChefHat className="w-4 h-4" /> },
    { id: "spesa", label:"Lista spesa / OCR", icon:<ShoppingCart className="w-4 h-4" /> },
    { id: "compiti", label:"Compiti & Paghette", icon:<ClipboardList className="w-4 h-4" /> },
    { id: "notifiche", label:"Promemoria", icon:<Bell className="w-4 h-4" /> },
    { id: "impostazioni", label:"Impostazioni", icon:<Settings className="w-4 h-4" /> },
  ] as const;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto px-3 md:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo />
            <div>
              <div className="font-semibold">FamilyHub</div>
              <div className="text-xs text-gray-500">{data.settings.famiglia}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-sm text-gray-600">Ciao, <b>{currentUser?.nome}</b> · <span className="text-xs">{currentUser?.ruolo}</span></div>
            <button className="px-2 py-1 rounded-lg bg-gray-100" title="Esci" onClick={()=>{ localStorage.removeItem(LS_SESSION); setSession(null); }}><LogOut className="w-4 h-4"/></button>
          </div>
        </div>
        <div className="bg-white border-t">
          <div className="max-w-6xl mx-auto px-3 md:px-6 flex gap-2 overflow-x-auto py-2">
            {nav.map(n=> (
              <button key={n.id} onClick={()=>setTab(n.id)} className={`flex items-center gap-1 px-3 py-2 rounded-xl text-sm whitespace-nowrap ${tab===n.id?"bg-black text-white":"bg-gray-100"}`}>
                {n.icon}{n.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-3 md:p-6">
        {tab==="dashboard"   && <Dashboard data={data} />}
        {tab==="utenti"      && <UsersTab data={data} setData={setData} />}
        {tab==="calendario"  && <CalendarTab data={data} setData={setData} />}
        {tab==="scadenze"    && <ScadenzeTab data={data} setData={setData} />}
        {tab==="pasti"       && <PastiTab data={data} setData={setData} />}
        {tab==="spesa"       && <SpesaTab data={data} setData={setData} />}
        {tab==="compiti"     && <CompitiTab data={data} setData={setData} utenti={data.utenti}/>}
        {tab==="notifiche"   && <NotificheTab data={data} setData={setData} />}
        {tab==="impostazioni"&& <ImpostazioniTab data={data} setData={setData} />}
      </main>
    </div>
  );
}

// ---------- Dashboard & Carousel
const PhotoCarousel: React.FC<{items:any[]; intervalMs?:number; pauseOnHover?:boolean}> = ({items=[], intervalMs=4000, pauseOnHover=true}) => {
  const containerRef = useRef<HTMLDivElement|null>(null);
  const [cw,setCw] = useState(0); const [offset,setOffset] = useState(0); const [paused,setPaused] = useState(false);
  useEffect(()=>{
    const el = containerRef.current; if(!el) return;
    const resize = ()=> setCw(el.clientWidth || 0); resize();
    const ro = new (window as any).ResizeObserver(resize); ro.observe(el); return ()=>ro.disconnect();
  },[]);
  useEffect(()=>{
    if(!items.length || cw===0) return; let raf:number; let last=0;
    const speed = cw/Math.max(0.2, intervalMs/1000); const total = cw*items.length;
    const step = (ts:number)=>{ if(!last) last=ts; const dt=(ts-last)/1000; last=ts; if(!paused) setOffset(p=>(p+speed*dt)%total); raf=requestAnimationFrame(step); };
    raf=requestAnimationFrame(step); return ()=>cancelAnimationFrame(raf);
  },[items,cw,intervalMs,paused]);
  if(!items.length) return null; const active = cw? Math.floor(offset/cw)%items.length : 0;
  return (
    <div ref={containerRef} className="relative w-full aspect-[16/9] bg-black/5 rounded-2xl overflow-hidden"
      onMouseEnter={()=>pauseOnHover&&setPaused(true)} onMouseLeave={()=>pauseOnHover&&setPaused(false)}>
      <div className="absolute inset-0 whitespace-nowrap" style={{transform:`translateX(-${offset}px)`}}>
        {[0,1].map(rep=> (
          <React.Fragment key={rep}>
            {items.map((it,i)=> (<img key={`${rep}-${it.id}`} src={it.url} alt={it.titolo||`foto-${i}`} className="inline-block h-full object-cover" style={{width:cw||1}}/>))}
          </React.Fragment>
        ))}
      </div>
      {items[active]?.titolo && <div className="absolute bottom-0 left-0 right-0 bg-black/40 text-white text-sm p-2">{items[active].titolo}</div>}
      <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
        {items.map((_,i)=> <span key={i} className={`w-2 h-2 rounded-full ${i===active?"bg-white":"bg-white/50"}`}/>)}
      </div>
    </div>
  );
};

const instancesForDate = (eventi:any[], date:Date) => {
  const day = ((date.getDay()+6)%7)+1; const ymd = fmtDate(date);
  return eventi.filter(ev=>{
    if(ev.data===ymd) return true;
    if(ev.ripeti?.freq==="WEEKLY" && (ev.ripeti.byDay||[]).includes(day)) return true;
    if(ev.ripeti?.freq==="MONTHLY"){
      const origDay = new Date(ev.data).getDate(); const lastDay = new Date(date.getFullYear(), date.getMonth()+1, 0).getDate();
      if(origDay===31 && date.getDate()===lastDay) return true;
      if(origDay!==31 && date.getDate()===origDay) return true;
      return false;
    }
    return false;
  });
};

const Dashboard: React.FC<{data:any}> = ({data}) => {
  const todayDate = new Date(); const dow = ((todayDate.getDay()+6)%7)+1;
  const eventiOggi = instancesForDate(data.eventi, todayDate);
  const prossimeScadenze = [...data.scadenze].sort((a:any,b:any)=>a.data.localeCompare(b.data)).filter((s:any)=> new Date(s.data) >= new Date(today())).slice(0,5);
  const photos = data.homePhotos||[]; const carousel = data.settings?.carousel || {enabled:true, intervalMs:4000};
  const menuOggi = data.menuSettimanale[dow] || { colazione:[], merenda:[], pranzo:{primo:[],secondo:[],contorno:[]}, cena:{primo:[],secondo:[],contorno:[]} };
  const resolveP = (id:string)=> data.piatti.find((p:any)=>p.id===id)?.nome || id;
  const reminderOggi = (data.schedules||[]).filter((s:any)=> s.attivo && (s.giorni||[]).includes(dow)).sort((a:any,b:any)=> (a.orario||"").localeCompare(b.orario)).slice(0,5);
  const spesa = data.listaSpesa.filter((i:any)=>!i.preso);

  return (
    <div className="space-y-6">
      {photos.length>0 && carousel.enabled && <Section title="Foto di famiglia" icon={<Home className="w-5 h-5" />}><PhotoCarousel items={photos} intervalMs={carousel.intervalMs||4000}/></Section>}
      <div className="grid md:grid-cols-4 gap-4">
        <StatCard title="Utenti" value={data.utenti.length} />
        <StatCard title="Eventi oggi" value={eventiOggi.length} />
        <StatCard title="Promemoria oggi" value={reminderOggi.length} />
        <StatCard title="Articoli da comprare" value={spesa.length} />
      </div>
      <div className="grid xl:grid-cols-2 gap-4">
        <div className="space-y-4">
          <Section title={`Oggi · ${fmtDate(todayDate)}`} icon={<CalIcon className="w-5 h-5"/>}>
            {eventiOggi.length===0? <p className="text-gray-500">Nessun impegno oggi.</p> : (
              <ul className="space-y-2">
                {eventiOggi.map((ev:any)=>(
                  <li key={ev.id} className="flex items-center justify-between bg-gray-100 rounded-xl p-2">
                    <div><div className="font-medium">{ev.titolo}</div><div className="text-xs text-gray-600">{ev.ora||"All day"}</div></div>
                    <Pill>{ev.ripeti?.freq && ev.ripeti.freq!=="NONE" ? `Ripete ${ev.ripeti.freq}` : "Singolo"}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Promemoria di oggi" icon={<Bell className="w-5 h-5"/>}>
            {reminderOggi.length===0? <p className="text-gray-500">Nessun promemoria per oggi.</p> : (
              <ul className="space-y-2">
                {reminderOggi.map((r:any)=>(
                  <li key={r.id} className="bg-gray-100 rounded-xl p-2 flex items-center justify-between">
                    <div><div className="font-medium">{r.titolo}</div><div className="text-xs text-gray-600">{r.orario} · {(r.giorni||[]).map((d:number)=>dayShort[d-1]).join(", ")}</div></div>
                    <Pill>{r.attivo?"attivo":"pausa"}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        <div className="space-y-4">
          <Section title="Prossime scadenze" icon={<FolderClock className="w-5 h-5"/>}>
            {prossimeScadenze.length===0? <p className="text-gray-500">Nessuna scadenza.</p> : (
              <ul className="space-y-2">
                {prossimeScadenze.map((s:any)=>(
                  <li key={s.id} className="flex items-center justify-between bg-gray-100 rounded-xl p-2">
                    <div><div className="font-medium">{s.titolo}</div><div className="text-xs text-gray-600">{s.data}</div></div>
                    {s.note && <Pill>Note</Pill>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="A tavola oggi" icon={<ChefHat className="w-5 h-5"/>}>
            <div className="grid grid-cols-1 gap-3 text-sm">
              {["colazione","merenda"].map((k)=>(
                <div key={k}><div className="text-xs text-gray-600 mb-1">{k.toUpperCase()}</div>{menuOggi[k]?.length? <ul className="list-disc pl-5">{menuOggi[k].map((id:string,i:number)=><li key={i}>{resolveP(id)}</li>)}</ul> : <div className="text-gray-500">—</div>}</div>
              ))}
              {["pranzo","cena"].map((k)=>(
                <div key={k}>
                  <div className="text-xs text-gray-600 mb-1">{k.toUpperCase()}</div>
                  {["primo","secondo","contorno"].map((s)=> (
                    <div key={s}><div className="text-[11px] text-gray-500 uppercase mb-1">{s}</div>
                      <ul className="list-disc pl-4">{(menuOggi[k][s]||[]).map((id:string,i:number)=><li key={i}>{resolveP(id)}</li>)}</ul>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
};

// ---------- Calendar
const CalendarTab: React.FC<{data:any; setData:(u:any)=>void}> = ({data,setData})=>{
  const [titolo,setTitolo] = useState(""); const [dataStr,setDataStr] = useState(today()); const [ora,setOra] = useState("");
  const [freq,setFreq] = useState("NONE"); const [wk,setWk] = useState<number[]>([]);
  const toggleWk = (d:number)=> setWk(prev=> prev.includes(d)? prev.filter(x=>x!==d) : [...prev,d]);
  return (
    <Section title="Calendario condiviso" icon={<CalIcon className="w-5 h-5"/>}>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <input className="border rounded-lg px-2 py-1 w-full" placeholder="Titolo" value={titolo} onChange={e=>setTitolo(e.target.value)} />
          <input type="date" className="border rounded-lg px-2 py-1 w-full" value={dataStr} onChange={e=>setDataStr(e.target.value)} />
          <input type="time" className="border rounded-lg px-2 py-1 w-full" value={ora} onChange={e=>setOra(e.target.value)} />
          <select className="border rounded-lg px-2 py-1 w-full" value={freq} onChange={e=>setFreq(e.target.value)}>
            <option value="NONE">Nessuna ripetizione</option>
            <option value="WEEKLY">Settimanale</option>
            <option value="MONTHLY">Mensile (31 → ultimo giorno del mese)</option>
          </select>
          {freq==="WEEKLY" && (
            <div className="flex flex-wrap gap-2 text-sm">
              {giorni.map(d=>(<button key={d} onClick={()=>toggleWk(d)} className={`px-2 py-1 rounded-lg ${wk.includes(d)?"bg-black text-white":"bg-gray-100"}`}>{dayShort[d-1]}</button>))}
            </div>
          )}
          <button className="px-3 py-2 rounded-xl bg-black text-white w-full" onClick={()=>{
            if(!titolo.trim()) return;
            const ev = { id:uid("ev"), titolo, data:dataStr, ora, ripeti:{freq, byDay:wk} };
            setData((prev:any)=> ({...prev, eventi:[...prev.eventi, ev]}));
            setTitolo(""); setOra(""); setFreq("NONE"); setWk([]);
          }}>Aggiungi evento</button>
        </div>
        <div className="md:col-span-2"><CalendarView events={data.eventi} onDelete={(id:string)=> setData((prev:any)=> ({...prev, eventi: prev.eventi.filter((e:any)=>e.id!==id)}))}/></div>
      </div>
    </Section>
  );
};

const CalendarView: React.FC<{events:any[]; onDelete:(id:string)=>void}> = ({events,onDelete})=>{
  const [weekStart,setWeekStart] = useState(new Date());
  const fromMonday = new Date(weekStart); fromMonday.setDate(weekStart.getDate() - ((weekStart.getDay()+6)%7));
  const days = [...Array(7)].map((_,i)=> new Date(fromMonday.getFullYear(), fromMonday.getMonth(), fromMonday.getDate()+i));
  const go = (delta:number)=>{ const d=new Date(fromMonday); d.setDate(d.getDate()+delta*7); setWeekStart(d); };
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="font-medium">Settimana {fmtDM(days[0])} → {fmtDM(days[6])}</div>
        <div className="flex gap-2"><button className="px-3 py-2 rounded-lg bg-gray-100" onClick={()=>go(-1)}>← Indietro</button><button className="px-3 py-2 rounded-lg bg-gray-100" onClick={()=>go(1)}>Avanti →</button></div>
      </div>
      <div className="grid md:grid-cols-7 gap-2">
        {days.map((d,col)=>{
          const items = instancesForDate(events,d).sort((a:any,b:any)=> (a.ora||"").localeCompare(b.ora||""));
          return (
            <div key={col} className="bg-gray-50 rounded-xl p-2">
              <div className="font-semibold text-sm mb-2">{dayFull[((d.getDay()+6)%7)]} · {fmtDM(d)}</div>
              {items.length===0? <div className="text-xs text-gray-500">—</div> : (
                <ul className="space-y-1">
                  {items.map((ev:any)=>(
                    <li key={ev.id} className="bg-white border rounded-lg px-2 py-1 text-sm flex items-center justify-between">
                      <div><div className="font-medium">{ev.titolo}</div><div className="text-xs text-gray-500">{ev.ora||"All day"}</div></div>
                      <button className="p-1 rounded hover:bg-gray-100" onClick={()=>onDelete(ev.id)} title="Elimina"><Trash2 className="w-4 h-4"/></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------- Supabase
async function supaPull(conf:{url:string; anonKey:string; table?:string; recordId?:string}){
  const {url, anonKey, table="kv", recordId="default"} = conf||{} as any;
  if(!url || !anonKey) throw new Error("Config Supabase mancante");
  const r = await fetch(`${url}/rest/v1/${table}?id=eq.${encodeURIComponent(recordId)}&select=payload,updated_at`, { headers:{ apikey:anonKey, Authorization:`Bearer ${anonKey}` } });
  if(!r.ok) throw new Error(`Pull fallito ${r.status}`);
  const arr = await r.json(); return arr && arr[0] && arr[0].payload ? arr[0].payload : null;
}
async function supaPush(conf:{url:string; anonKey:string; table?:string; recordId?:string}, payload:any){
  const {url, anonKey, table="kv", recordId="default"} = conf||{} as any;
  if(!url || !anonKey) throw new Error("Config Supabase mancante");
  const r = await fetch(`${url}/rest/v1/${table}?on_conflict=id`, {
    method:"POST",
    headers:{ apikey:anonKey, Authorization:`Bearer ${anonKey}`, "Content-Type":"application/json", Prefer:"resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([{ id: recordId, payload }]),
  });
  if(!r.ok) throw new Error(`Push fallito ${r.status}`);
  return true;
}

const SupabaseSyncPanel: React.FC<{data:any; setData:(u:any)=>void}> = ({data,setData})=>{
  const cfg = data.settings?.supabase || {};
  const [url,setUrl] = useState(cfg.url||""); const [anonKey,setAnonKey] = useState(cfg.anonKey||"");
  const [table,setTable] = useState(cfg.table||"kv"); const [recordId,setRecordId] = useState(cfg.recordId||"default");
  const [msg,setMsg] = useState("");
  const saveCfg = (extra:any={})=> setData((prev:any)=> ({...prev, settings:{...prev.settings, supabase:{...prev.settings.supabase, enabled:true, url, anonKey, table, recordId, status:"ready", ...extra}}}));
  const test = async ()=>{
    setMsg("Test connessione...");
    try{ const p = await supaPull({url,anonKey,table,recordId}); setMsg(p? "Record remoto trovato – importabile" : "Record remoto vuoto – verrà creato al primo salvataggio"); saveCfg({status:"ready"}); }
    catch(e:any){ setMsg(e.message||"Errore connessione"); saveCfg({status:"errore"}); }
  };
  const pullNow = async ()=>{
    setMsg("Pull...");
    try{ const p = await supaPull({url,anonKey,table,recordId}); if(p){ setData(p); saveData(p); } setMsg(p? "Dati importati" : "Nessun dato remoto"); }
    catch(e:any){ setMsg(e.message||"Errore pull"); }
  };
  const pushNow = async ()=>{
    setMsg("Push...");
    try{ await supaPush({url,anonKey,table,recordId}, data); setMsg("Dati salvati su Supabase"); }
    catch(e:any){ setMsg(e.message||"Errore push"); }
  };
  return (
    <div className="bg-white rounded-xl border p-3 mt-4">
      <div className="font-medium mb-2">Supabase Sync</div>
      <div className="grid md:grid-cols-2 gap-2">
        <input className="border rounded-lg px-2 py-1 w-full" placeholder="Project URL" value={url} onChange={e=>setUrl(e.target.value)} />
        <input className="border rounded-lg px-2 py-1 w-full" placeholder="Anon public key" value={anonKey} onChange={e=>setAnonKey(e.target.value)} />
        <input className="border rounded-lg px-2 py-1 w-full" placeholder="Tabella" value={table} onChange={e=>setTable(e.target.value)} />
        <input className="border rounded-lg px-2 py-1 w-full" placeholder="Record ID" value={recordId} onChange={e=>setRecordId(e.target.value)} />
      </div>
      <div className="flex gap-2 mt-2">
        <button className="px-3 py-2 rounded-xl bg-gray-100" onClick={test}>Test & Salva</button>
        <button className="px-3 py-2 rounded-xl bg-gray-100" onClick={pullNow}>Sincronizza (Pull)</button>
        <button className="px-3 py-2 rounded-xl bg-black text-white" onClick={pushNow}>Salva ora (Push)</button>
      </div>
      {msg && <div className="text-xs text-gray-600 mt-2">{msg}</div>}
    </div>
  );
};

// ---------- Users
const ChangePasswordBanner: React.FC<{currentUser:any; setData:(u:any)=>void}> = ({currentUser,setData})=>{
  const [pw,setPw] = useState("");
  const save = async ()=>{
    if(!pw.trim()) return;
    if(currentUser.ruolo==="Bimbo" && !/^\d{4,6}$/.test(pw)) return alert("Per 'Bimbo' serve un PIN di 4–6 cifre");
    const salt = uid("s"); const pwHash = await sha256Hex(`${salt}:${pw}`);
    setData((prev:any)=> ({...prev, utenti: prev.utenti.map((u:any)=> u.id===currentUser.id? {...u, salt, pwHash, mustChange:false}: u)}));
    alert("Password aggiornata");
  };
  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-4">
      <div className="text-sm">È richiesto l'aggiornamento della password per <b>{currentUser.nome}</b></div>
      <div className="flex gap-2 mt-2">
        <input type="password" className="border rounded-lg px-2 py-1" placeholder="Nuova password/PIN" value={pw} onChange={e=>setPw(e.target.value)} />
        <button className="px-3 py-1 rounded-lg bg-black text-white" onClick={save}>Salva</button>
      </div>
    </div>
  );
};

const UsersTab: React.FC<{data:any; setData:(u:any)=>void}> = ({data,setData})=>{
  const [nome,setNome] = useState(""); const [ruolo,setRuolo] = useState("Adulto"); const [username,setUsername] = useState(""); const [password,setPassword] = useState("");
  const addUser = async ()=>{
    if(!nome.trim()) return;
    if(ruolo==="Bimbo" && !/^\d{4,6}$/.test(password)) return alert("Per 'Bimbo' serve un PIN numerico 4–6 cifre");
    const salt = password? uid("s"): null; const pwHash = password? await sha256Hex(`${salt}:${password}`): null;
    const u = { id: uid("u"), nome, ruolo, username: username || nome.toLowerCase().replace(/\s+/g,"."), salt, pwHash, mustChange:false };
    setData((prev:any)=> ({...prev, utenti:[...prev.utenti, u]})); setNome(""); setRuolo("Adulto"); setUsername(""); setPassword("");
  };
  const resetPw = async (id:string)=>{
    const tmp = String(Math.floor(1000 + Math.random()*900000)).slice(0,6);
    const salt = uid("s"); const pwHash = await sha256Hex(`${salt}:${tmp}`);
    setData((prev:any)=> ({...prev, utenti: prev.utenti.map((u:any)=> u.id===id? {...u, salt, pwHash, mustChange:true}: u)}));
    alert(`PIN temporaneo: ${tmp}`);
  };
  const updateCred = async (id:string, newUser?:string, newPw?:string)=>{
    if(!newUser && !newPw) return;
    const isBimbo = data.utenti.find((x:any)=>x.id===id)?.ruolo==="Bimbo";
    if(newPw && isBimbo && !/^\d{4,6}$/.test(newPw)) return alert("Per 'Bimbo' serve PIN 4–6 cifre");
    const patch:any = {}; if(newUser) patch.username = newUser;
    if(newPw){ const salt = uid("s"); const pwHash = await sha256Hex(`${salt}:${newPw}`); patch.salt=salt; patch.pwHash=pwHash; patch.mustChange=false; }
    setData((prev:any)=> ({...prev, utenti: prev.utenti.map((u:any)=> u.id===id? {...u, ...patch}: u)}));
  };
  return (
    <Section title="Gestione utenti e credenziali" icon={<Users className="w-5 h-5"/>}>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <input className="border rounded-lg px-2 py-1 w-full" placeholder="Nome" value={nome} onChange={e=>setNome(e.target.value)} />
          <select className="border rounded-lg px-2 py-1 w-full" value={ruolo} onChange={e=>setRuolo(e.target.value)}>
            {Object.keys(data.permessi).map((r:string)=>(<option key={r} value={r}>{r}</option>))}
          </select>
          <input className="border rounded-lg px-2 py-1 w-full" placeholder="Username (opzionale)" value={username} onChange={e=>setUsername(e.target.value)} />
          <input type="password" className="border rounded-lg px-2 py-1 w-full" placeholder="Password/PIN (opzionale)" value={password} onChange={e=>setPassword(e.target.value)} />
          <button className="px-3 py-2 rounded-xl bg-black text-white w-full" onClick={addUser}>Aggiungi utente</button>
        </div>
        <div className="space-y-2">
          {data.utenti.map((u:any)=> <UserRow key={u.id} u={u} onReset={()=>resetPw(u.id)} onUpdate={updateCred} />)}
        </div>
      </div>
    </Section>
  );
};

const UserRow: React.FC<{u:any; onReset:()=>void; onUpdate:(id:string,un?:string,pw?:string)=>void}> = ({u,onReset,onUpdate})=>{
  const [un,setUn] = useState(u.username||""); const [pw,setPw] = useState("");
  return (
    <div className="border rounded-xl p-2 flex items-center justify-between gap-2">
      <div>
        <div className="font-medium">{u.nome} · <span className="text-xs">{u.ruolo}</span></div>
        <div className="text-xs text-gray-600">username attuale: {u.username || "—"}</div>
        <div className="flex gap-2 mt-1">
          <input className="border rounded-lg px-2 py-1" placeholder="Nuovo username" value={un} onChange={e=>setUn(e.target.value)} />
          <input className="border rounded-lg px-2 py-1" placeholder={u.ruolo==="Bimbo"?"Nuovo PIN (4–6)":"Nuova password"} value={pw} onChange={e=>setPw(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2">
        <button className="px-3 py-2 rounded-lg bg-gray-100" onClick={onReset} title="Reset amministrativo"><KeyRound className="w-4 h-4"/></button>
        <button className="px-3 py-2 rounded-lg bg-black text-white" onClick={()=>onUpdate(u.id,un,pw)}>Salva credenziali</button>
      </div>
    </div>
  );
};

// ---------- Scadenze
const ScadenzeTab: React.FC<{data:any; setData:(u:any)=>void}> = ({data,setData})=>{
  const [titolo,setTitolo] = useState(""); const [dataStr,setDataStr] = useState(today()); const [note,setNote] = useState("");
  const add = ()=>{
    if(!titolo.trim()) return;
    setData((prev:any)=> ({...prev, scadenze:[...prev.scadenze, {id:uid("sc"), titolo, data:dataStr, note}]}));
    setTitolo(""); setNote("");
  };
  const del = (id:string)=> setData((prev:any)=> ({...prev, scadenze: prev.scadenze.filter((s:any)=>s.id!==id)}));
  return (
    <Section title="Scadenze" icon={<FolderClock className="w-5 h-5"/>}>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <input className="border rounded-lg px-2 py-1 w-full" placeholder="Titolo" value={titolo} onChange={e=>setTitolo(e.target.value)} />
          <input type="date" className="border rounded-lg px-2 py-1 w-full" value={dataStr} onChange={e=>setDataStr(e.target.value)} />
          <input className="border rounded-lg px-2 py-1 w-full" placeholder="Note (opzionale)" value={note} onChange={e=>setNote(e.target.value)} />
          <button className="px-3 py-2 rounded-xl bg-black text-white w-full" onClick={add}>Aggiungi</button>
        </div>
        <div>
          {data.scadenze.length===0? <div className="text-gray-500">Nessuna scadenza</div> : (
            <ul className="space-y-2">
              {data.scadenze.sort((a:any,b:any)=>a.data.localeCompare(b.data)).map((s:any)=>(
                <li key={s.id} className="bg-white rounded-xl border p-2 flex items-center justify-between">
                  <div><div className="font-medium">{s.titolo}</div><div className="text-xs text-gray-600">{s.data}</div></div>
                  <button className="p-1 rounded hover:bg-gray-100" onClick={()=>del(s.id)}><Trash2 className="w-4 h-4"/></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Section>
  );
};

// ---------- Pasti & Dispensa
const categorie = ["Primi","Secondi","Contorni","Dolci","Altro"];
const PastiTab: React.FC<{data:any; setData:(u:any)=>void}> = ({data,setData})=>{
  const [nome,setNome] = useState(""); const [categoria,setCategoria] = useState("Primi"); const [filtro,setFiltro] = useState("Tutte");
  const [giorno,setGiorno] = useState(1); const [pasto,setPasto] = useState("colazione"); const [sotto,setSotto] = useState("primo");
  const addPiatto = ()=>{
    if(!nome.trim()) return; const id = nome.toLowerCase().replace(/\s+/g,"-"); if(data.piatti.some((p:any)=>p.id===id)) return alert("Esiste già");
    setData((prev:any)=> ({...prev, piatti:[...prev.piatti, {id,nome,categoria,richiede:[]}]})); setNome("");
  };
  const elenco = data.piatti.filter((p:any)=> filtro==="Tutte" ? true : p.categoria===filtro);
  const addToMenu = (pid:string)=>{
    setData((prev:any)=>{
      const day = {...prev.menuSettimanale[giorno]};
      if(pasto==="colazione" || pasto==="merenda"){
        const arr = [...(day[pasto]||[])]; arr.push(pid);
        return {...prev, menuSettimanale:{...prev.menuSettimanale, [giorno]: {...day, [pasto]: arr}}};
      }else{
        const comp = {...(day[pasto]||{primo:[],secondo:[],contorno:[]})}; comp[sotto] = [...(comp[sotto]||[]), pid];
        return {...prev, menuSettimanale:{...prev.menuSettimanale, [giorno]: {...day, [pasto]: comp}}};
      }
    });
  };
  const removeFromMenu = (idx:number)=>{
    setData((prev:any)=>{
      const day = {...prev.menuSettimanale[giorno]};
      if(pasto==="colazione" || pasto==="merenda"){
        const arr = [...(day[pasto]||[])].filter((_:any,i:number)=>i!==idx);
        return {...prev, menuSettimanale:{...prev.menuSettimanale, [giorno]: {...day, [pasto]: arr}}};
      }else{
        const comp = {...(day[pasto]||{primo:[],secondo:[],contorno:[]})}; comp[sotto] = (comp[sotto]||[]).filter((_:any,i:number)=>i!==idx);
        return {...prev, menuSettimanale:{...prev.menuSettimanale, [giorno]: {...day, [pasto]: comp}}};
      }
    });
  };
  const listCorrente = (()=>{
    const day = data.menuSettimanale[giorno];
    if(pasto==="colazione" || pasto==="merenda") return day[pasto]||[];
    return (day[pasto] || {primo:[],secondo:[],contorno:[]})[sotto]||[];
  })();
  return (
    <Section title="Pasti & Dispensa" icon={<ChefHat className="w-5 h-5"/>}>
      <div className="grid xl:grid-cols-3 gap-4">
        <div className="space-y-2">
          <div className="font-medium">Piatti censiti</div>
          <div className="flex gap-2">
            <input className="border rounded-lg px-2 py-1 w-full" placeholder="Nome piatto" value={nome} onChange={e=>setNome(e.target.value)} />
            <select className="border rounded-lg px-2 py-1" value={categoria} onChange={e=>setCategoria(e.target.value)}>{categorie.map(c=><option key={c}>{c}</option>)}</select>
            <button className="px-3 py-2 rounded-lg bg-black text-white" onClick={addPiatto}><Plus className="w-4 h-4 inline"/> Aggiungi</button>
          </div>
          <div className="flex gap-2 text-sm">
            <span className="text-gray-500">Filtro:</span>
            <select className="border rounded-lg px-2 py-1" value={filtro} onChange={e=>setFiltro(e.target.value)}>
              <option>Tutte</option>{categorie.map(c=><option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-2 max-h-72 overflow-auto">
            {elenco.map((p:any)=> (
              <div key={p.id} className="border rounded-xl p-2">
                <div className="font-medium">{p.nome}</div>
                <div className="text-xs text-gray-600">{p.categoria}</div>
                <button className="mt-1 px-2 py-1 rounded bg-gray-100 text-xs" onClick={()=>addToMenu(p.id)}>Aggiungi al menu selezionato</button>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <div className="font-medium">Pianificazione settimanale</div>
          <div className="flex flex-wrap gap-2">{giorni.map(g=>(<button key={g} className={`px-2 py-1 rounded-lg ${g===giorno?"bg-black text-white":"bg-gray-100"}`} onClick={()=>setGiorno(g)}>{dayShort[g-1]}</button>))}</div>
          <div className="flex flex-wrap gap-2">{["colazione","merenda","pranzo","cena"].map(p=>(<button key={p} className={`px-2 py-1 rounded-lg ${p===pasto?"bg-black text-white":"bg-gray-100"}`} onClick={()=>setPasto(p)}>{p}</button>))}</div>
          {(pasto==="pranzo"||pasto==="cena") && <div className="flex flex-wrap gap-2">{["primo","secondo","contorno"].map(s=>(<button key={s} className={`px-2 py-1 rounded-lg ${s===sotto?"bg-black text-white":"bg-gray-100"}`} onClick={()=>setSotto(s)}>{s}</button>))}</div>}
          <div className="bg-white rounded-xl border p-2">
            <div className="text-sm text-gray-600 mb-1">Voci corrente</div>
            {listCorrente.length===0? <div className="text-sm text-gray-500">—</div> : (
              <ul className="space-y-1">
                {listCorrente.map((id:string,i:number)=>(
                  <li key={i} className="flex items-center justify-between bg-gray-50 rounded px-2 py-1">
                    <span>{data.piatti.find((p:any)=>p.id===id)?.nome || id}</span>
                    <button className="p-1 rounded hover:bg-gray-100" onClick={()=>removeFromMenu(i)} title="Rimuovi"><Trash2 className="w-4 h-4"/></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <DispensaPanel data={data} setData={setData}/>
      </div>
    </Section>
  );
};

const DispensaPanel: React.FC<{data:any; setData:(u:any)=>void}> = ({data,setData})=>{
  const [nome,setNome] = useState(""); const [qta,setQta] = useState<number>(1); const [unita,setUnita] = useState("pz");
  const add = ()=>{ if(!nome.trim()) return; setData((prev:any)=> ({...prev, dispensa:[...prev.dispensa, {id:uid("d"), nome, qta, unita}]})); setNome(""); setQta(1); };
  return (
    <div className="space-y-2">
      <div className="font-medium">Dispensa</div>
      <div className="flex gap-2">
        <input className="border rounded-lg px-2 py-1 w-full" placeholder="Nome" value={nome} onChange={e=>setNome(e.target.value)} />
        <input type="number" className="border rounded-lg px-2 py-1 w-24" value={qta} onChange={e=>setQta(parseInt(e.target.value||"1"))} />
        <select className="border rounded-lg px-2 py-1" value={unita} onChange={e=>setUnita(e.target.value)}>{["pz","g","kg","ml","l"].map(u=><option key={u}>{u}</option>)}</select>
        <button className="px-3 py-2 rounded-lg bg-black text-white" onClick={add}><Plus className="w-4 h-4 inline"/> Aggiungi</button>
      </div>
      <ul className="space-y-1 max-h-64 overflow-auto">
        {data.dispensa.map((i:any)=>(
          <li key={i.id} className="bg-white border rounded-lg px-2 py-1 flex items-center justify-between">
            <span>{i.nome} · {i.qta}{i.unita}</span>
            <button className="p-1 rounded hover:bg-gray-100" onClick={()=>setData((prev:any)=> ({...prev, dispensa: prev.dispensa.filter((x:any)=>x.id!==i.id)}))}><Trash2 className="w-4 h-4"/></button>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ---------- Spesa
const SpesaTab: React.FC<{data:any; setData:(u:any)=>void}> = ({data,setData})=>{
  const [nome,setNome] = useState(""); const [qta,setQta] = useState<number>(1); const [unita,setUnita] = useState("pz");
  const add = ()=>{ if(!nome.trim()) return; setData((prev:any)=> ({...prev, listaSpesa:[...prev.listaSpesa, {id:uid("i"), nome, qta, unita, preso:false}]})); setNome(""); setQta(1); };
  const toggle = (id:string)=> setData((prev:any)=> ({...prev, listaSpesa: prev.listaSpesa.map((i:any)=> i.id===id? {...i, preso:!i.preso}: i)}));
  return (
    <Section title="Lista spesa / OCR" icon={<ShoppingCart className="w-5 h-5"/>}>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="flex gap-2">
            <input className="border rounded-lg px-2 py-1 w-full" placeholder="Articolo" value={nome} onChange={e=>setNome(e.target.value)} />
            <input type="number" className="border rounded-lg px-2 py-1 w-24" value={qta} onChange={e=>setQta(parseInt(e.target.value||"1"))} />
            <select className="border rounded-lg px-2 py-1" value={unita} onChange={e=>setUnita(e.target.value)}>{["pz","g","kg","ml","l"].map(u=><option key={u}>{u}</option>)}</select>
            <button className="px-3 py-2 rounded-lg bg-black text-white" onClick={add}><Plus className="w-4 h-4 inline"/> Aggiungi</button>
          </div>
          <p className="text-xs text-gray-500">Suggerimento OCR: incolla testo tipo "Latte x2".</p>
        </div>
        <div>
          {data.listaSpesa.length===0? <div className="text-gray-500">Lista vuota</div> : (
            <ul className="space-y-1">
              {data.listaSpesa.map((i:any)=>(
                <li key={i.id} className="bg-white border rounded-lg px-2 py-1 flex items-center justify-between">
                  <div className={i.preso?"line-through text-gray-400":""}>{i.nome} · {i.qta}{i.unita}</div>
                  <div className="flex gap-2">
                    <button className="px-2 py-1 rounded bg-gray-100 text-xs" onClick={()=>toggle(i.id)}>{i.preso?"Ripristina":"Preso"}</button>
                    <button className="p-1 rounded hover:bg-gray-100" onClick={()=>setData((prev:any)=> ({...prev, listaSpesa: prev.listaSpesa.filter((x:any)=>x.id!==i.id)}))}><Trash2 className="w-4 h-4"/></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Section>
  );
};

// ---------- Compiti & Paghette
const CompitiTab: React.FC<{data:any; setData:(u:any)=>void; utenti:any[]}> = ({data,setData,utenti})=>{
  const [titolo,setTitolo] = useState(""); const [assegnatoA,setAssegnatoA] = useState<string>(utenti[0]?.id||""); const [valore,setValore] = useState<number>(1); const [dataStr,setDataStr] = useState(today());
  const add = ()=>{ if(!titolo.trim()) return; setData((prev:any)=> ({...prev, compiti:[...prev.compiti, {id:uid("c"), titolo, assegnatoA, data:dataStr, ricorrente:false, valore}]})); setTitolo(""); };
  const segnaFatto = (id:string)=> setData((prev:any)=> ({...prev, compiti: prev.compiti.map((c:any)=> c.id===id? {...c, fatto:true}: c)}));
  const [userSaldo,setUserSaldo] = useState<string>(utenti[0]?.id||""); const [pag,setPag] = useState<number>(0);
  const paga = ()=> setData((prev:any)=> ({...prev, pagamenti:[...prev.pagamenti, {id:uid("pay"), userId:userSaldo, importo:pag, data:today()}]}));
  return (
    <Section title="Compiti & Paghette" icon={<ClipboardList className="w-5 h-5"/>}>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="font-medium">Compiti</div>
          <input className="border rounded-lg px-2 py-1 w-full" placeholder="Titolo" value={titolo} onChange={e=>setTitolo(e.target.value)} />
          <div className="flex gap-2">
            <select className="border rounded-lg px-2 py-1" value={assegnatoA} onChange={e=>setAssegnatoA(e.target.value)}>{utenti.map((u:any)=><option key={u.id} value={u.id}>{u.nome}</option>)}</select>
            <input type="date" className="border rounded-lg px-2 py-1" value={dataStr} onChange={e=>setDataStr(e.target.value)} />
            <input type="number" className="border rounded-lg px-2 py-1 w-24" value={valore} onChange={e=>setValore(parseInt(e.target.value||"0"))} />
            <button className="px-3 py-2 rounded-lg bg-black text-white" onClick={add}><Plus className="w-4 h-4 inline"/> Aggiungi</button>
          </div>
          <ul className="space-y-1">
            {data.compiti.map((c:any)=>(
              <li key={c.id} className="bg-white border rounded-lg px-2 py-1 flex items-center justify-between">
                <div><div className="font-medium">{c.titolo}</div><div className="text-xs text-gray-600">{utenti.find((u:any)=>u.id===c.assegnatoA)?.nome || "—"} · {c.data} · +{c.valore}{data.settings.valuta}</div></div>
                <button className="px-2 py-1 rounded bg-gray-100 text-xs" onClick={()=>segnaFatto(c.id)}>{c.fatto?"Fatto":"Segna fatto"}</button>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-2">
          <div className="font-medium">Paghette</div>
          <div className="flex gap-2 items-center">
            <select className="border rounded-lg px-2 py-1" value={userSaldo} onChange={e=>setUserSaldo(e.target.value)}>{utenti.map((u:any)=><option key={u.id} value={u.id}>{u.nome}</option>)}</select>
            <input type="number" className="border rounded-lg px-2 py-1 w-24" value={pag} onChange={e=>setPag(parseFloat(e.target.value||"0"))} />
            <button className="px-3 py-2 rounded-lg bg-black text-white" onClick={paga}>Registra pagamento</button>
          </div>
          <ul className="space-y-1 max-h-64 overflow-auto">
            {data.pagamenti.map((p:any)=>(
              <li key={p.id} className="bg-white border rounded-lg px-2 py-1 flex items-center justify-between">
                <div>{utenti.find((u:any)=>u.id===p.userId)?.nome || "—"} · {p.importo}{data.settings.valuta}</div>
                <div className="text-xs text-gray-500">{p.data}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
};

// ---------- Notifiche
const NotificheTab: React.FC<{data:any; setData:(u:any)=>void}> = ({data,setData})=>{
  const [titolo,setTitolo] = useState(""); const [messaggio,setMessaggio] = useState(""); const [orario,setOrario] = useState("20:00"); const [giorniSel,setGiorniSel] = useState<number[]>([]);
  const toggleG = (g:number)=> setGiorniSel(prev=> prev.includes(g)? prev.filter(x=>x!==g) : [...prev,g]);
  const add = ()=>{ if(!titolo.trim()) return; setData((prev:any)=> ({...prev, schedules:[...prev.schedules, {id:uid("sch"), titolo, messaggio, orario, giorni:giorniSel, attivo:true}]})); setTitolo(""); setMessaggio(""); setGiorniSel([]); };
  const tog = (id:string)=> setData((prev:any)=> ({...prev, schedules: prev.schedules.map((s:any)=> s.id===id? {...s, attivo:!s.attivo}: s)}));
  const del = (id:string)=> setData((prev:any)=> ({...prev, schedules: prev.schedules.filter((s:any)=> s.id!==id)}));
  return (
    <Section title="Promemoria" icon={<Bell className="w-5 h-5"/>}>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <input className="border rounded-lg px-2 py-1 w-full" placeholder="Titolo" value={titolo} onChange={e=>setTitolo(e.target.value)} />
          <input className="border rounded-lg px-2 py-1 w-full" placeholder="Messaggio (opzionale)" value={messaggio} onChange={e=>setMessaggio(e.target.value)} />
          <input type="time" className="border rounded-lg px-2 py-1 w-full" value={orario} onChange={e=>setOrario(e.target.value)} />
          <div className="flex flex-wrap gap-2">{giorni.map(g=>(<button key={g} className={`px-2 py-1 rounded-lg ${giorniSel.includes(g)?"bg-black text-white":"bg-gray-100"}`} onClick={()=>toggleG(g)}>{dayShort[g-1]}</button>))}</div>
          <button className="px-3 py-2 rounded-xl bg-black text-white w-full" onClick={add}>Programma promemoria</button>
        </div>
        <div>
          <div className="text-sm text-gray-600 mb-1">Promemoria attivi</div>
          <ul className="space-y-1">
            {data.schedules.map((s:any)=>(
              <li key={s.id} className="bg-white border rounded-lg px-2 py-1 flex items-center justify-between">
                <div><div className="font-medium">{s.titolo}</div><div className="text-xs text-gray-500">{s.orario} · {(s.giorni||[]).map((d:number)=>dayShort[d-1]).join(", ")}</div></div>
                <div className="flex gap-2">
                  <button className="px-2 py-1 rounded bg-gray-100 text-xs" onClick={()=>tog(s.id)}>{s.attivo?"Pausa":"Attiva"}</button>
                  <button className="p-1 rounded hover:bg-gray-100" onClick={()=>del(s.id)} title="Rimuovi"><Trash2 className="w-4 h-4"/></button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
};

// ---------- Impostazioni + Backup + Supabase panel
const BackupPanel: React.FC<{data:any; setData:(u:any)=>void}> = ({data,setData})=>{
  const exportJson = ()=>{
    const blob = new Blob([JSON.stringify(data,null,2)], {type:"application/json"}); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `familyhub-backup-${Date.now()}.json`; a.click(); URL.revokeObjectURL(url);
  };
  const importJson = (e: React.ChangeEvent<HTMLInputElement>)=>{
    const file = (e.target as any).files?.[0]; if(!file) return;
    const fr = new FileReader(); fr.onload = ()=>{ try{ const obj = JSON.parse(String(fr.result)); setData(obj); saveData(obj); alert("Backup importato"); } catch{ alert("File non valido"); }}; fr.readAsText(file);
  };
  return (
    <div className="bg-white rounded-xl border p-3">
      <div className="font-medium mb-2">Backup & Ripristino</div>
      <div className="flex gap-2">
        <button className="px-3 py-2 rounded-xl bg-black text-white" onClick={exportJson}>Esporta JSON</button>
        <label className="px-3 py-2 rounded-xl bg-gray-100 cursor-pointer">Importa JSON<input type="file" accept="application/json" className="hidden" onChange={importJson} /></label>
      </div>
    </div>
  );
};

const ImpostazioniTab: React.FC<{data:any; setData:(u:any)=>void}> = ({data,setData})=>{
  const [famiglia,setFamiglia] = useState(data.settings.famiglia||""); const [whats,setWhats] = useState(data.settings.numeroWhatsApp||"");
  const [enabledCarousel,setEnabledCarousel] = useState(!!data.settings.carousel?.enabled); const [interval,setInterval] = useState<number>(data.settings.carousel?.intervalMs||4000);
  const save = ()=> setData((prev:any)=> ({...prev, settings:{...prev.settings, famiglia, numeroWhatsApp:whats, carousel:{enabled:enabledCarousel, intervalMs: interval}}}));
  return (
    <Section title="Impostazioni" icon={<Settings className="w-5 h-5"/>}>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <input className="border rounded-lg px-2 py-1 w-full" placeholder="Nome famiglia" value={famiglia} onChange={e=>setFamiglia(e.target.value)} />
          <input className="border rounded-lg px-2 py-1 w-full" placeholder="Numero WhatsApp" value={whats} onChange={e=>setWhats(e.target.value)} />
          <div className="flex items-center gap-2"><input id="caro" type="checkbox" checked={enabledCarousel} onChange={e=>setEnabledCarousel(e.target.checked)} /><label htmlFor="caro" className="text-sm">Carosello foto attivo</label></div>
          <div className="flex items-center gap-2"><span className="text-sm text-gray-600">Intervallo (ms)</span><input type="number" className="border rounded-lg px-2 py-1 w-32" value={interval} onChange={e=>setInterval(parseInt(e.target.value||"4000"))} /></div>
          <button className="px-3 py-2 rounded-xl bg-black text-white" onClick={save}>Salva impostazioni</button>
          <SupabaseSyncPanel data={data} setData={setData}/>
        </div>
        <div><BackupPanel data={data} setData={setData}/></div>
      </div>
    </Section>
  );
};
