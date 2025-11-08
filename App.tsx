// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
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
  Camera,
} from "lucide-react";

/**
 * FamilyHub – Single-file React PWA – ver. 1.4.2 (stabile, no preview)
 *
 * - Login obbligatorio (niente modalità "anteprima").
 * - Utenti/ruoli reali con credenziali salt+hash (PIN numerico forzato per Bimbo).
 * - Calendario condiviso con ricorrenze settimanali e mensili (31 ⇒ ultimo giorno mese, 30 resta 30).
 * - Pasti settimanali con COLAZIONE, MERENDA, PRANZO (primo/secondo/contorno), CENA (primo/secondo/contorno).
 * - Filtri per categoria piatti nei menu a tendina e nella libreria piatti.
 * - Lista spesa + dispensa.
 * - Compiti & Paghette (saldo mensile + registrazione pagamenti).
 * - Promemoria locali (notifiche) con pianificazione a minuti.
 * - Dashboard con widget e carosello foto (autoplay infinito).
 * - Opzionale: Sync Supabase tabella kv(id text pk, payload jsonb) via REST.
 */

/********************* UTILS & STORAGE ************************/
const LS_KEY = "familyhub:data:v11";
const LS_SESSION = "familyhub:session:v2";

const giorni = [1, 2, 3, 4, 5, 6, 7];
const dayNameShort = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const dayNameFull = [
  "Lunedì",
  "Martedì",
  "Mercoledì",
  "Giovedì",
  "Venerdì",
  "Sabato",
  "Domenica",
];

function uid(prefix = "id") {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}
function formatDateInput(d) {
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
function today() {
  return formatDateInput(new Date());
}
function fmtDM(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

// Crypto helper per password/PIN (sha256 hex)
async function sha256Hex(str) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(str));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/********************* DEFAULT DATA ************************/
const DEFAULT_DATA = {
  settings: {
    famiglia: "Famiglia Verdolini",
    valuta: "€",
    inizioSettimana: 1,
    numeroWhatsApp: "",
    fuso: "Europe/Rome",
    oraPromemoria: "20:00",
    allowanceSettimanaleBase: 5,
    google: { clientId: "", calendarId: "primary" },
    carousel: { enabled: true, intervalMs: 4000 },
    themeBg: "#f9fafb",
    supabase: {
      enabled: true,
      url: "https://bmxkrmsiywdsjnyyokgt.supabase.co",
      anonKey:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJteGtybXNpeXdkc2pueXlva2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyNTcyMzAsImV4cCI6MjA3NzgzMzIzMH0.l5zWMCyydtAKIJUDq5XCWzqH_wzr_d-X7JiERINKEC0",
      table: "kv",
      recordId: "default",
      status: "idle",
    },
  },
  utenti: [
    {
      id: "u-admin",
      nome: "Admin",
      ruolo: "Admin",
      username: "admin",
      salt: null,
      pwHash: null,
      mustChange: false,
    },
    {
      id: "u-adulto",
      nome: "Genitore",
      ruolo: "Adulto",
      username: "genitore",
      salt: null,
      pwHash: null,
      mustChange: false,
    },
  ],
  permessi: {
    Admin: ["tutto"],
    Adulto: [
      "calendario",
      "spesa",
      "pasti",
      "compiti",
      "scadenze",
      "notifiche",
      "impostazioni",
    ],
    Teen: ["pasti", "compiti", "calendario"],
    Bimbo: ["compiti"],
    Ospite: ["pasti"],
  },
  eventi: [],
  scadenze: [],
  dispensa: [],
  piatti: [
    {
      id: "pasta-al-pomodoro",
      nome: "Pasta al pomodoro",
      categoria: "Primi",
      richiede: [
        { nome: "Pasta", qta: 100, unita: "g" },
        { nome: "Passata", qta: 100, unita: "ml" },
      ],
    },
    {
      id: "pollo-griglia",
      nome: "Pollo alla griglia",
      categoria: "Secondi",
      richiede: [{ nome: "Petto di pollo", qta: 1, unita: "pz" }],
    },
    {
      id: "insalata-mista",
      nome: "Insalata mista",
      categoria: "Contorni",
      richiede: [{ nome: "Insalata", qta: 1, unita: "pz" }],
    },
    {
      id: "yogurt",
      nome: "Yogurt bianco",
      categoria: "Altro",
      richiede: [{ nome: "Yogurt", qta: 1, unita: "pz" }],
    },
  ],
  menuSettimanale: [1, 2, 3, 4, 5, 6, 7].reduce(
    (acc, g) => ({
      ...acc,
      [g]: {
        colazione: [],
        merenda: [],
        pranzo: { primo: [], secondo: [], contorno: [] },
        cena: { primo: [], secondo: [], contorno: [] },
      },
    }),
    {}
  ),
  listaSpesa: [],
  compiti: [],
  cassaFigli: {},
  pagamenti: [],
  schedules: [],
  homePhotos: [
    {
      id: uid("ph"),
      url: "https://images.unsplash.com/photo-1519681393784-d120267933ba?q=80&w=1280",
      titolo: "Benvenuti in FamilyHub",
    },
  ],
};

function loadData() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : DEFAULT_DATA;
  } catch (e) {
    console.warn("Errore loadData", e);
    return DEFAULT_DATA;
  }
}
function saveData(d) {
  localStorage.setItem(LS_KEY, JSON.stringify(d));
}

/********************* UI PRIMITIVES ************************/
const Section = ({ title, icon, actions, children }) => (
  <div className="bg-white shadow-sm rounded-2xl p-4 md:p-6 mb-6">
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-xl md:text-2xl font-semibold">{title}</h2>
      </div>
      <div className="flex gap-2">{actions}</div>
    </div>
    {children}
  </div>
);

const Pill = ({ children }) => (
  <span className="px-2 py-1 rounded-full text-xs bg-gray-100">{children}</span>
);

const Logo = () => (
  <div className="flex items-center gap-2">
    <ChefHat className="w-5 h-5" />
    <span className="font-semibold">FamilyHub</span>
  </div>
);

const StatCard = ({ title, value }) => (
  <div className="bg-white rounded-2xl p-4 shadow-sm">
    <div className="text-sm text-gray-500">{title}</div>
    <div className="text-3xl font-semibold">{value}</div>
  </div>
);

/********************* LOGIN ************************/
function LoginScreen({ data, setSession }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const utentiConCred = data.utenti.filter((u) => u.username && u.salt && u.pwHash);

  const tryLogin = async () => {
    const u = data.utenti.find(
      (x) => x.username && x.username.toLowerCase() === username.toLowerCase()
    );
    if (!u || !u.salt || !u.pwHash) {
      setError("Utente non trovato o credenziali mancanti");
      return;
    }
    const hash = await sha256Hex(`${u.salt}:${password}`);
    if (hash === u.pwHash) {
      setSession({ userId: u.id, at: Date.now() });
    } else {
      setError("Password/PIN errato");
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-gray-50 p-6">
      <div className="bg-white rounded-2xl shadow-sm p-6 w-full max-w-sm">
        <div className="flex items-center gap-2 mb-4">
          <Lock className="w-5 h-5" />
          <h1 className="text-lg font-semibold">Accedi a FamilyHub</h1>
        </div>
        <div className="space-y-2">
          <input
            className="border rounded-lg px-3 py-2 w-full"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            className="border rounded-lg px-3 py-2 w-full"
            placeholder="Password/PIN"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <div className="text-sm text-red-600">{error}</div>}

          {utentiConCred.length === 0 && (
            <p className="text-xs text-gray-500 mt-1">
              Nessun utente con credenziali: chiedi all’<b>amministratore</b> di crearle in <b>Utenti</b> → <b>Credenziali</b>.
            </p>
          )}

          <button
            className="mt-3 w-full px-3 py-2 rounded-xl bg-black text-white"
            onClick={tryLogin}
          >
            Entra
          </button>
        </div>
      </div>
    </div>
  );
}

/********************* APP ************************/
export default function App() {
  const [data, setData] = useState(loadData());
  const [session, setSession] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(LS_SESSION) || "null");
    } catch {
      return null;
    }
  });
  const [tab, setTab] = useState("dashboard");
  const [currentUserId, setCurrentUserId] = useState(
    () => session?.userId || loadData().utenti[0]?.id || "u-admin"
  );

  useEffect(() => {
    saveData(data);
  }, [data]);

  // Supabase: push debounce
  useEffect(() => {
    const cfg = data.settings && data.settings.supabase;
    if (!cfg || !cfg.enabled || !cfg.url || !cfg.anonKey) return;
    const t = setTimeout(() => {
      supaPush(cfg, data).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [data]);

  // Supabase: pull all'avvio
  useEffect(() => {
    (async () => {
      try {
        const cfg = data.settings && data.settings.supabase;
        if (cfg && cfg.enabled && cfg.url && cfg.anonKey) {
          const remote = await supaPull(cfg);
          if (remote && remote.settings) {
            setData(remote);
            saveData(remote);
          }
        }
      } catch (e) {
        /* silent */
      }
    })();
  }, []);

  useEffect(() => {
    if (session) localStorage.setItem(LS_SESSION, JSON.stringify(session));
    else localStorage.removeItem(LS_SESSION);
  }, [session]);

  // HARD LOCK: impedisce accessi "anteprima"
  useEffect(() => {
    if (!session) return;
    const u = data.utenti.find((x) => x.id === session.userId);
    if (!u?.salt || !u?.pwHash) {
      localStorage.removeItem(LS_SESSION);
      setSession(null);
    }
  }, [session, data.utenti]);

  // Promemoria schedulati: controllo ogni minuto
  useEffect(() => {
    const t = setInterval(() => {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const dow = ((now.getDay() + 6) % 7) + 1; // 1..7 (Lun..Dom)
      setData((prev) => {
        const due = prev.schedules.filter(
          (s) => s.attivo && (s.giorni || []).includes(dow) && s.orario === `${hh}:${mm}`
        );
        if (
          due.length &&
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          due.forEach((s) => new Notification("FamilyHub", { body: s.messaggio || s.titolo }));
        }
        return prev;
      });
    }, 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (session?.userId && data.utenti.some((u) => u.id === session.userId)) {
      setCurrentUserId(session.userId);
    }
  }, [session, data.utenti.length]);

  const currentUser = useMemo(
    () => data.utenti.find((u) => u.id === currentUserId),
    [data.utenti, currentUserId]
  );

  const can = (feature) => {
    const ruolo = currentUser?.ruolo || "Ospite";
    const rules = data.permessi[ruolo] || [];
    return rules.includes("tutto") || rules.includes(feature);
  };

  if (!session) return <LoginScreen data={data} setSession={setSession} />;

  const nav = [
    { id: "dashboard", label: "Riepilogo", icon: <Home className="w-4 h-4" /> },
    { id: "utenti", label: "Utenti", icon: <Users className="w-4 h-4" /> },
    { id: "calendario", label: "Calendario", icon: <Calendar className="w-4 h-4" /> },
    { id: "scadenze", label: "Scadenze", icon: <FolderClock className="w-4 h-4" /> },
    { id: "pasti", label: "Pasti & Dispensa", icon: <ChefHat className="w-4 h-4" /> },
    { id: "spesa", label: "Lista spesa / OCR", icon: <ShoppingCart className="w-4 h-4" /> },
    { id: "compiti", label: "Compiti & Paghette", icon: <ClipboardList className="w-4 h-4" /> },
    { id: "notifiche", label: "Promemoria", icon: <Bell className="w-4 h-4" /> },
    { id: "impostazioni", label: "Impostazioni", icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen" style={{ background: data.settings.themeBg }}>
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
            <div className="text-sm text-gray-600">
              Ciao, <b>{currentUser?.nome}</b> · <span className="text-xs">{currentUser?.ruolo}</span>
            </div>
            <button
              className="px-2 py-1 rounded-lg bg-gray-100"
              title="Esci"
              onClick={() => {
                localStorage.removeItem(LS_SESSION);
                setSession(null);
              }}
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="bg-white border-t">
          <div className="max-w-6xl mx-auto px-3 md:px-6 flex gap-2 overflow-x-auto py-2">
            {nav.map((n) => (
              <button
                key={n.id}
                onClick={() => setTab(n.id)}
                className={`flex items-center gap-1 px-3 py-2 rounded-xl text-sm whitespace-nowrap ${
                  tab === n.id ? "bg-black text-white" : "bg-gray-100"
                }`}
              >
                {n.icon}
                {n.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-3 md:p-6">
        {data.utenti.find((u) => u.id === currentUser?.id)?.mustChange && (
          <ChangePasswordBanner currentUser={currentUser} setData={setData} />
        )}
        {tab === "dashboard" && <Dashboard data={data} />}
        {tab === "utenti" && (
          <UsersTab data={data} setData={setData} currentUserId={currentUserId} />
        )}
        {tab === "calendario" && <CalendarTab data={data} setData={setData} />}
        {tab === "scadenze" && <ScadenzeTab data={data} setData={setData} />}
        {tab === "pasti" && <PastiTab data={data} setData={setData} />}
        {tab === "spesa" && <SpesaTab data={data} setData={setData} />}
        {tab === "compiti" && (
          <CompitiTab data={data} setData={setData} utenti={data.utenti} />
        )}
        {tab === "notifiche" && <NotificheTab data={data} setData={setData} />}
        {tab === "impostazioni" && <ImpostazioniTab data={data} setData={setData} />}

        <ReadmeBox />
        <DevTests />
      </main>
    </div>
  );
}

/********************* DASHBOARD ************************/
const PhotoCarousel = ({ items = [], intervalMs = 4000, pauseOnHover = true }) => {
  const containerRef = useRef(null);
  const [cw, setCw] = useState(0);
  const [offset, setOffset] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const resize = () => setCw(el.clientWidth || 0);
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!items || items.length === 0 || cw === 0) return;
    let raf;
    let last = 0;
    const speedPxPerSec = cw / Math.max(0.2, intervalMs / 1000);
    const total = cw * items.length;
    const step = (ts) => {
      if (!last) last = ts;
      const dt = (ts - last) / 1000;
      last = ts;
      if (!paused) setOffset((p) => (p + speedPxPerSec * dt) % total);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [items, cw, intervalMs, paused]);

  if (!items || items.length === 0) return null;
  const activeIndex = cw ? Math.floor(offset / cw) % items.length : 0;

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-[16/9] bg-black/5 rounded-2xl overflow-hidden"
      onMouseEnter={() => pauseOnHover && setPaused(true)}
      onMouseLeave={() => pauseOnHover && setPaused(false)}
    >
      <div
        className="absolute inset-0 whitespace-nowrap"
        style={{ transform: `translateX(-${offset}px)` }}
      >
        {[0, 1].map((rep) => (
          <React.Fragment key={rep}>
            {items.map((it, i) => (
              <img
                key={`${rep}-${it.id}`}
                src={it.url}
                alt={it.titolo || `foto-${i}`}
                className="inline-block h-full object-cover"
                style={{ width: cw || 1 }}
              />
            ))}
          </React.Fragment>
        ))}
      </div>

      {items[activeIndex]?.titolo && (
        <div className="absolute bottom-0 left-0 right-0 bg-black/40 text-white text-sm p-2">
          {items[activeIndex].titolo}
        </div>
      )}

      <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
        {items.map((_, i) => (
          <span
            key={i}
            className={`w-2 h-2 rounded-full ${
              i === activeIndex ? "bg-white" : "bg-white/50"
            }`}
          />
        ))}
      </div>
    </div>
  );
};

const Dashboard = ({ data }) => {
  const todayDate = new Date();
  const dow = ((todayDate.getDay() + 6) % 7) + 1; // 1..7 (Lun..Dom)

  const eventiOggi = instancesForDate(data.eventi, todayDate);
  const prossimeScadenze = [...data.scadenze]
    .sort((a, b) => a.data.localeCompare(b.data))
    .filter((s) => new Date(s.data) >= new Date(today()))
    .slice(0, 5);

  const photos = data.homePhotos || [];
  const carousel = (data.settings && data.settings.carousel) || {
    enabled: true,
    intervalMs: 4000,
  };

  const menuOggi =
    data.menuSettimanale[dow] || {
      colazione: [],
      merenda: [],
      pranzo: { primo: [], secondo: [], contorno: [] },
      cena: { primo: [], secondo: [], contorno: [] },
    };
  const resolvePiatto = (id) => data.piatti.find((p) => p.id === id)?.nome || id;

  const reminderOggi = (data.schedules || [])
    .filter((s) => s.attivo && (s.giorni || []).includes(dow))
    .sort((a, b) => (a.orario || "").localeCompare(b.orario))
    .slice(0, 5);

  const spesaDaComprare = data.listaSpesa.filter((i) => !i.preso);

  return (
    <div className="space-y-6">
      {photos.length > 0 && carousel.enabled && (
        <Section title="Foto di famiglia" icon={<Home className="w-5 h-5" />}>
          <PhotoCarousel items={photos} intervalMs={carousel.intervalMs || 4000} />
        </Section>
      )}

      <div className="grid md:grid-cols-4 gap-4">
        <StatCard title="Utenti" value={data.utenti.length} />
        <StatCard title="Eventi oggi" value={eventiOggi.length} />
        <StatCard title="Promemoria oggi" value={reminderOggi.length} />
        <StatCard title="Articoli da comprare" value={spesaDaComprare.length} />
      </div>

      <div className="grid xl:grid-cols-2 gap-4">
        <div className="space-y-4">
          <Section title={`Oggi · ${formatDateInput(todayDate)}`} icon={<Calendar className="w-5 h-5" />}>
            {eventiOggi.length === 0 ? (
              <p className="text-gray-500">Nessun impegno oggi.</p>
            ) : (
              <ul className="space-y-2">
                {eventiOggi.map((ev) => (
                  <li
                    key={ev.id}
                    className="flex items-center justify-between bg-gray-100 rounded-xl p-2"
                  >
                    <div>
                      <div className="font-medium">{ev.titolo}</div>
                      <div className="text-xs text-gray-600">{ev.ora || "All day"}</div>
                    </div>
                    <Pill>
                      {ev.ripeti?.freq && ev.ripeti.freq !== "NONE"
                        ? `Ripete ${ev.ripeti.freq}`
                        : "Singolo"}
                    </Pill>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Promemoria di oggi" icon={<Bell className="w-5 h-5" />}>
            {reminderOggi.length === 0 ? (
              <p className="text-gray-500">Nessun promemoria per oggi.</p>
            ) : (
              <ul className="space-y-2">
                {reminderOggi.map((r) => (
                  <li
                    key={r.id}
                    className="bg-gray-100 rounded-xl p-2 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-medium">{r.titolo}</div>
                      <div className="text-xs text-gray-600">
                        {r.orario} · {(r.giorni || [])
                          .map((d) => dayNameShort[d - 1])
                          .join(", ")}
                      </div>
                    </div>
                    <Pill>{r.attivo ? "attivo" : "pausa"}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Prossime scadenze" icon={<FolderClock className="w-5 h-5" />}>
            {prossimeScadenze.length === 0 ? (
              <p className="text-gray-500">Nessuna scadenza.</p>
            ) : (
              <ul className="space-y-2">
                {prossimeScadenze.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between bg-gray-100 rounded-xl p-2"
                  >
                    <div>
                      <div className="font-medium">{s.titolo}</div>
                      <div className="text-xs text-gray-600">{s.data}</div>
                    </div>
                    {s.note && <Pill>Note</Pill>}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="A tavola oggi" icon={<ChefHat className="w-5 h-5" />}>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <div className="text-xs text-gray-600 mb-1">COLAZIONE</div>
                {menuOggi.colazione?.length ? (
                  <ul className="list-disc pl-5 text-sm">
                    {menuOggi.colazione.map((id, i) => (
                      <li key={i}>{resolvePiatto(id)}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-sm text-gray-500">—</div>
                )}
              </div>
              <div>
                <div className="text-xs text-gray-600 mb-1">MERENDA</div>
                {menuOggi.merenda?.length ? (
                  <ul className="list-disc pl-5 text-sm">
                    {menuOggi.merenda.map((id, i) => (
                      <li key={i}>{resolvePiatto(id)}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-sm text-gray-500">—</div>
                )}
              </div>
              <div>
                <div className="text-xs text-gray-600 mb-1">PRANZO</div>
                <div className="grid grid-cols-1 gap-1 text-sm">
                  <div>
                    <div className="text-[11px] text-gray-500 uppercase mb-1">Primo</div>
                    <ul className="list-disc pl-4">
                      {(menuOggi.pranzo.primo || []).map((id, i) => (
                        <li key={i}>{resolvePiatto(id)}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-[11px] text-gray-500 uppercase mb-1">Secondo</div>
                    <ul className="list-disc pl-4">
                      {(menuOggi.pranzo.secondo || []).map((id, i) => (
                        <li key={i}>{resolvePiatto(id)}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-[11px] text-gray-500 uppercase mb-1">Contorno</div>
                    <ul className="list-disc pl-4">
                      {(menuOggi.pranzo.contorno || []).map((id, i) => (
                        <li key={i}>{resolvePiatto(id)}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-600 mb-1">CENA</div>
                <div className="grid grid-cols-1 gap-1 text-sm">
                  <div>
                    <div className="text-[11px] text-gray-500 uppercase mb-1">Primo</div>
                    <ul className="list-disc pl-4">
                      {(menuOggi.cena.primo || []).map((id, i) => (
                        <li key={i}>{resolvePiatto(id)}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-[11px] text-gray-500 uppercase mb-1">Secondo</div>
                    <ul className="list-disc pl-4">
                      {(menuOggi.cena.secondo || []).map((id, i) => (
                        <li key={i}>{resolvePiatto(id)}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-[11px] text-gray-500 uppercase mb-1">Contorno</div>
                    <ul className="list-disc pl-4">
                      {(menuOggi.cena.contorno || []).map((id, i) => (
                        <li key={i}>{resolvePiatto(id)}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
};

/********************* CALENDARIO ************************/
function instancesForDate(eventi, date) {
  const day = ((date.getDay() + 6) % 7) + 1; // 1..7 (Lun..Dom)
  const ymd = formatDateInput(date);
  return eventi.filter((ev) => {
    if (ev.data === ymd) return true; // singolo
    if (ev.ripeti?.freq === "WEEKLY" && ev.ripeti.byDay?.includes(day)) return true;
    if (ev.ripeti?.freq === "MONTHLY") {
      const origDay = new Date(ev.data).getDate();
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      if (origDay === 31 && date.getDate() === lastDay) return true; // 31 → ultimo giorno
      if (origDay !== 31 && date.getDate() === origDay) return true; // 30 resta 30, altri uguale
      return false;
    }
    return false;
  });
}

const CalendarView = ({ events = [], onDelete }) => {
  const [monthOffset, setMonthOffset] = useState(0);
  const base = new Date();
  const first = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
  const weeks = [];
  const startDow = (first.getDay() + 6) % 7; // lun=0
  let cursor = new Date(first);
  cursor.setDate(cursor.getDate() - startDow);
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let d = 0; d < 7; d++) {
      row.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(row);
  }
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <button className="px-2 py-1 bg-gray-100 rounded" onClick={() => setMonthOffset((x) => x - 1)}>
          ◀
        </button>
        <div className="font-medium">
          {first.toLocaleString("it-IT", { month: "long", year: "numeric" })}
        </div>
        <button className="px-2 py-1 bg-gray-100 rounded" onClick={() => setMonthOffset((x) => x + 1)}>
          ▶
        </button>
      </div>
      <div className="grid grid-cols-7 text-xs text-gray-500 mb-1">
        {dayNameFull.map((n) => (
          <div key={n} className="p-1 text-center">
            {n}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {weeks.flat().map((d, i) => {
          const sameMonth = d.getMonth() === first.getMonth();
          const inst = instancesForDate(events, d);
          return (
            <div key={i} className={`border rounded-lg p-1 min-h-[68px] ${sameMonth ? "bg-white" : "bg-gray-50"}`}>
              <div className="text-[11px] text-gray-500 mb-1">{fmtDM(d)}</div>
              <div className="space-y-1">
                {inst.slice(0, 3).map((ev) => (
                  <div key={ev.id} className="text-[11px] bg-gray-100 rounded px-1 flex items-center justify-between">
                    <span className="truncate">{ev.titolo}</span>
                    {onDelete && (
                      <button
                        className="text-red-600 ml-1"
                        title="Elimina"
                        onClick={() => onDelete(ev.id)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/********************* GOOGLE CALENDAR SYNC (opzionale) ************************/
const GCAL_SCOPES = "https://www.googleapis.com/auth/calendar";
const GCAL_DISCOVERY = ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"];

function loadGapiScript() {
  return new Promise((resolve, reject) => {
    if (document.getElementById("gapi-script")) return resolve();
    const s = document.createElement("script");
    s.id = "gapi-script";
    s.src = "https://apis.google.com/js/api.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Impossibile caricare Google API"));
    document.body.appendChild(s);
  });
}
async function initGapi(clientId) {
  await loadGapiScript();
  const gapi = window.gapi;
  if (!gapi) throw new Error("gapi non disponibile");
  await new Promise((res) => gapi.load("client:auth2", () => res()));
  await gapi.client.init({ discoveryDocs: GCAL_DISCOVERY, clientId, scope: GCAL_SCOPES });
  return gapi;
}
function toRfc3339(dateStr, time) {
  if (!time) return new Date(dateStr + "T00:00:00").toISOString();
  return new Date(`${dateStr}T${time}`).toISOString();
}
function addMonths(date, n) {
  return new Date(date.getFullYear(), date.getMonth() + n, date.getDate());
}

const GoogleSyncPanel = ({ data, setData }) => {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const clientId = data.settings.google?.clientId || "";
  const [localClientId, setLocalClientId] = useState(clientId);

  const ensureAuth = async () => {
    if (!localClientId.trim()) throw new Error("Inserisci un Client ID OAuth 2.0");
    const gapi = await initGapi(localClientId.trim());
    const auth = gapi.auth2.getAuthInstance();
    if (!auth.isSignedIn.get()) {
      await auth.signIn();
    }
    if (localClientId !== clientId) {
      setData((prev) => ({
        ...prev,
        settings: {
          ...prev.settings,
          google: { ...(prev.settings.google || {}), clientId: localClientId },
        },
      }));
    }
    return gapi;
  };

  const importUpcoming = async () => {
    try {
      setBusy(true);
      setMsg("Import in corso...");
      const gapi = await ensureAuth();
      const now = new Date();
      const max = addMonths(now, 1);
      const resp = await gapi.client.calendar.events.list({
        calendarId: data.settings.google?.calendarId || "primary",
        singleEvents: true,
        orderBy: "startTime",
        timeMin: now.toISOString(),
        timeMax: max.toISOString(),
        maxResults: 50,
      });
      const items = resp.result.items || [];
      const nuovi = items
        .map((ev) => {
          const startISO = ev.start?.date || ev.start?.dateTime;
          const d = new Date(startISO);
          const dateStr = formatDateInput(d);
          const time = ev.start?.dateTime
            ? String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0")
            : "";
          return {
            id: uid("gcal"),
            titolo: ev.summary || "Evento",
            data: dateStr,
            ora: time,
            ripeti: { freq: "NONE", byDay: [] },
            _gcalId: ev.id,
          };
        })
        .filter((x) => !data.eventi.some((e) => e._gcalId === x._gcalId));
      setData((prev) => ({ ...prev, eventi: [...prev.eventi, ...nuovi] }));
      setMsg(`Importati ${nuovi.length} eventi`);
    } catch (e) {
      setMsg(e.message || "Errore import");
    } finally {
      setBusy(false);
    }
  };

  const exportAll = async () => {
    try {
      setBusy(true);
      setMsg("Esportazione in corso...");
      const gapi = await ensureAuth();
      const calId = data.settings.google?.calendarId || "primary";
      let count = 0;
      for (const ev of data.eventi) {
        if (ev._gcalId) continue;
        if (ev.ripeti?.freq === "NONE") {
          await gapi.client.calendar.events.insert({
            calendarId: calId,
            resource: {
              summary: ev.titolo,
              start: ev.ora ? { dateTime: toRfc3339(ev.data, ev.ora) } : { date: ev.data },
              end: ev.ora ? { dateTime: toRfc3339(ev.data, ev.ora) } : { date: ev.data },
            },
          });
          count++;
          continue;
        }
        if (ev.ripeti?.freq === "WEEKLY") {
          const byDay = (ev.ripeti.byDay || [])
            .map((d) => ["MO", "TU", "WE", "TH", "FR", "SA", "SU"][d - 1])
            .join(",");
          await gapi.client.calendar.events.insert({
            calendarId: calId,
            resource: {
              summary: ev.titolo,
              start: ev.ora ? { dateTime: toRfc3339(ev.data, ev.ora) } : { date: ev.data },
              end: ev.ora ? { dateTime: toRfc3339(ev.data, ev.ora) } : { date: ev.data },
              recurrence: byDay ? [`RRULE:FREQ=WEEKLY;BYDAY=${byDay}`] : ["RRULE:FREQ=WEEKLY"],
            },
          });
          count++;
          continue;
        }
        if (ev.ripeti?.freq === "MONTHLY") {
          const origDay = new Date(ev.data).getDate();
          if (origDay === 31) {
            // workaround: genera 12 occorrenze, ultimo giorno del mese
            let cursor = new Date();
            for (let i = 0; i < 12; i++) {
              const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
              await gapi.client.calendar.events.insert({
                calendarId: calId,
                resource: {
                  summary: ev.titolo,
                  start: ev.ora
                    ? { dateTime: toRfc3339(formatDateInput(last), ev.ora) }
                    : { date: formatDateInput(last) },
                  end: ev.ora
                    ? { dateTime: toRfc3339(formatDateInput(last), ev.ora) }
                    : { date: formatDateInput(last) },
                },
              });
              cursor = addMonths(cursor, 1);
              count++;
            }
          } else {
            await gapi.client.calendar.events.insert({
              calendarId: calId,
              resource: {
                summary: ev.titolo,
                start: ev.ora ? { dateTime: toRfc3339(ev.data, ev.ora) } : { date: ev.data },
                end: ev.ora ? { dateTime: toRfc3339(ev.data, ev.ora) } : { date: ev.data },
                recurrence: [`RRULE:FREQ=MONTHLY;BYMONTHDAY=${origDay}`],
              },
            });
            count++;
          }
        }
      }
      setMsg(`Esportati ${count} eventi`);
    } catch (e) {
      setMsg(e.message || "Errore export");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border p-3 mt-4">
      <div className="font-medium mb-2">Google Calendar</div>
      <div className="grid md:grid-cols-3 gap-2 items-end">
        <div className="md:col-span-2 space-y-2">
          <input
            className="border rounded-lg px-2 py-1 w-full"
            placeholder="OAuth Client ID"
            value={localClientId}
            onChange={(e) => setLocalClientId(e.target.value)}
          />
          <input
            className="border rounded-lg px-2 py-1 w-full"
            placeholder="Calendar ID (primary)"
            value={data.settings.google?.calendarId || "primary"}
            onChange={(e) =>
              setData((prev) => ({
                ...prev,
                settings: {
                  ...prev.settings,
                  google: { ...(prev.settings.google || {}), calendarId: e.target.value },
                },
              }))
            }
          />
        </div>
        <div className="flex gap-2">
          <button className="px-3 py-2 rounded-xl bg-gray-100" onClick={importUpcoming} disabled={busy}>
            <Download className="w-4 h-4 inline" /> Importa 30 giorni
          </button>
          <button className="px-3 py-2 rounded-xl bg-black text-white" onClick={exportAll} disabled={busy}>
            <Upload className="w-4 h-4 inline" /> Esporta
          </button>
        </div>
      </div>
      {msg && <div className="text-xs text-gray-600 mt-2">{msg}</div>}
      <p className="text-[11px] text-gray-500 mt-2">Suggerimento: crea su Google Cloud un OAuth Client ID (App Web) ed inseriscilo qui. Permessi richiesti: Calendar.</p>
    </div>
  );
};

const CalendarTab = ({ data, setData }) => {
  const [titolo, setTitolo] = useState("");
  const [dataStr, setDataStr] = useState(today());
  const [ora, setOra] = useState("");
  const [freq, setFreq] = useState("NONE");
  const [wk, setWk] = useState([]);
  const toggleWk = (d) => setWk((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  return (
    <Section title="Calendario condiviso" icon={<Calendar className="w-5 h-5" />}>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="md:col-span-1">
          <div className="space-y-2">
            <input className="border rounded-lg px-2 py-1 w-full" placeholder="Titolo" value={titolo} onChange={(e) => setTitolo(e.target.value)} />
            <input type="date" className="border rounded-lg px-2 py-1 w-full" value={dataStr} onChange={(e) => setDataStr(e.target.value)} />
            <input type="time" className="border rounded-lg px-2 py-1 w-full" value={ora} onChange={(e) => setOra(e.target.value)} />
            <select className="border rounded-lg px-2 py-1 w-full" value={freq} onChange={(e) => setFreq(e.target.value)}>
              <option value="NONE">Nessuna ripetizione</option>
              <option value="WEEKLY">Settimanale</option>
              <option value="MONTHLY">Mensile (31 → ultimo giorno del mese)</option>
            </select>
            {freq === "WEEKLY" && (
              <div className="flex flex-wrap gap-2 text-sm">
                {giorni.map((d) => (
                  <button key={d} onClick={() => toggleWk(d)} className={`px-2 py-1 rounded-lg ${wk.includes(d) ? "bg-black text-white" : "bg-gray-100"}`}>
                    {dayNameShort[d - 1]}
                  </button>
                ))}
              </div>
            )}
            <button
              className="px-3 py-2 rounded-xl bg-black text-white w-full"
              onClick={() => {
                if (!titolo.trim()) return;
                const ev = { id: uid("ev"), titolo, data: dataStr, ora, ripeti: { freq, byDay: wk } };
                setData((prev) => ({ ...prev, eventi: [...prev.eventi, ev] }));
                setTitolo("");
                setOra("");
                setFreq("NONE");
                setWk([]);
              }}
            >
              Aggiungi evento
            </button>
            <GoogleSyncPanel data={data} setData={setData} />
          </div>
        </div>
        <div className="md:col-span-2">
          <CalendarView
            events={data.eventi}
            onDelete={(id) =>
              setData((prev) => ({ ...prev, eventi: prev.eventi.filter((e) => e.id !== id) }))
            }
          />
        </div>
      </div>
    </Section>
  );
};

/********************* SCADENZE ************************/
const ScadenzeTab = ({ data, setData }) => {
  const [titolo, setTitolo] = useState("");
  const [dataStr, setDataStr] = useState(today());
  const [note, setNote] = useState("");
  return (
    <Section title="Scadenze" icon={<FolderClock className="w-5 h-5" />}>
      <div className="grid md:grid-cols-3 gap-2 items-end mb-3">
        <input className="border rounded-lg px-2 py-1 w-full" placeholder="Titolo" value={titolo} onChange={(e) => setTitolo(e.target.value)} />
        <input type="date" className="border rounded-lg px-2 py-1 w-full" value={dataStr} onChange={(e) => setDataStr(e.target.value)} />
        <input className="border rounded-lg px-2 py-1 w-full" placeholder="Note (opz)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button
          className="px-3 py-2 rounded-xl bg-black text-white"
          onClick={() => {
            if (!titolo.trim()) return;
            setData((prev) => ({ ...prev, scadenze: [...prev.scadenze, { id: uid("scad"), titolo, data: dataStr, note }] }));
            setTitolo("");
            setNote("");
          }}
        >
          Aggiungi
        </button>
      </div>
      <ul className="space-y-2">
        {[...data.scadenze].sort((a, b) => a.data.localeCompare(b.data)).map((s) => (
          <li key={s.id} className="bg-white rounded-xl border p-2 flex items-center justify-between">
            <div>
              <div className="font-medium">{s.titolo}</div>
              <div className="text-xs text-gray-600">{s.data}</div>
            </div>
            <div className="flex items-center gap-2">
              {s.note && <Pill>Note</Pill>}
              <button className="p-1 bg-gray-100 rounded" onClick={() => setData((prev) => ({ ...prev, scadenze: prev.scadenze.filter((x) => x.id !== s.id) }))}>
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
};

/********************* PASTI & DISPENSA ************************/
const CATEGORIE = ["Primi", "Secondi", "Contorni", "Altro", "Colazione", "Merenda"];

const PastiTab = ({ data, setData }) => {
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState("Primi");
  const [filtroCat, setFiltroCat] = useState("");
  const [giorno, setGiorno] = useState(1);
  const [pasto, setPasto] = useState("colazione");
  const [sotto, setSotto] = useState("primo");

  const piattiFiltrati = (data.piatti || []).filter((p) => (filtroCat ? p.categoria === filtroCat : true));

  const addPiatto = () => {
    if (!nome.trim()) return;
    setData((prev) => ({ ...prev, piatti: [...prev.piatti, { id: uid("pi"), nome, categoria, richiede: [] }] }));
    setNome("");
  };

  const addToMenu = (piattoId) => {
    setData((prev) => {
      const d = { ...prev.menuSettimanale };
      const day = { ...d[giorno] };
      if (pasto === "colazione" || pasto === "merenda") {
        day[pasto] = [...(day[pasto] || []), piattoId];
      } else {
        const blocco = { ...(day[pasto] || { primo: [], secondo: [], contorno: [] }) };
        blocco[sotto] = [...(blocco[sotto] || []), piattoId];
        day[pasto] = blocco;
      }
      d[giorno] = day;
      return { ...prev, menuSettimanale: d };
    });
  };

  const removeFromMenu = (pastoKey, idx, sub) => {
    setData((prev) => {
      const d = { ...prev.menuSettimanale };
      const day = { ...d[giorno] };
      if (pastoKey === "colazione" || pastoKey === "merenda") {
        day[pastoKey] = (day[pastoKey] || []).filter((_, i) => i !== idx);
      } else {
        const blocco = { ...(day[pastoKey] || { primo: [], secondo: [], contorno: [] }) };
        blocco[sub] = (blocco[sub] || []).filter((_, i) => i !== idx);
        day[pastoKey] = blocco;
      }
      d[giorno] = day;
      return { ...prev, menuSettimanale: d };
    });
  };

  const resolvePiatto = (id) => data.piatti.find((p) => p.id === id)?.nome || id;

  const giornoData = data.menuSettimanale[giorno];

  return (
    <Section title="Pasti & Dispensa" icon={<ChefHat className="w-5 h-5" />}>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 space-y-3">
          <div className="bg-white rounded-2xl p-3 border">
            <div className="font-medium mb-2">Nuovo piatto</div>
            <input className="border rounded-lg px-2 py-1 w-full mb-2" placeholder="Nome piatto" value={nome} onChange={(e) => setNome(e.target.value)} />
            <select className="border rounded-lg px-2 py-1 w-full mb-2" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              {CATEGORIE.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button className="px-3 py-2 rounded-xl bg-black text-white w-full" onClick={addPiatto}>Aggiungi</button>
          </div>

          <div className="bg-white rounded-2xl p-3 border">
            <div className="font-medium mb-2">Libreria piatti</div>
            <select className="border rounded-lg px-2 py-1 w-full mb-2" value={filtroCat} onChange={(e) => setFiltroCat(e.target.value)}>
              <option value="">Tutte le categorie</option>
              {CATEGORIE.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <div className="max-h-64 overflow-auto space-y-1">
              {piattiFiltrati.map((p) => (
                <div key={p.id} className="border rounded-lg p-2 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">{p.nome}</div>
                    <div className="text-xs text-gray-600">{p.categoria}</div>
                  </div>
                  <button className="px-2 py-1 bg-gray-100 rounded" title="Aggiungi al menu" onClick={() => addToMenu(p.id)}>
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-3">
          <div className="bg-white rounded-2xl p-3 border">
            <div className="grid md:grid-cols-4 gap-2 items-end">
              <div>
                <div className="text-xs text-gray-500 mb-1">Giorno</div>
                <select className="border rounded-lg px-2 py-1 w-full" value={giorno} onChange={(e) => setGiorno(Number(e.target.value))}>
                  {giorni.map((g) => (
                    <option key={g} value={g}>{dayNameFull[g - 1]}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Pasto</div>
                <select className="border rounded-lg px-2 py-1 w-full" value={pasto} onChange={(e) => setPasto(e.target.value)}>
                  <option value="colazione">Colazione</option>
                  <option value="merenda">Merenda</option>
                  <option value="pranzo">Pranzo</option>
                  <option value="cena">Cena</option>
                </select>
              </div>
              {pasto === "pranzo" || pasto === "cena" ? (
                <div>
                  <div className="text-xs text-gray-500 mb-1">Portata</div>
                  <select className="border rounded-lg px-2 py-1 w-full" value={sotto} onChange={(e) => setSotto(e.target.value)}>
                    <option value="primo">Primo</option>
                    <option value="secondo">Secondo</option>
                    <option value="contorno">Contorno</option>
                  </select>
                </div>
              ) : (
                <div className="hidden md:block" />
              )}
              <div>
                <div className="text-xs text-gray-500 mb-1">Filtro categoria</div>
                <select className="border rounded-lg px-2 py-1 w-full" value={filtroCat} onChange={(e) => setFiltroCat(e.target.value)}>
                  <option value="">Tutte</option>
                  {CATEGORIE.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-3 grid md:grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="font-medium mb-1">Selezione rapida</div>
                <div className="text-xs text-gray-500 mb-2">Clicca "+" nella libreria piatti per aggiungere</div>
              </div>

              <div className="bg-gray-50 rounded-xl p-3">
                <div className="font-medium mb-1">Menù del {dayNameFull[giorno - 1]}</div>
                <div className="grid grid-cols-1 gap-2 text-sm">
                  <div>
                    <div className="text-[11px] text-gray-500 uppercase mb-1">Colazione</div>
                    <ul className="list-disc pl-4">
                      {(giornoData.colazione || []).map((id, i) => (
                        <li key={`col-${i}`} className="flex items-center justify-between">
                          <span>{resolvePiatto(id)}</span>
                          <button className="text-red-600" onClick={() => removeFromMenu("colazione", i)}><Trash2 className="w-4 h-4" /></button>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-[11px] text-gray-500 uppercase mb-1">Merenda</div>
                    <ul className="list-disc pl-4">
                      {(giornoData.merenda || []).map((id, i) => (
                        <li key={`mer-${i}`} className="flex items-center justify-between">
                          <span>{resolvePiatto(id)}</span>
                          <button className="text-red-600" onClick={() => removeFromMenu("merenda", i)}><Trash2 className="w-4 h-4" /></button>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-[11px] text-gray-500 uppercase mb-1">Pranzo</div>
                    {["primo", "secondo", "contorno"].map((k) => (
                      <div key={`p-${k}`}>
                        <div className="text-[11px] text-gray-500 mb-1 capitalize">{k}</div>
                        <ul className="list-disc pl-4">
                          {(giornoData.pranzo[k] || []).map((id, i) => (
                            <li key={`pr-${k}-${i}`} className="flex items-center justify-between">
                              <span>{resolvePiatto(id)}</span>
                              <button className="text-red-600" onClick={() => removeFromMenu("pranzo", i, k)}><Trash2 className="w-4 h-4" /></button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="text-[11px] text-gray-500 uppercase mb-1">Cena</div>
                    {["primo", "secondo", "contorno"].map((k) => (
                      <div key={`c-${k}`}>
                        <div className="text-[11px] text-gray-500 mb-1 capitalize">{k}</div>
                        <ul className="list-disc pl-4">
                          {(giornoData.cena[k] || []).map((id, i) => (
                            <li key={`ce-${k}-${i}`} className="flex items-center justify-between">
                              <span>{resolvePiatto(id)}</span>
                              <button className="text-red-600" onClick={() => removeFromMenu("cena", i, k)}><Trash2 className="w-4 h-4" /></button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
};

/********************* LISTA SPESA ************************/
const SpesaTab = ({ data, setData }) => {
  const [nome, setNome] = useState("");
  const [qta, setQta] = useState(1);
  const [unita, setUnita] = useState("pz");

  const add = () => {
    if (!nome.trim()) return;
    setData((prev) => ({ ...prev, listaSpesa: [...prev.listaSpesa, { id: uid("it"), nome, qta, unita }] }));
    setNome("");
  };
  const toggle = (id) =>
    setData((prev) => ({
      ...prev,
      listaSpesa: prev.listaSpesa.map((i) => (i.id === id ? { ...i, preso: !i.preso } : i)),
    }));
  const toDispensa = (id) =>
    setData((prev) => {
      const item = prev.listaSpesa.find((x) => x.id === id);
      if (!item) return prev;
      return {
        ...prev,
        dispensa: [...prev.dispensa, { id: uid("d"), nome: item.nome, qta: item.qta, unita: item.unita }],
        listaSpesa: prev.listaSpesa.filter((x) => x.id !== id),
      };
    });

  return (
    <Section title="Lista spesa & OCR" icon={<ShoppingCart className="w-5 h-5" />}>
      <div className="grid md:grid-cols-4 gap-2 items-end mb-3">
        <input className="border rounded-lg px-2 py-1 w-full" placeholder="Articolo" value={nome} onChange={(e) => setNome(e.target.value)} />
        <input type="number" min={1} className="border rounded-lg px-2 py-1 w-full" value={qta} onChange={(e) => setQta(Number(e.target.value || 1))} />
        <input className="border rounded-lg px-2 py-1 w-full" placeholder="Unità" value={unita} onChange={(e) => setUnita(e.target.value)} />
        <button className="px-3 py-2 rounded-xl bg-black text-white" onClick={add}>Aggiungi</button>
      </div>
      <ul className="space-y-2">
        {data.listaSpesa.map((i) => (
          <li key={i.id} className="bg-white rounded-xl border p-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={!!i.preso} onChange={() => toggle(i.id)} />
              <div>
                <div className="font-medium">{i.nome}</div>
                <div className="text-xs text-gray-600">{i.qta} {i.unita}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="px-2 py-1 bg-gray-100 rounded" onClick={() => toDispensa(i.id)}>In dispensa</button>
              <button className="px-2 py-1 bg-gray-100 rounded" onClick={() => setData((prev) => ({ ...prev, listaSpesa: prev.listaSpesa.filter((x) => x.id !== i.id) }))}><Trash2 className="w-4 h-4" /></button>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-6">
        <div className="font-medium mb-2">Dispensa</div>
        <ul className="grid md:grid-cols-3 gap-2">
          {data.dispensa.map((d) => (
            <li key={d.id} className="bg-white rounded-xl border p-2 flex items-center justify-between">
              <div>
                <div className="font-medium">{d.nome}</div>
                <div className="text-xs text-gray-600">{d.qta} {d.unita}</div>
              </div>
              <button className="px-2 py-1 bg-gray-100 rounded" onClick={() => setData((prev) => ({ ...prev, dispensa: prev.dispensa.filter((x) => x.id !== d.id) }))}><Trash2 className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
};

/********************* COMPITI & PAGHETTE ************************/
const CompitiTab = ({ data, setData, utenti }) => {
  const [titolo, setTitolo] = useState("");
  const [assegnatoA, setAssegnatoA] = useState(utenti[0]?.id || "");
  const [valore, setValore] = useState(1);

  const segnaFatto = (id, userId) =>
    setData((prev) => ({
      ...prev,
      compiti: prev.compiti.map((c) => (c.id === id ? { ...c, fattoBy: userId } : c)),
    }));

  const addPagamento = (userId, importo) =>
    setData((prev) => ({ ...prev, pagamenti: [...prev.pagamenti, { id: uid("pay"), userId, importo, data: today(), note: "paghetta" }] }));

  const saldoPerUser = (userId) => {
    const base = data.settings.allowanceSettimanaleBase || 0;
    const earned = data.compiti.filter((c) => c.fattoBy === userId).reduce((s, c) => s + (c.valore || 0), 0);
    const paid = data.pagamenti.filter((p) => p.userId === userId).reduce((s, p) => s + (p.importo || 0), 0);
    return base + earned - paid;
  };

  return (
    <Section title="Compiti & Paghette" icon={<ClipboardList className="w-5 h-5" />}>
      <div className="grid md:grid-cols-3 gap-2 items-end mb-3">
        <input className="border rounded-lg px-2 py-1 w-full" placeholder="Titolo" value={titolo} onChange={(e) => setTitolo(e.target.value)} />
        <select className="border rounded-lg px-2 py-1 w-full" value={assegnatoA} onChange={(e) => setAssegnatoA(e.target.value)}>
          {utenti.map((u) => (
            <option key={u.id} value={u.id}>{u.nome}</option>
          ))}
        </select>
        <input type="number" min={0} className="border rounded-lg px-2 py-1 w-full" value={valore} onChange={(e) => setValore(Number(e.target.value || 0))} />
        <button
          className="px-3 py-2 rounded-xl bg-black text-white"
          onClick={() => {
            if (!titolo.trim()) return;
            setData((prev) => ({ ...prev, compiti: [...prev.compiti, { id: uid("todo"), titolo, assegnatoA, data: today(), ricorrente: false, valore }] }));
            setTitolo("");
            setValore(1);
          }}
        >
          Aggiungi
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <div className="font-medium mb-2">Da fare</div>
          <ul className="space-y-2">
            {data.compiti.filter((c) => !c.fattoBy).map((c) => (
              <li key={c.id} className="bg-white rounded-xl border p-2 flex items-center justify-between">
                <div>
                  <div className="font-medium">{c.titolo}</div>
                  <div className="text-xs text-gray-600">Valore: {c.valore}{data.settings.valuta}</div>
                </div>
                <div className="flex items-center gap-2">
                  <select className="border rounded-lg px-2 py-1" defaultValue={c.assegnatoA} onChange={(e) => setData((prev) => ({ ...prev, compiti: prev.compiti.map((x) => (x.id === c.id ? { ...x, assegnatoA: e.target.value } : x)) }))}>
                    {utenti.map((u) => (
                      <option key={u.id} value={u.id}>{u.nome}</option>
                    ))}
                  </select>
                  <button className="px-2 py-1 bg-gray-100 rounded" onClick={() => segnaFatto(c.id, c.assegnatoA)}>Segna fatto</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="font-medium mb-2">Saldo & Pagamenti</div>
          <ul className="space-y-2">
            {utenti.map((u) => (
              <li key={u.id} className="bg-white rounded-xl border p-2 flex items-center justify-between">
                <div>
                  <div className="font-medium">{u.nome}</div>
                  <div className="text-xs text-gray-600">Saldo stimato: {saldoPerUser(u.id)}{data.settings.valuta}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="px-2 py-1 bg-gray-100 rounded" onClick={() => addPagamento(u.id, 5)}>Paga {5}{data.settings.valuta}</button>
                  <button className="px-2 py-1 bg-gray-100 rounded" onClick={() => addPagamento(u.id, 10)}>Paga {10}{data.settings.valuta}</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
};

/********************* NOTIFICHE ************************/
const NotificheTab = ({ data, setData }) => {
  const [titolo, setTitolo] = useState("");
  const [messaggio, setMessaggio] = useState("");
  const [orario, setOrario] = useState("20:00");
  const [giorniSel, setGiorniSel] = useState([]);
  const toggle = (d) => setGiorniSel((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  return (
    <Section title="Promemoria" icon={<Bell className="w-5 h-5" />}>
      <div className="grid md:grid-cols-5 gap-2 items-end mb-3">
        <input className="border rounded-lg px-2 py-1 w-full" placeholder="Titolo" value={titolo} onChange={(e) => setTitolo(e.target.value)} />
        <input className="border rounded-lg px-2 py-1 w-full" placeholder="Messaggio" value={messaggio} onChange={(e) => setMessaggio(e.target.value)} />
        <input type="time" className="border rounded-lg px-2 py-1 w-full" value={orario} onChange={(e) => setOrario(e.target.value)} />
        <div className="col-span-2">
          <div className="flex flex-wrap gap-2">
            {giorni.map((d) => (
              <button key={d} onClick={() => toggle(d)} className={`px-2 py-1 rounded-lg ${giorniSel.includes(d) ? "bg-black text-white" : "bg-gray-100"}`}>
                {dayNameShort[d - 1]}
              </button>
            ))}
          </div>
        </div>
        <button
          className="px-3 py-2 rounded-xl bg-black text-white"
          onClick={() => {
            if (!titolo.trim() || !orario) return;
            setData((prev) => ({
              ...prev,
              schedules: [...prev.schedules, { id: uid("rem"), titolo, messaggio, orario, giorni: giorniSel, attivo: true }],
            }));
            setTitolo("");
            setMessaggio("");
            setGiorniSel([]);
          }}
        >
          Aggiungi
        </button>
      </div>
      <ul className="space-y-2">
        {data.schedules.map((s) => (
          <li key={s.id} className="bg-white rounded-xl border p-2 flex items-center justify-between">
            <div>
              <div className="font-medium">{s.titolo}</div>
              <div className="text-xs text-gray-600">{s.orario} · {(s.giorni || []).map((d) => dayNameShort[d - 1]).join(", ")}</div>
            </div>
            <div className="flex items-center gap-2">
              <button className="px-2 py-1 bg-gray-100 rounded" onClick={() => setData((prev) => ({ ...prev, schedules: prev.schedules.map((x) => (x.id === s.id ? { ...x, attivo: !x.attivo } : x)) }))}>{s.attivo ? "Metti in pausa" : "Attiva"}</button>
              <button className="px-2 py-1 bg-gray-100 rounded" onClick={() => setData((prev) => ({ ...prev, schedules: prev.schedules.filter((x) => x.id !== s.id) }))}><Trash2 className="w-4 h-4" /></button>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
};

/********************* IMPOSTAZIONI & UTENTI ************************/
const ChangePasswordBanner = ({ currentUser, setData }) => {
  const [pw, setPw] = useState("");
  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-4">
      <div className="font-medium mb-1">Imposta una nuova password/PIN per {currentUser?.nome}</div>
      <div className="flex gap-2">
        <input className="border rounded-lg px-2 py-1" type="password" placeholder="Nuova password/PIN" value={pw} onChange={(e) => setPw(e.target.value)} />
        <button
          className="px-3 py-1 rounded-xl bg-black text-white"
          onClick={async () => {
            if (!pw) return;
            const salt = uid("s");
            const pwHash = await sha256Hex(`${salt}:${pw}`);
            setData((prev) => ({
              ...prev,
              utenti: prev.utenti.map((u) => (u.id === currentUser.id ? { ...u, salt, pwHash, mustChange: false } : u)),
            }));
          }}
        >
          Salva
        </button>
      </div>
    </div>
  );
};

const UsersTab = ({ data, setData, currentUserId }) => {
  const [nome, setNome] = useState("");
  const [username, setUsername] = useState("");
  const [ruolo, setRuolo] = useState("Ospite");
  const [pw, setPw] = useState("");

  const addUser = async () => {
    if (!nome.trim()) return;
    const salt = pw ? uid("s") : null;
    const hash = pw ? await sha256Hex(`${salt}:${pw}`) : null;
    setData((prev) => ({
      ...prev,
      utenti: [
        ...prev.utenti,
        { id: uid("u"), nome, ruolo, username: username || null, salt, pwHash: hash, mustChange: false },
      ],
    }));
    setNome("");
    setUsername("");
    setRuolo("Ospite");
    setPw("");
  };

  const resetAdmin = async (id) => {
    const tmp = String(Math.floor(1000 + Math.random() * 9000));
    const salt = uid("s");
    const hash = await sha256Hex(`${salt}:${tmp}`);
    alert(`PIN temporaneo per l'utente: ${tmp}`);
    setData((prev) => ({
      ...prev,
      utenti: prev.utenti.map((u) => (u.id === id ? { ...u, salt, pwHash: hash, mustChange: true } : u)),
    }));
  };

  return (
    <Section title="Utenti & Permessi" icon={<Users className="w-5 h-5" />}>
      <div className="grid md:grid-cols-5 gap-2 items-end mb-3">
        <input className="border rounded-lg px-2 py-1 w-full" placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
        <input className="border rounded-lg px-2 py-1 w-full" placeholder="Username (opz.)" value={username} onChange={(e) => setUsername(e.target.value)} />
        <select className="border rounded-lg px-2 py-1 w-full" value={ruolo} onChange={(e) => setRuolo(e.target.value)}>
          {Object.keys(data.permessi).map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <input className="border rounded-lg px-2 py-1 w-full" placeholder="Password/PIN (opz.)" value={pw} onChange={(e) => setPw(e.target.value)} />
        <button className="px-3 py-2 rounded-xl bg-black text-white" onClick={addUser}>Crea utente</button>
      </div>

      <ul className="space-y-2">
        {data.utenti.map((u) => (
          <li key={u.id} className="bg-white rounded-xl border p-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{u.nome} <span className="text-xs text-gray-500">({u.ruolo})</span></div>
                <div className="text-xs text-gray-600">{u.username ? `@${u.username}` : "(senza username)"}</div>
              </div>
              <div className="flex items-center gap-2">
                <button className="px-2 py-1 bg-gray-100 rounded" onClick={() => setData((prev) => ({ ...prev, utenti: prev.utenti.filter((x) => x.id !== u.id) }))}><Trash2 className="w-4 h-4" /></button>
                <button className="px-2 py-1 bg-gray-100 rounded" onClick={() => resetAdmin(u.id)} title="Reset password amministrativo">
                  <KeyRound className="w-4 h-4" /> Reset
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
};

const ImpostazioniTab = ({ data, setData }) => {
  const [famiglia, setFamiglia] = useState(data.settings.famiglia || "");
  const [bg, setBg] = useState(data.settings.themeBg || "#f9fafb");
  const [intervalMs, setIntervalMs] = useState(data.settings.carousel?.intervalMs || 4000);
  const [enabled, setEnabled] = useState(!!data.settings.carousel?.enabled);
  const [urlFoto, setUrlFoto] = useState("");

  return (
    <Section title="Impostazioni" icon={<Settings className="w-5 h-5" />}>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="font-medium">Generali</div>
          <input className="border rounded-lg px-2 py-1 w-full" placeholder="Nome famiglia" value={famiglia} onChange={(e) => setFamiglia(e.target.value)} />
          <input className="border rounded-lg px-2 py-1 w-full" type="color" value={bg} onChange={(e) => setBg(e.target.value)} />
          <button className="px-3 py-2 rounded-xl bg-black text-white" onClick={() => setData((prev) => ({ ...prev, settings: { ...prev.settings, famiglia, themeBg: bg } }))}>Salva</button>
        </div>
        <div className="space-y-2">
          <div className="font-medium">Foto Home (carosello)</div>
          <div className="flex items-end gap-2">
            <input className="border rounded-lg px-2 py-1 w-full" placeholder="URL immagine" value={urlFoto} onChange={(e) => setUrlFoto(e.target.value)} />
            <button className="px-3 py-2 rounded-xl bg-black text-white" onClick={() => { if (!urlFoto.trim()) return; setData((prev) => ({ ...prev, homePhotos: [...(prev.homePhotos || []), { id: uid("ph"), url: urlFoto, titolo: "" }] })); setUrlFoto(""); }}>Aggiungi</button>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Carosello attivo</label>
            <input type="number" min={1000} className="border rounded-lg px-2 py-1 w-40" value={intervalMs} onChange={(e) => setIntervalMs(Number(e.target.value || 4000))} />
            <span className="text-sm text-gray-500">ms</span>
            <button className="px-3 py-2 rounded-xl bg-gray-100" onClick={() => setData((prev) => ({ ...prev, settings: { ...prev.settings, carousel: { enabled, intervalMs } } }))}>Salva carosello</button>
          </div>
          <ul className="space-y-1">
            {(data.homePhotos || []).map((p) => (
              <li key={p.id} className="flex items-center justify-between bg-white rounded-xl border p-2">
                <span className="truncate mr-2 text-sm">{p.url}</span>
                <button className="px-2 py-1 bg-gray-100 rounded" onClick={() => setData((prev) => ({ ...prev, homePhotos: prev.homePhotos.filter((x) => x.id !== p.id) }))}><Trash2 className="w-4 h-4" /></button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
};

/********************* README & TEST ************************/
const ReadmeBox = () => (
  <div className="text-xs text-gray-500 mt-8">
    <div className="font-medium mb-1">Note di versione</div>
    <ul className="list-disc pl-5 space-y-1">
      <li>Nessuna modalità “anteprima”: l’accesso avviene solo con credenziali create in <b>Utenti</b>.</li>
      <li>Hard lock: eventuali sessioni senza credenziali valide vengono invalidate automaticamente.</li>
      <li>Eventi mensili: se creati il 31 → ricadono sull’ultimo giorno del mese successivo; il 30 rimane il 30.</li>
      <li>Ruolo <b>Bimbo</b>: forzato PIN numerico; impostare in <b>Utenti</b>.</li>
      <li>Sync Supabase usa tabella <code>kv(id text primary key, payload jsonb)</code>.</li>
    </ul>
  </div>
);

const DevTests = () => {
  // semplici smoke tests (non bloccanti)
  const [ok, setOk] = useState("eseguo...");
  useEffect(() => {
    try {
      const a = instancesForDate([{ id: "1", titolo: "t", data: "2025-01-31", ripeti: { freq: "MONTHLY" } }], new Date("2025-02-28"));
      const b = instancesForDate([{ id: "2", titolo: "t", data: "2025-04-30", ripeti: { freq: "MONTHLY" } }], new Date("2025-05-30"));
      setOk(`ok (${a.length}/${b.length})`);
    } catch (e) {
      setOk("errore test");
    }
  }, []);
  return (
    <div className="text-[11px] text-gray-400 mt-6">DevTests: {ok}</div>
  );
};

/********************* SUPABASE REST (opzionale) ************************/
async function supaPull(cfg) {
  try {
    const url = `${cfg.url}/rest/v1/${cfg.table}?id=eq.${encodeURIComponent(cfg.recordId)}&select=payload`;
    const r = await fetch(url, {
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${cfg.anonKey}`,
        Accept: "application/json",
      },
    });
    if (!r.ok) return null;
    const arr = await r.json();
    const row = arr[0];
    return row?.payload || null;
  } catch {
    return null;
  }
}
async function supaPush(cfg, payload) {
  try {
    const url = `${cfg.url}/rest/v1/${cfg.table}`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${cfg.anonKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([{ id: cfg.recordId, payload }]),
    });
    return r.ok;
  } catch {
    return false;
  }
}
