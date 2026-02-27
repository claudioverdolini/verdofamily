// @ts-nocheck
import React, { useState } from "react";

// FAMILY HUB – versione stabile per Anteprima
// Funzioni incluse (versione semplificata ma completa):
// - Login con utenti demo (Admin/admin, Famiglia/famiglia)
// - Tema chiaro/scuro
// - Utenti con password, colore e avatar personalizzabili
// - Home con riepilogo giorno e planner settimanale pasti (7×5 slot)
// - Calendario stile Google (lista / settimana / mese) con ora, modifica e cancellazione
// - Scadenze con assegnazione utente
// - Dispensa con categorie (aggiungi/modifica/elimina) e prodotti
// - Lista spesa collegata alla dispensa
// - Pasti: piatti (tipologia + variante + ingredienti) + pianificazione che scala/ripristina dispensa
// - Compiti & paghette: accredito al completamento, pagamenti liberi, annulla pagamento
// - ToDo con archivio
// - Impostazioni tema / notifiche (solo logica locale)

// ----------------- Costanti & helper -----------------

const NAV_ITEMS = [
  "Home",
  "Utenti",
  "Calendario",
  "Scadenze",
  "Dispensa",
  "Lista spesa",
  "Pasti",
  "Compiti & paghette",
  "ToDo List",
  "Impostazioni"
];

const MEAL_TYPES = ["Antipasto", "Primo", "Secondo", "Contorno", "Dolce", "Altro"];
const MEAL_SLOTS = ["Colazione", "II Colazione", "Pranzo", "Merenda", "Cena"];

const slotOrder: any = {
  Colazione: 0,
  "II Colazione": 1,
  Pranzo: 2,
  Merenda: 3,
  Cena: 4
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function getWeekDates(anyDateStr: string) {
  const base = new Date(anyDateStr);
  const day = base.getDay(); // 0=Dom..6=Sab
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(base);
  monday.setDate(base.getDate() + diffToMonday);
  const res: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    res.push(d.toISOString().slice(0, 10));
  }
  return res;
}

function getMonthMatrix(dateStr: string) {
  const base = new Date(dateStr);
  const year = base.getFullYear();
  const month = base.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const firstDay = firstOfMonth.getDay(); // 0=Dom
  const diffToMonday = firstDay === 0 ? -6 : 1 - firstDay;
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() + diffToMonday);

  const weeks: { date: string; inMonth: boolean }[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: { date: string; inMonth: boolean }[] = [];
    for (let d = 0; d < 7; d++) {
      const cur = new Date(gridStart);
      cur.setDate(gridStart.getDate() + w * 7 + d);
      week.push({
        date: cur.toISOString().slice(0, 10),
        inMonth: cur.getMonth() === month
      });
    }
    weeks.push(week);
  }
  return weeks;
}

function monthLabel(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
}

function nextId(list: { id: number }[]) {
  return list.length ? Math.max(...list.map(i => i.id)) + 1 : 1;
}

function parseIngredients(text: string) {
  if (!text || !text.trim()) return [] as { name: string; qty: number; unit: string }[];
  return text
    .split(";")
    .map(c => c.trim())
    .filter(Boolean)
    .map(chunk => {
      const parts = chunk.split("=");
      const name = (parts[0] || "").trim();
      const qtyStr = (parts[1] || "").trim();
      const unit = (parts[2] || "").trim() || "pz";
      return { name, qty: Number(qtyStr) || 0, unit };
    })
    .filter(i => i.name);
}

// Mini test interni per le utility
console.assert(getWeekDates(todayStr()).length === 7, "getWeekDates deve restituire 7 giorni");
console.assert(getMonthMatrix(todayStr()).length === 6, "getMonthMatrix deve avere 6 settimane");

// ----------------- Dati iniziali -----------------

const initialUsers = [
  {
    id: 1,
    name: "Admin",
    role: "admin",
    balance: 0,
    password: "admin",
    color: "#38bdf8",
    avatarUrl: ""
  },
  {
    id: 2,
    name: "Famiglia",
    role: "adulto",
    balance: 0,
    password: "famiglia",
    color: "#f97316",
    avatarUrl: ""
  }
];

const initialMeals = [
  {
    id: 1,
    name: "Pasta",
    type: "Primo",
    variant: "Pomodoro",
    ingredients: [
      { name: "Pasta", qty: 80, unit: "g" },
      { name: "Passata di pomodoro", qty: 100, unit: "g" }
    ]
  }
];

const initialCategories = ["Generico", "Fresco", "Dispensa", "Detersivi"];

// ----------------- Layout helpers -----------------

const baseStyles: any = {
  appShell: {
    minHeight: "100vh",
    padding: 16,
    boxSizing: "border-box",
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  },
  appInner: {
    maxWidth: 1200,
    margin: "0 auto",
    borderRadius: 16,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 20px 40px rgba(0,0,0,0.35)"
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 20px"
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 12
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13
  },
  logoCircle: {
    width: 32,
    height: 32,
    borderRadius: 999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: 16
  },
  body: {
    display: "flex",
    minHeight: 560
  },
  sidebar: {
    width: 220,
    padding: 12,
    boxSizing: "border-box"
  },
  navList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    marginTop: 8
  },
  navButton: {
    width: "100%",
    textAlign: "left",
    padding: "6px 10px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    fontSize: 13
  },
  main: {
    flex: 1,
    padding: 16,
    boxSizing: "border-box",
    overflow: "auto"
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: 600,
    marginBottom: 4
  },
  pageSubtitle: {
    fontSize: 13,
    marginBottom: 16
  },
  card: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 12
  },
  cardHeaderRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: 600
  },
  tag: {
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 11
  },
  twoCols: {
    display: "flex",
    gap: 16,
    alignItems: "flex-start",
    flexWrap: "wrap"
  },
  col: {
    flex: 1,
    minWidth: 260
  },
  formRow: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    marginBottom: 8
  },
  label: {
    fontSize: 12
  },
  input: {
    borderRadius: 8,
    padding: "6px 8px",
    fontSize: 13,
    border: "1px solid",
    outline: "none"
  },
  select: {
    borderRadius: 8,
    padding: "6px 8px",
    fontSize: 13,
    border: "1px solid",
    outline: "none"
  },
  textarea: {
    borderRadius: 8,
    padding: "6px 8px",
    fontSize: 13,
    border: "1px solid",
    outline: "none",
    resize: "vertical"
  },
  primaryButton: {
    borderRadius: 999,
    border: "none",
    padding: "6px 12px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
    marginRight: 6
  },
  ghostButton: {
    borderRadius: 999,
    border: "1px solid",
    padding: "6px 12px",
    cursor: "pointer",
    fontSize: 13,
    marginRight: 6,
    background: "transparent"
  }
};

// ----------------- Component principale -----------------

function FamilyHubApp() {
  // Tema & impostazioni
  const [settings, setSettings] = useState({
    theme: "dark",
    notifications: { email: true, whatsapp: true, popup: true }
  });

  const palette =
    settings.theme === "dark"
      ? {
          appBg: "linear-gradient(135deg,#0f172a,#020617)",
          appText: "#e5e7eb",
          innerBg: "rgba(15,23,42,0.98)",
          headerBg: "linear-gradient(135deg,#0ea5e9,#6366f1)",
          headerText: "#f9fafb",
          sidebarBg: "rgba(15,23,42,0.98)",
          sidebarBorder: "rgba(31,41,55,0.95)",
          mainBg: "#020617",
          cardBg: "rgba(15,23,42,0.96)",
          cardBorder: "rgba(55,65,81,0.9)",
          textMuted: "#9ca3af",
          navActiveBg: "linear-gradient(135deg,#0ea5e9,#6366f1)",
          navActiveText: "#f9fafb",
          inputBg: "#020617",
          inputBorder: "rgba(75,85,99,0.9)",
          buttonPrimaryBg: "linear-gradient(135deg,#0ea5e9,#6366f1)",
          buttonPrimaryText: "#f9fafb",
          buttonGhostBorder: "rgba(148,163,184,0.7)",
          tagBg: "rgba(15,23,42,0.7)",
          tableHeaderBg: "rgba(15,23,42,0.9)",
          tableBorder: "rgba(31,41,55,0.9)"
        }
      : {
          appBg: "linear-gradient(135deg,#e5e7eb,#f9fafb)",
          appText: "#020617",
          innerBg: "#ffffff",
          headerBg: "linear-gradient(135deg,#38bdf8,#6366f1)",
          headerText: "#f9fafb",
          sidebarBg: "#f3f4f6",
          sidebarBorder: "#d1d5db",
          mainBg: "#f9fafb",
          cardBg: "#ffffff",
          cardBorder: "#e5e7eb",
          textMuted: "#6b7280",
          navActiveBg: "linear-gradient(135deg,#38bdf8,#6366f1)",
          navActiveText: "#f9fafb",
          inputBg: "#ffffff",
          inputBorder: "#d1d5db",
          buttonPrimaryBg: "linear-gradient(135deg,#38bdf8,#6366f1)",
          buttonPrimaryText: "#f9fafb",
          buttonGhostBorder: "#9ca3af",
          tagBg: "#e5e7eb",
          tableHeaderBg: "#e5e7eb",
          tableBorder: "#d1d5db"
        };

  // Avatar utente
  function renderAvatar(user: any, size: number = 32) {
    if (!user) return null;
    const letter = (user.name || "?").charAt(0).toUpperCase();
    const color = user.color || "#38bdf8";
    const dimension = size;
    const commonStyle: React.CSSProperties = {
      width: dimension,
      height: dimension,
      borderRadius: 999,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 700,
      fontSize: dimension * 0.45,
      overflow: "hidden",
      boxSizing: "border-box",
      border: "2px solid " + color,
      background: color,
      color: "#f9fafb"
    };

    if (user.avatarUrl) {
      return (
        <div style={commonStyle}>
          <img
            src={user.avatarUrl}
            alt={user.name}
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 999 }}
          />
        </div>
      );
    }

    return <div style={commonStyle}>{letter}</div>;
  }

  // Navigazione & login
  const [activeNav, setActiveNav] = useState("Home");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginForm, setLoginForm] = useState({ name: "", password: "" });
  const [loginError, setLoginError] = useState("");

  // Dati principali
  const [users, setUsers] = useState(initialUsers as any[]);
  const [selectedUserId, setSelectedUserId] = useState(1);
  const currentUser = users.find(u => u.id === selectedUserId) || users[0];

  // Calendario
  const [calendarEvents, setCalendarEvents] = useState(
    [] as { id: number; title: string; date: string; time?: string; userId: number }[]
  );
  const [calendarForm, setCalendarForm] = useState({
    id: null as any,
    title: "",
    date: todayStr(),
    time: "",
    userId: 1
  });
  const [calendarViewMode, setCalendarViewMode] = useState<"list" | "month" | "week">("month");
  const [calendarCurrentDate, setCalendarCurrentDate] = useState(todayStr());

  // Scadenze
  const [deadlines, setDeadlines] = useState(
    [] as { id: number; title: string; date: string; userId: number }[]
  );
  const [deadlinesForm, setDeadlinesForm] = useState({
    title: "",
    date: todayStr(),
    userId: 1
  });

  // Dispensa
  const [categories, setCategories] = useState(initialCategories as string[]);
  const [newCategory, setNewCategory] = useState("");
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");

  const [pantry, setPantry] = useState(
    [] as { id: number; name: string; qty: number; unit: string; category: string }[]
  );
  const [pantryForm, setPantryForm] = useState({
    name: "",
    qty: 1,
    unit: "pz",
    category: initialCategories[0]
  });

  // Lista spesa
  const [shopping, setShopping] = useState(
    [] as { id: number; name: string; qty: number; unit: string; taken: boolean }[]
  );
  const [shoppingForm, setShoppingForm] = useState({ name: "", qty: 1, unit: "pz" });

  // Pasti & pianificazione
  const [meals, setMeals] = useState(initialMeals as any[]);
  const [mealForm, setMealForm] = useState({
    id: null as any,
    name: "",
    type: MEAL_TYPES[0],
    variant: "",
    ingredientsText: ""
  });

  const [mealPlans, setMealPlans] = useState(
    [] as { id: number; date: string; userId: number; mealId: number; slot: string }[]
  );
  const [planForm, setPlanForm] = useState({
    id: null as any,
    date: todayStr(),
    userId: 1,
    mealId: "",
    slot: "Pranzo"
  });
  const [planViewDate, setPlanViewDate] = useState(todayStr());
  const [planTypeFilter, setPlanTypeFilter] = useState("");

  // Compiti & paghette
  const [chores, setChores] = useState(
    [] as {
      id: number;
      title: string;
      deadline: string;
      userId: number;
      amount: number;
      done: boolean;
    }[]
  );
  const [choresForm, setChoresForm] = useState({
    title: "",
    deadline: todayStr(),
    userId: 1,
    amount: 1
  });
  const [transactions, setTransactions] = useState(
    [] as {
      id: number;
      userId: number;
      type: "accredito" | "pagamento";
      amount: number;
      date: string;
      note?: string;
    }[]
  );
  const [paymentInputs, setPaymentInputs] = useState({} as Record<number, string>);

  // ToDo
  const [todos, setTodos] = useState(
    [] as { id: number; title: string; userId: number; done: boolean }[]
  );
  const [todoForm, setTodoForm] = useState({ title: "", userId: 1 });
  const [showCompletedTodos, setShowCompletedTodos] = useState(false);

  // Utenti & password
  const [newUser, setNewUser] = useState({
    name: "",
    role: "adulto",
    password: "",
    color: "#38bdf8",
    avatarUrl: ""
  });
  const [selfPwdForm, setSelfPwdForm] = useState({ newPwd: "", confirm: "" });
  const [adminPwdEdits, setAdminPwdEdits] = useState({} as Record<number, string>);

  // --- funzioni comuni ---

  function getUserName(id: number) {
    const u = users.find(x => x.id === id);
    return u ? u.name : "Sconosciuto";
  }

  function getMealFullName(id: number) {
    const m = meals.find((x: any) => x.id === id);
    if (!m) return "";
    return m.variant ? m.name + " (" + m.variant + ")" : m.name;
  }

  function updateUserBalance(userId: number, delta: number) {
    setUsers(prev =>
      prev.map(u => (u.id === userId ? { ...u, balance: (u.balance || 0) + delta } : u))
    );
  }

  function adjustPantryForIngredients(
    ings: { name: string; qty: number; unit: string }[],
    factor: number
  ) {
    if (!ings || !ings.length) return;
    setPantry(prev => {
      const next = [...prev];
      ings.forEach(ing => {
        const idx = next.findIndex(
          p => p.name.toLowerCase() === (ing.name || "").toLowerCase()
        );
        const delta = (Number(ing.qty) || 0) * factor;
        if (idx === -1) {
          if (factor > 0) {
            next.push({
              id: nextId(next),
              name: ing.name,
              qty: Number(ing.qty) || 0,
              unit: ing.unit || "pz",
              category: "Generico"
            });
          }
        } else {
          const item = next[idx];
          const newQty = Math.max(0, (item.qty || 0) + delta);
          next[idx] = { ...item, qty: newQty };
        }
      });
      return next;
    });
  }

  const today = todayStr();
  const todayMeals = mealPlans
    .filter(p => p.date === today)
    .sort((a, b) => {
      const sa = slotOrder[a.slot] ?? 99;
      const sb = slotOrder[b.slot] ?? 99;
      if (sa !== sb) return sa - sb;
      return getUserName(a.userId).localeCompare(getUserName(b.userId));
    });

  const todayEvents = calendarEvents
    .filter(e => e.date === today)
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));

  const upcomingDeadlines = deadlines.filter(
    d => d.date >= today && d.date <= addDays(today, 15)
  );
  const shoppingCount = shopping.filter(s => !s.taken).length;
  const pendingChores = chores.filter(c => !c.done).length;

  // ----------------- Login -----------------

  function handleLogin() {
    const user = users.find(
      u => u.name === loginForm.name.trim() && u.password === loginForm.password
    );
    if (!user) {
      setLoginError("Utente o password non corretti");
      return;
    }
    setSelectedUserId(user.id);
    setIsAuthenticated(true);
    setLoginError("");
  }

  function handleLogout() {
    setIsAuthenticated(false);
    setLoginForm({ name: "", password: "" });
    setActiveNav("Home");
  }

  function renderLogin() {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: palette.appBg,
          color: palette.appText,
          fontFamily: baseStyles.appShell.fontFamily,
          padding: 16
        }}
      >
        <div
          style={{
            maxWidth: 380,
            width: "100%",
            borderRadius: 16,
            padding: 20,
            background: settings.theme === "dark" ? "rgba(15,23,42,0.98)" : "#ffffff",
            border: "1px solid " + palette.cardBorder,
            boxShadow: "0 20px 40px rgba(0,0,0,0.35)"
          }}
        >
          <div style={{ textAlign: "center", marginBottom: 12 }}>
            <div
              style={{
                ...baseStyles.logoCircle,
                background: palette.headerBg,
                color: palette.headerText,
                margin: "0 auto 8px"
              }}
            >
              FH
            </div>
            <h1 style={{ margin: 0, fontSize: 20 }}>Family Hub</h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: palette.textMuted }}>
              Accedi con il tuo utente per gestire casa, spesa, pasti e paghette.
            </p>
          </div>

          <div style={baseStyles.formRow}>
            <label style={{ ...baseStyles.label, color: palette.textMuted }}>
              Nome utente
            </label>
            <input
              style={{
                ...baseStyles.input,
                background: palette.inputBg,
                borderColor: palette.inputBorder,
                color: palette.appText
              }}
              value={loginForm.name}
              onChange={e => setLoginForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div style={baseStyles.formRow}>
            <label style={{ ...baseStyles.label, color: palette.textMuted }}>
              Password
            </label>
            <input
              type="password"
              style={{
                ...baseStyles.input,
                background: palette.inputBg,
                borderColor: palette.inputBorder,
                color: palette.appText
              }}
              value={loginForm.password}
              onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
            />
          </div>
          {loginError && (
            <div style={{ color: "#f97373", fontSize: 12, marginBottom: 8 }}>{loginError}</div>
          )}
          <button
            onClick={handleLogin}
            style={{
              ...baseStyles.primaryButton,
              width: "100%",
              marginRight: 0,
              background: palette.buttonPrimaryBg,
              color: palette.buttonPrimaryText
            }}
          >
            Entra in Family Hub
          </button>
          <p style={{ fontSize: 11, marginTop: 10, color: palette.textMuted }}>
            Utenti demo: <strong>Admin / admin</strong>, <strong>Famiglia / famiglia</strong>
          </p>
        </div>
      </div>
    );
  }

  // ----------------- Home -----------------

  function renderHome() {
    const weekDates = getWeekDates(today);
    const plansByKey: any = {};
    mealPlans.forEach(p => {
      if (!weekDates.includes(p.date)) return;
      const key = p.date + "|" + p.slot;
      if (!plansByKey[key]) plansByKey[key] = [];
      plansByKey[key].push(p);
    });

    return (
      <div>
        <h2 style={baseStyles.pageTitle}>Dashboard</h2>
        <p style={{ ...baseStyles.pageSubtitle, color: palette.textMuted }}>
          Riepilogo rapido della giornata: pasti, impegni, scadenze, spesa e compiti.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
            gap: 12
          }}
        >
          <div
            style={{
              ...baseStyles.card,
              background: palette.cardBg,
              border: "1px solid " + palette.cardBorder
            }}
          >
            <div style={baseStyles.cardHeaderRow}>
              <span style={baseStyles.cardTitle}>Saldi paghette</span>
              <span
                style={{
                  ...baseStyles.tag,
                  background: palette.tagBg,
                  color: palette.textMuted
                }}
              >
                {today}
              </span>
            </div>
            {users.length === 0 ? (
              <p style={{ fontSize: 13, color: palette.textMuted }}>
                Nessun utente configurato.
              </p>
            ) : (
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  fontSize: 13
                }}
              >
                {users.map(u => (
                  <li
                    key={u.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 2
                    }}
                  >
                    <span>{u.name}</span>
                    <span>{Number(u.balance || 0).toFixed(2)} €</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div
            style={{
              ...baseStyles.card,
              background: palette.cardBg,
              border: "1px solid " + palette.cardBorder,
              gridColumn: "span 2"
            }}
          >
            <div style={baseStyles.cardHeaderRow}>
              <span style={baseStyles.cardTitle}>Impegni di oggi</span>
              <span
                style={{
                  ...baseStyles.tag,
                  background: palette.tagBg,
                  color: palette.textMuted
                }}
              >
                Calendario
              </span>
            </div>
            {todayEvents.length === 0 ? (
              <p style={{ fontSize: 13, color: palette.textMuted }}>
                Nessun impegno in calendario.
              </p>
            ) : (
              <ul style={{ paddingLeft: 18, fontSize: 13 }}>
                {todayEvents.map(e => (
                  <li key={e.id}>
                    {e.time ? e.time + " - " : ""}
                    {e.title}{" "}
                    <span style={{ color: palette.textMuted }}>
                      ({getUserName(e.userId)})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div
            style={{
              ...baseStyles.card,
              background: palette.cardBg,
              border: "1px solid " + palette.cardBorder
            }}
          >
            <div style={baseStyles.cardHeaderRow}>
              <span style={baseStyles.cardTitle}>Scadenze prossimi 15 giorni</span>
              <span
                style={{
                  ...baseStyles.tag,
                  background: palette.tagBg,
                  color: palette.textMuted
                }}
              >
                Scadenze
              </span>
            </div>
            {upcomingDeadlines.length === 0 ? (
              <p style={{ fontSize: 13, color: palette.textMuted }}>
                Nessuna scadenza in vista.
              </p>
            ) : (
              <ul style={{ paddingLeft: 18, fontSize: 13 }}>
                {upcomingDeadlines.map(d => (
                  <li key={d.id}>
                    <strong>{d.date}</strong> - {d.title}{" "}
                    <span style={{ color: palette.textMuted }}>
                      ({getUserName(d.userId)})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div
            style={{
              ...baseStyles.card,
              background: palette.cardBg,
              border: "1px solid " + palette.cardBorder
            }}
          >
            <div style={baseStyles.cardHeaderRow}>
              <span style={baseStyles.cardTitle}>Spesa</span>
              <span
                style={{
                  ...baseStyles.tag,
                  background: palette.tagBg,
                  color: palette.textMuted
                }}
              >
                Lista
              </span>
            </div>
            <p style={{ fontSize: 28, margin: "4px 0" }}>{shoppingCount}</p>
            <p style={{ fontSize: 13, color: palette.textMuted }}>
              Prodotti ancora da comprare
            </p>
          </div>

          <div
            style={{
              ...baseStyles.card,
              background: palette.cardBg,
              border: "1px solid " + palette.cardBorder
            }}
          >
            <div style={baseStyles.cardHeaderRow}>
              <span style={baseStyles.cardTitle}>Compiti</span>
              <span
                style={{
                  ...baseStyles.tag,
                  background: palette.tagBg,
                  color: palette.textMuted
                }}
              >
                Paghette
              </span>
            </div>
            <p style={{ fontSize: 28, margin: "4px 0" }}>{pendingChores}</p>
            <p style={{ fontSize: 13, color: palette.textMuted }}>
              Compiti da completare
            </p>
          </div>

          {/* Planner pasti settimanale a tutta larghezza */}
          <div
            style={{
              ...baseStyles.card,
              background: palette.cardBg,
              border: "1px solid " + palette.cardBorder,
              gridColumn: "1 / -1"
            }}
          >
            <div style={baseStyles.cardHeaderRow}>
              <span style={baseStyles.cardTitle}>Settimana pasti</span>
              <span
                style={{
                  ...baseStyles.tag,
                  background: palette.tagBg,
                  color: palette.textMuted
                }}
              >
                {weekDates[0]} - {weekDates[6]}
              </span>
            </div>
            <div style={{ maxHeight: 420, overflow: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12,
                  border: "1px solid " + palette.tableBorder,
                  tableLayout: "fixed"
                }}
              >
                <thead>
                  <tr>
                    <th
                      style={{
                        padding: 6,
                        borderBottom: "1px solid " + palette.tableBorder,
                        background: palette.tableHeaderBg,
                        width: 90,
                        textAlign: "left"
                      }}
                    >
                      Pasto
                    </th>
                    {weekDates.map(d => (
                      <th
                        key={d}
                        style={{
                          padding: 6,
                          borderBottom: "1px solid " + palette.tableBorder,
                          background: palette.tableHeaderBg,
                          textAlign: "center"
                        }}
                      >
                        {new Date(d).toLocaleDateString("it-IT", {
                          weekday: "short",
                          day: "2-digit"
                        })}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MEAL_SLOTS.map(slot => (
                    <tr key={slot}>
                      <td
                        style={{
                          border: "1px solid " + palette.tableBorder,
                          padding: 6,
                          fontWeight: 600,
                          position: "sticky",
                          left: 0,
                          background: palette.cardBg,
                          zIndex: 1
                        }}
                      >
                        {slot}
                      </td>
                      {weekDates.map(d => {
                        const key = d + "|" + slot;
                        const list = plansByKey[key] || [];
                        return (
                          <td
                            key={d + "-" + slot}
                            style={{
                              border: "1px solid " + palette.tableBorder,
                              padding: 6,
                              verticalAlign: "top",
                              wordWrap: "break-word"
                            }}
                          >
                            {list.length === 0 ? (
                              <span style={{ color: palette.textMuted }}>-</span>
                            ) : (
                              list.map(p => (
                                <div key={p.id} style={{ marginBottom: 2 }}>
                                  {getMealFullName(p.mealId)}{" "}
                                  <span style={{ color: palette.textMuted }}>
                                    ({getUserName(p.userId)})
                                  </span>
                                </div>
                              ))
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ----------------- Utenti -----------------

  function renderUsers() {
    const canAdmin = currentUser.role === "admin";

    function addUser() {
      if (!newUser.name.trim()) return;
      setUsers(prev => [
        ...prev,
        {
          id: nextId(prev),
          name: newUser.name.trim(),
          role: newUser.role,
          balance: 0,
          password: newUser.password || "",
          color: newUser.color || "#38bdf8",
          avatarUrl: newUser.avatarUrl || ""
        }
      ]);
      setNewUser({ name: "", role: "adulto", password: "", color: "#38bdf8", avatarUrl: "" });
    }

    function deleteUser(id: number) {
      if (!canAdmin) return;
      if (users.length === 1) return;
      setUsers(prev => prev.filter(u => u.id !== id));
      if (selectedUserId === id) {
        const first = users.find(u => u.id !== id);
        if (first) setSelectedUserId(first.id);
      }
    }

    function forcePassword(userId: number) {
      const pwd = adminPwdEdits[userId];
      if (!pwd) return;
      setUsers(prev => prev.map(u => (u.id === userId ? { ...u, password: pwd } : u)));
      setAdminPwdEdits(prev => ({ ...prev, [userId]: "" }));
    }

    function changeOwnPassword() {
      if (!selfPwdForm.newPwd || selfPwdForm.newPwd !== selfPwdForm.confirm) return;
      setUsers(prev =>
        prev.map(u => (u.id === currentUser.id ? { ...u, password: selfPwdForm.newPwd } : u))
      );
      setSelfPwdForm({ newPwd: "", confirm: "" });
    }

    function updateCurrentUserStyle(field: "color" | "avatarUrl", value: string) {
      setUsers(prev => prev.map(u => (u.id === currentUser.id ? { ...u, [field]: value } : u)));
    }

    return (
      <div>
        <h2 style={baseStyles.pageTitle}>Utenti</h2>
        <p style={{ ...baseStyles.pageSubtitle, color: palette.textMuted }}>
          Gestisci utenti, ruoli, password, colore e immagine del profilo.
        </p>
        <div style={baseStyles.twoCols}>
          <div style={baseStyles.col}>
            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>Elenco utenti</span>
                <span
                  style={{
                    ...baseStyles.tag,
                    background: palette.tagBg,
                    color: palette.textMuted
                  }}
                >
                  Attivi
                </span>
              </div>
              {users.map(u => (
                <div
                  key={u.id}
                  style={{
                    borderRadius: 10,
                    padding: 8,
                    marginBottom: 6,
                    background:
                      u.id === selectedUserId
                        ? settings.theme === "dark"
                          ? "rgba(59,130,246,0.25)"
                          : "#dbebff"
                        : settings.theme === "dark"
                        ? "rgba(15,23,42,0.9)"
                        : "#f3f4f6",
                    border: "1px solid " + palette.cardBorder,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {renderAvatar(u, 32)}
                    <div>
                      <div>
                        <strong>{u.name}</strong>{" "}
                        <span style={{ color: palette.textMuted, fontSize: 12 }}>
                          ({u.role})
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: palette.textMuted }}>
                        Saldo paghetta: {Number(u.balance || 0).toFixed(2)} €
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <button
                      style={{
                        ...baseStyles.ghostButton,
                        borderColor: palette.buttonGhostBorder,
                        color: palette.appText,
                        marginRight: 0
                      }}
                      onClick={() => setSelectedUserId(u.id)}
                    >
                      Attiva
                    </button>
                    {canAdmin && u.role !== "admin" && (
                      <button
                        style={{
                          ...baseStyles.ghostButton,
                          borderColor: palette.buttonGhostBorder,
                          color: palette.appText,
                          marginRight: 0
                        }}
                        onClick={() => deleteUser(u.id)}
                      >
                        Elimina
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={baseStyles.col}>
            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder,
                marginBottom: 12
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>Nuovo utente</span>
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>Nome</label>
                <input
                  style={{
                    ...baseStyles.input,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={newUser.name}
                  onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))}
                />
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>Ruolo</label>
                <select
                  style={{
                    ...baseStyles.select,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={newUser.role}
                  onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))}
                >
                  <option value="admin">Admin</option>
                  <option value="adulto">Adulto</option>
                  <option value="bambino">Bambino</option>
                </select>
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                  Password iniziale
                </label>
                <input
                  type="password"
                  style={{
                    ...baseStyles.input,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={newUser.password}
                  onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))}
                />
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                  Colore profilo
                </label>
                <input
                  type="color"
                  style={{
                    ...baseStyles.input,
                    padding: 0,
                    height: 32,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder
                  }}
                  value={newUser.color}
                  onChange={e => setNewUser(p => ({ ...p, color: e.target.value }))}
                />
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                  URL immagine profilo (opzionale)
                </label>
                <input
                  style={{
                    ...baseStyles.input,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={newUser.avatarUrl}
                  onChange={e => setNewUser(p => ({ ...p, avatarUrl: e.target.value }))}
                />
              </div>
              <button
                style={{
                  ...baseStyles.primaryButton,
                  background: palette.buttonPrimaryBg,
                  color: palette.buttonPrimaryText
                }}
                onClick={addUser}
              >
                Salva utente
              </button>
            </div>

            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>Password</span>
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 13, marginBottom: 4 }}>Cambio password personale</div>
                <div style={baseStyles.formRow}>
                  <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                    Nuova password
                  </label>
                  <input
                    type="password"
                    style={{
                      ...baseStyles.input,
                      background: palette.inputBg,
                      borderColor: palette.inputBorder,
                      color: palette.appText
                    }}
                    value={selfPwdForm.newPwd}
                    onChange={e =>
                      setSelfPwdForm(f => ({ ...f, newPwd: e.target.value }))
                    }
                  />
                </div>
                <div style={baseStyles.formRow}>
                  <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                    Conferma password
                  </label>
                  <input
                    type="password"
                    style={{
                      ...baseStyles.input,
                      background: palette.inputBg,
                      borderColor: palette.inputBorder,
                      color: palette.appText
                    }}
                    value={selfPwdForm.confirm}
                    onChange={e =>
                      setSelfPwdForm(f => ({ ...f, confirm: e.target.value }))
                    }
                  />
                </div>
                <button
                  style={{
                    ...baseStyles.primaryButton,
                    background: palette.buttonPrimaryBg,
                    color: palette.buttonPrimaryText
                  }}
                  onClick={changeOwnPassword}
                >
                  Aggiorna password
                </button>
              </div>
              {canAdmin && (
                <div>
                  <div style={{ fontSize: 13, marginBottom: 4 }}>Forza password (admin)</div>
                  {users.map(u => (
                    <div key={u.id} style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 12, marginBottom: 2 }}>{u.name}</div>
                      <div style={{ display: "flex", gap: 4 }}>
                        <input
                          type="password"
                          style={{
                            ...baseStyles.input,
                            background: palette.inputBg,
                            borderColor: palette.inputBorder,
                            color: palette.appText,
                            flex: 1
                          }}
                          value={adminPwdEdits[u.id] || ""}
                          onChange={e =>
                            setAdminPwdEdits(prev => ({
                              ...prev,
                              [u.id]: e.target.value
                            }))
                          }
                        />
                        <button
                          style={{
                            ...baseStyles.primaryButton,
                            background: palette.buttonPrimaryBg,
                            color: palette.buttonPrimaryText
                          }}
                          onClick={() => forcePassword(u.id)}
                        >
                          Salva
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <hr style={{ margin: "10px 0", borderColor: palette.cardBorder }} />
              <div>
                <div style={{ fontSize: 13, marginBottom: 4 }}>
                  Personalizzazione utente attivo
                </div>
                <div style={baseStyles.formRow}>
                  <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                    Colore profilo
                  </label>
                  <input
                    type="color"
                    style={{
                      ...baseStyles.input,
                      padding: 0,
                      height: 32,
                      background: palette.inputBg,
                      borderColor: palette.inputBorder
                    }}
                    value={currentUser.color}
                    onChange={e => updateCurrentUserStyle("color", e.target.value)}
                  />
                </div>
                <div style={baseStyles.formRow}>
                  <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                    URL immagine profilo
                  </label>
                  <input
                    style={{
                      ...baseStyles.input,
                      background: palette.inputBg,
                      borderColor: palette.inputBorder,
                      color: palette.appText
                    }}
                    value={currentUser.avatarUrl || ""}
                    onChange={e => updateCurrentUserStyle("avatarUrl", e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ----------------- Calendario -----------------

  function renderCalendar() {
    function saveEvent() {
      if (!calendarForm.title.trim()) return;
      if (calendarForm.id) {
        setCalendarEvents(prev =>
          prev.map(e =>
            e.id === calendarForm.id
              ? {
                  ...e,
                  title: calendarForm.title.trim(),
                  date: calendarForm.date,
                  time: calendarForm.time,
                  userId: calendarForm.userId
                }
              : e
          )
        );
      } else {
        setCalendarEvents(prev => [
          ...prev,
          {
            id: nextId(prev),
            title: calendarForm.title.trim(),
            date: calendarForm.date,
            time: calendarForm.time,
            userId: calendarForm.userId
          }
        ]);
      }
      setCalendarForm({ id: null as any, title: "", date: todayStr(), time: "", userId: 1 });
    }

    function editEvent(ev: any) {
      setCalendarForm({
        id: ev.id,
        title: ev.title,
        date: ev.date,
        time: ev.time || "",
        userId: ev.userId
      });
    }

    function deleteEvent(id: number) {
      setCalendarEvents(prev => prev.filter(e => e.id !== id));
      if (calendarForm.id === id) {
        setCalendarForm({
          id: null as any,
          title: "",
          date: todayStr(),
          time: "",
          userId: 1
        });
      }
    }

    const eventsSorted = [...calendarEvents].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return (a.time || "").localeCompare(b.time || "");
    });

    const weekDates = getWeekDates(calendarCurrentDate);
    const monthMatrix = getMonthMatrix(calendarCurrentDate);

    function renderListView() {
      return (
        <div style={{ fontSize: 13 }}>
          {eventsSorted.length === 0 ? (
            <p style={{ color: palette.textMuted }}>Nessun impegno in calendario.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {eventsSorted.map(ev => (
                <li
                  key={ev.id}
                  style={{
                    padding: 6,
                    borderRadius: 8,
                    border: "1px solid " + palette.cardBorder,
                    marginBottom: 4,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center"
                  }}
                >
                  <div>
                    <div>
                      <strong>
                        {ev.date} {ev.time ? `- ${ev.time}` : ""}
                      </strong>
                    </div>
                    <div>{ev.title}</div>
                    <div style={{ color: palette.textMuted }}>
                      {getUserName(ev.userId)}
                    </div>
                  </div>
                  <div>
                    <button
                      style={{
                        ...baseStyles.ghostButton,
                        borderColor: palette.buttonGhostBorder,
                        color: palette.appText
                      }}
                      onClick={() => editEvent(ev)}
                    >
                      Modifica
                    </button>
                    <button
                      style={{
                        ...baseStyles.ghostButton,
                        borderColor: palette.buttonGhostBorder,
                        color: palette.appText
                      }}
                      onClick={() => deleteEvent(ev.id)}
                    >
                      Elimina
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    }

    function renderWeekView() {
      const byDay: Record<string, any[]> = {};
      weekDates.forEach(d => {
        byDay[d] = [];
      });
      calendarEvents.forEach(ev => {
        if (weekDates.includes(ev.date)) {
          byDay[ev.date].push(ev);
        }
      });
      Object.keys(byDay).forEach(d => {
        byDay[d].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
      });

      return (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7,1fr)",
            gap: 8,
            fontSize: 12
          }}
        >
          {weekDates.map(d => (
            <div
              key={d}
              style={{
                borderRadius: 10,
                border: "1px solid " + palette.cardBorder,
                padding: 6,
                background: palette.cardBg
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {new Date(d).toLocaleDateString("it-IT", {
                  weekday: "short",
                  day: "2-digit",
                  month: "2-digit"
                })}
              </div>
              {byDay[d].length === 0 ? (
                <div style={{ color: palette.textMuted }}>Nessun impegno</div>
              ) : (
                byDay[d].map(ev => (
                  <div
                    key={ev.id}
                    style={{
                      marginBottom: 4,
                      padding: 4,
                      borderRadius: 6,
                      border: "1px solid " + palette.cardBorder,
                      cursor: "pointer"
                    }}
                    onClick={() => editEvent(ev)}
                  >
                    <div>
                      <strong>{ev.time || ""}</strong> {ev.title}
                    </div>
                    <div style={{ color: palette.textMuted }}>
                      {getUserName(ev.userId)}
                    </div>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      );
    }

    function renderMonthView() {
      const matrix = monthMatrix;
      return (
        <div style={{ fontSize: 11 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
            {["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map(d => (
              <div
                key={d}
                style={{
                  textAlign: "center",
                  fontWeight: 600,
                  marginBottom: 4,
                  color: palette.textMuted
                }}
              >
                {d}
              </div>
            ))}
          </div>
          {matrix.map((week, wi) => (
            <div
              key={wi}
              style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}
            >
              {week.map(day => {
                const dayEvents = calendarEvents
                  .filter(ev => ev.date === day.date)
                  .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
                return (
                  <div
                    key={day.date}
                    style={{
                      minHeight: 70,
                      borderRadius: 10,
                      border: "1px solid " + palette.cardBorder,
                      padding: 4,
                      background: day.inMonth ? palette.cardBg : "transparent",
                      opacity: day.inMonth ? 1 : 0.4
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        marginBottom: 2,
                        fontSize: 11,
                        textAlign: "right"
                      }}
                    >
                      {new Date(day.date).getDate()}
                    </div>
                    {dayEvents.slice(0, 3).map(ev => (
                      <div
                        key={ev.id}
                        style={{
                          fontSize: 10,
                          marginBottom: 1,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          cursor: "pointer"
                        }}
                        onClick={() => editEvent(ev)}
                      >
                        {ev.time ? ev.time + " " : ""}
                        {ev.title}
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <div style={{ fontSize: 10, color: palette.textMuted }}>
                        +{dayEvents.length - 3} altri
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      );
    }

    return (
      <div>
        <h2 style={baseStyles.pageTitle}>Calendario</h2>
        <p style={{ ...baseStyles.pageSubtitle, color: palette.textMuted }}>
          Calendario stile Google, con vista lista, settimana e mese.
        </p>

        <div style={baseStyles.twoCols}>
          <div style={baseStyles.col}>
            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>
                  {calendarForm.id ? "Modifica impegno" : "Nuovo impegno"}
                </span>
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>Titolo</label>
                <input
                  style={{
                    ...baseStyles.input,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={calendarForm.title}
                  onChange={e =>
                    setCalendarForm(f => ({ ...f, title: e.target.value }))
                  }
                />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ ...baseStyles.formRow, flex: 1 }}>
                  <label style={{ ...baseStyles.label, color: palette.textMuted }}>Data</label>
                  <input
                    type="date"
                    style={{
                      ...baseStyles.input,
                      background: palette.inputBg,
                      borderColor: palette.inputBorder,
                      color: palette.appText
                    }}
                    value={calendarForm.date}
                    onChange={e =>
                      setCalendarForm(f => ({ ...f, date: e.target.value }))
                    }
                  />
                </div>
                <div style={{ ...baseStyles.formRow, width: 120 }}>
                  <label style={{ ...baseStyles.label, color: palette.textMuted }}>Ora</label>
                  <input
                    type="time"
                    style={{
                      ...baseStyles.input,
                      background: palette.inputBg,
                      borderColor: palette.inputBorder,
                      color: palette.appText
                    }}
                    value={calendarForm.time}
                    onChange={e =>
                      setCalendarForm(f => ({ ...f, time: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>Utente</label>
                <select
                  style={{
                    ...baseStyles.select,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={calendarForm.userId}
                  onChange={e =>
                    setCalendarForm(f => ({ ...f, userId: Number(e.target.value) }))
                  }
                >
                  {users.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                style={{
                  ...baseStyles.primaryButton,
                  background: palette.buttonPrimaryBg,
                  color: palette.buttonPrimaryText
                }}
                onClick={saveEvent}
              >
                Salva
              </button>
              {calendarForm.id && (
                <button
                  style={{
                    ...baseStyles.ghostButton,
                    borderColor: palette.buttonGhostBorder,
                    color: palette.appText
                  }}
                  onClick={() =>
                    setCalendarForm({
                      id: null as any,
                      title: "",
                      date: todayStr(),
                      time: "",
                      userId: 1
                    })
                  }
                >
                  Annulla modifica
                </button>
              )}
            </div>
          </div>

          <div style={baseStyles.col}>
            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>Vista calendario</span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    style={{
                      ...baseStyles.ghostButton,
                      borderColor: palette.buttonGhostBorder,
                      color: palette.appText,
                      marginRight: 0,
                      opacity: calendarViewMode === "list" ? 1 : 0.7
                    }}
                    onClick={() => setCalendarViewMode("list")}
                  >
                    Lista
                  </button>
                  <button
                    style={{
                      ...baseStyles.ghostButton,
                      borderColor: palette.buttonGhostBorder,
                      color: palette.appText,
                      marginRight: 0,
                      opacity: calendarViewMode === "week" ? 1 : 0.7
                    }}
                    onClick={() => setCalendarViewMode("week")}
                  >
                    Settimana
                  </button>
                  <button
                    style={{
                      ...baseStyles.ghostButton,
                      borderColor: palette.buttonGhostBorder,
                      color: palette.appText,
                      marginRight: 0,
                      opacity: calendarViewMode === "month" ? 1 : 0.7
                    }}
                    onClick={() => setCalendarViewMode("month")}
                  >
                    Mese
                  </button>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 8,
                  fontSize: 13
                }}
              >
                <div>
                  {calendarViewMode !== "list" && monthLabel(calendarCurrentDate)}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    style={{
                      ...baseStyles.ghostButton,
                      borderColor: palette.buttonGhostBorder,
                      color: palette.appText,
                      marginRight: 0
                    }}
                    onClick={() => setCalendarCurrentDate(today)}
                  >
                    Oggi
                  </button>
                  <button
                    style={{
                      ...baseStyles.ghostButton,
                      borderColor: palette.buttonGhostBorder,
                      color: palette.appText,
                      marginRight: 0
                    }}
                    onClick={() =>
                      setCalendarCurrentDate(prev =>
                        calendarViewMode === "week"
                          ? addDays(prev, -7)
                          : calendarViewMode === "month"
                          ? addDays(prev, -30)
                          : addDays(prev, -1)
                      )
                    }
                  >
                    ◀
                  </button>
                  <button
                    style={{
                      ...baseStyles.ghostButton,
                      borderColor: palette.buttonGhostBorder,
                      color: palette.appText,
                      marginRight: 0
                    }}
                    onClick={() =>
                      setCalendarCurrentDate(prev =>
                        calendarViewMode === "week"
                          ? addDays(prev, 7)
                          : calendarViewMode === "month"
                          ? addDays(prev, 30)
                          : addDays(prev, 1)
                      )
                    }
                  >
                    ▶
                  </button>
                </div>
              </div>

              <div style={{ maxHeight: 420, overflow: "auto" }}>
                {calendarViewMode === "list" && renderListView()}
                {calendarViewMode === "week" && renderWeekView()}
                {calendarViewMode === "month" && renderMonthView()}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ----------------- Scadenze -----------------

  function renderDeadlines() {
    function saveDeadline() {
      if (!deadlinesForm.title.trim()) return;
      setDeadlines(prev => [
        ...prev,
        {
          id: nextId(prev),
          title: deadlinesForm.title.trim(),
          date: deadlinesForm.date,
          userId: deadlinesForm.userId
        }
      ]);
      setDeadlinesForm({ title: "", date: todayStr(), userId: 1 });
    }

    const sorted = [...deadlines].sort((a, b) => a.date.localeCompare(b.date));

    return (
      <div>
        <h2 style={baseStyles.pageTitle}>Scadenze</h2>
        <p style={{ ...baseStyles.pageSubtitle, color: palette.textMuted }}>
          Tieni sotto controllo le scadenze familiari.
        </p>
        <div style={baseStyles.twoCols}>
          <div style={baseStyles.col}>
            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>Nuova scadenza</span>
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>Titolo</label>
                <input
                  style={{
                    ...baseStyles.input,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={deadlinesForm.title}
                  onChange={e =>
                    setDeadlinesForm(f => ({ ...f, title: e.target.value }))
                  }
                />
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>Data</label>
                <input
                  type="date"
                  style={{
                    ...baseStyles.input,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={deadlinesForm.date}
                  onChange={e =>
                    setDeadlinesForm(f => ({ ...f, date: e.target.value }))
                  }
                />
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>Utente</label>
                <select
                  style={{
                    ...baseStyles.select,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={deadlinesForm.userId}
                  onChange={e =>
                    setDeadlinesForm(f => ({ ...f, userId: Number(e.target.value) }))
                  }
                >
                  {users.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                style={{
                  ...baseStyles.primaryButton,
                  background: palette.buttonPrimaryBg,
                  color: palette.buttonPrimaryText
                }}
                onClick={saveDeadline}
              >
                Salva scadenza
              </button>
            </div>
          </div>

          <div style={baseStyles.col}>
            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>Elenco scadenze</span>
              </div>
              {sorted.length === 0 ? (
                <p style={{ fontSize: 13, color: palette.textMuted }}>
                  Nessuna scadenza.
                </p>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 13 }}>
                  {sorted.map(d => (
                    <li
                      key={d.id}
                      style={{
                        padding: 6,
                        borderRadius: 8,
                        border: "1px solid " + palette.cardBorder,
                        marginBottom: 4
                      }}
                    >
                      <div>
                        <strong>{d.date}</strong> - {d.title}
                      </div>
                      <div style={{ color: palette.textMuted }}>
                        {getUserName(d.userId)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ----------------- Dispensa -----------------

  function renderPantry() {
    function saveCategory() {
      const name = newCategory.trim();
      if (!name || categories.includes(name)) return;
      setCategories(prev => [...prev, name]);
      setNewCategory("");
    }

    function startEditCategory(cat: string) {
      setEditingCategory(cat);
      setEditingCategoryName(cat);
    }

    function commitEditCategory() {
      if (!editingCategory) return;
      const newName = editingCategoryName.trim();
      if (!newName) return;
      setCategories(prev => prev.map(c => (c === editingCategory ? newName : c)));
      setPantry(prev => prev.map(p => (p.category === editingCategory ? { ...p, category: newName } : p)));
      setEditingCategory(null);
      setEditingCategoryName("");
    }

    function deleteCategory(cat: string) {
      if (cat === "Generico") return;
      setCategories(prev => prev.filter(c => c !== cat));
      setPantry(prev =>
        prev.map(p => (p.category === cat ? { ...p, category: "Generico" } : p))
      );
      if (pantryForm.category === cat) {
        setPantryForm(f => ({ ...f, category: "Generico" }));
      }
    }

    function savePantryItem() {
      if (!pantryForm.name.trim()) return;
      setPantry(prev => [
        ...prev,
        {
          id: nextId(prev),
          name: pantryForm.name.trim(),
          qty: Number(pantryForm.qty) || 0,
          unit: pantryForm.unit,
          category: pantryForm.category
        }
      ]);
      setPantryForm({ name: "", qty: 1, unit: "pz", category: pantryForm.category });
    }

    function adjustItemQty(id: number, delta: number) {
      setPantry(prev =>
        prev.map(p =>
          p.id === id ? { ...p, qty: Math.max(0, (p.qty || 0) + delta) } : p
        )
      );
    }

    function deleteItem(id: number) {
      setPantry(prev => prev.filter(p => p.id !== id));
    }

    const grouped: Record<string, any[]> = {};
    pantry.forEach(p => {
      if (!grouped[p.category]) grouped[p.category] = [];
      grouped[p.category].push(p);
    });

    return (
      <div>
        <h2 style={baseStyles.pageTitle}>Dispensa</h2>
        <p style={{ ...baseStyles.pageSubtitle, color: palette.textMuted }}>
          Gestisci le categorie e i prodotti presenti in casa.
        </p>
        <div style={baseStyles.twoCols}>
          <div style={baseStyles.col}>
            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder,
                marginBottom: 12
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>Categorie</span>
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={baseStyles.formRow}>
                  <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                    Nuova categoria
                  </label>
                  <div style={{ display: "flex", gap: 4 }}>
                    <input
                      style={{
                        ...baseStyles.input,
                        background: palette.inputBg,
                        borderColor: palette.inputBorder,
                        color: palette.appText,
                        flex: 1
                      }}
                      value={newCategory}
                      onChange={e => setNewCategory(e.target.value)}
                    />
                    <button
                      style={{
                        ...baseStyles.primaryButton,
                        background: palette.buttonPrimaryBg,
                        color: palette.buttonPrimaryText
                      }}
                      onClick={saveCategory}
                    >
                      Aggiungi
                    </button>
                  </div>
                </div>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 13 }}>
                  {categories.map(cat => (
                    <li
                      key={cat}
                      style={{
                        padding: 4,
                        borderRadius: 8,
                        border: "1px solid " + palette.cardBorder,
                        marginBottom: 4,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center"
                      }}
                    >
                      {editingCategory === cat ? (
                        <div style={{ display: "flex", gap: 4, flex: 1 }}>
                          <input
                            style={{
                              ...baseStyles.input,
                              background: palette.inputBg,
                              borderColor: palette.inputBorder,
                              color: palette.appText,
                              flex: 1
                            }}
                            value={editingCategoryName}
                            onChange={e => setEditingCategoryName(e.target.value)}
                          />
                          <button
                            style={{
                              ...baseStyles.primaryButton,
                              background: palette.buttonPrimaryBg,
                              color: palette.buttonPrimaryText
                            }}
                            onClick={commitEditCategory}
                          >
                            Salva
                          </button>
                        </div>
                      ) : (
                        <>
                          <span>{cat}</span>
                          <div>
                            <button
                              style={{
                                ...baseStyles.ghostButton,
                                borderColor: palette.buttonGhostBorder,
                                color: palette.appText
                              }}
                              onClick={() => startEditCategory(cat)}
                            >
                              Modifica
                            </button>
                            {cat !== "Generico" && (
                              <button
                                style={{
                                  ...baseStyles.ghostButton,
                                  borderColor: palette.buttonGhostBorder,
                                  color: palette.appText
                                }}
                                onClick={() => deleteCategory(cat)}
                              >
                                Elimina
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>Aggiungi prodotto</span>
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>Nome</label>
                <input
                  style={{
                    ...baseStyles.input,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={pantryForm.name}
                  onChange={e =>
                    setPantryForm(f => ({ ...f, name: e.target.value }))
                  }
                />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ ...baseStyles.formRow, width: 80 }}>
                  <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                    Q.tà
                  </label>
                  <input
                    type="number"
                    style={{
                      ...baseStyles.input,
                      background: palette.inputBg,
                      borderColor: palette.inputBorder,
                      color: palette.appText
                    }}
                    value={pantryForm.qty}
                    onChange={e =>
                      setPantryForm(f => ({ ...f, qty: Number(e.target.value) }))
                    }
                  />
                </div>
                <div style={{ ...baseStyles.formRow, width: 100 }}>
                  <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                    Unità
                  </label>
                  <input
                    style={{
                      ...baseStyles.input,
                      background: palette.inputBg,
                      borderColor: palette.inputBorder,
                      color: palette.appText
                    }}
                    value={pantryForm.unit}
                    onChange={e =>
                      setPantryForm(f => ({ ...f, unit: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                  Categoria
                </label>
                <select
                  style={{
                    ...baseStyles.select,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={pantryForm.category}
                  onChange={e =>
                    setPantryForm(f => ({ ...f, category: e.target.value }))
                  }
                >
                  {categories.map(cat => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
              <button
                style={{
                  ...baseStyles.primaryButton,
                  background: palette.buttonPrimaryBg,
                  color: palette.buttonPrimaryText
                }}
                onClick={savePantryItem}
              >
                Aggiungi alla dispensa
              </button>
            </div>
          </div>

          <div style={baseStyles.col}>
            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>Prodotti in dispensa</span>
              </div>
              {pantry.length === 0 ? (
                <p style={{ fontSize: 13, color: palette.textMuted }}>
                  Nessun prodotto inserito.
                </p>
              ) : (
                <div style={{ maxHeight: 420, overflow: "auto", fontSize: 13 }}>
                  {Object.keys(grouped).map(cat => (
                    <div key={cat} style={{ marginBottom: 8 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          marginBottom: 4,
                          color: palette.textMuted
                        }}
                      >
                        {cat}
                      </div>
                      {grouped[cat].map(item => (
                        <div
                          key={item.id}
                          style={{
                            padding: 4,
                            borderRadius: 8,
                            border: "1px solid " + palette.cardBorder,
                            marginBottom: 4,
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center"
                          }}
                        >
                          <div>
                            {item.name}
                            {" "}
                            <span style={{ color: palette.textMuted }}>
                              ({item.qty} {item.unit})
                            </span>
                          </div>
                          <div>
                            <button
                              style={{
                                ...baseStyles.ghostButton,
                                borderColor: palette.buttonGhostBorder,
                                color: palette.appText
                              }}
                              onClick={() => adjustItemQty(item.id, -1)}
                            >
                              -
                            </button>
                            <button
                              style={{
                                ...baseStyles.ghostButton,
                                borderColor: palette.buttonGhostBorder,
                                color: palette.appText
                              }}
                              onClick={() => adjustItemQty(item.id, 1)}
                            >
                              +
                            </button>
                            <button
                              style={{
                                ...baseStyles.ghostButton,
                                borderColor: palette.buttonGhostBorder,
                                color: palette.appText
                              }}
                              onClick={() => deleteItem(item.id)}
                            >
                              X
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ----------------- Lista spesa -----------------

  function renderShopping() {
    function addShopping() {
      if (!shoppingForm.name.trim()) return;
      setShopping(prev => [
        ...prev,
        {
          id: nextId(prev),
          name: shoppingForm.name.trim(),
          qty: Number(shoppingForm.qty) || 0,
          unit: shoppingForm.unit,
          taken: false
        }
      ]);
      setShoppingForm({ name: "", qty: 1, unit: "pz" });
    }

    function toggleTaken(id: number) {
      setShopping(prev => prev.map(s => (s.id === id ? { ...s, taken: !s.taken } : s)));
    }

    function removeItem(id: number) {
      setShopping(prev => prev.filter(s => s.id !== id));
    }

    function confirmPurchased() {
      const purchased = shopping.filter(s => s.taken);
      if (purchased.length === 0) return;
      setPantry(prev => {
        let next = [...prev];
        purchased.forEach(item => {
          const idx = next.findIndex(
            p => p.name.toLowerCase() === item.name.toLowerCase()
          );
          if (idx === -1) {
            next.push({
              id: nextId(next),
              name: item.name,
              qty: item.qty,
              unit: item.unit,
              category: "Generico"
            });
          } else {
            next[idx] = {
              ...next[idx],
              qty: (next[idx].qty || 0) + item.qty
            };
          }
        });
        return next;
      });
      setShopping(prev => prev.filter(s => !s.taken));
    }

    const toBuy = shopping.filter(s => !s.taken).length;

    return (
      <div>
        <h2 style={baseStyles.pageTitle}>Lista spesa</h2>
        <p style={{ ...baseStyles.pageSubtitle, color: palette.textMuted }}>
          Prepara la spesa e aggiorna automaticamente la dispensa.
        </p>
        <div style={baseStyles.twoCols}>
          <div style={baseStyles.col}>
            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>Nuovo elemento</span>
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>Nome</label>
                <input
                  style={{
                    ...baseStyles.input,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={shoppingForm.name}
                  onChange={e =>
                    setShoppingForm(f => ({ ...f, name: e.target.value }))
                  }
                />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ ...baseStyles.formRow, width: 80 }}>
                  <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                    Q.tà
                  </label>
                  <input
                    type="number"
                    style={{
                      ...baseStyles.input,
                      background: palette.inputBg,
                      borderColor: palette.inputBorder,
                      color: palette.appText
                    }}
                    value={shoppingForm.qty}
                    onChange={e =>
                      setShoppingForm(f => ({ ...f, qty: Number(e.target.value) }))
                    }
                  />
                </div>
                <div style={{ ...baseStyles.formRow, width: 100 }}>
                  <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                    Unità
                  </label>
                  <input
                    style={{
                      ...baseStyles.input,
                      background: palette.inputBg,
                      borderColor: palette.inputBorder,
                      color: palette.appText
                    }}
                    value={shoppingForm.unit}
                    onChange={e =>
                      setShoppingForm(f => ({ ...f, unit: e.target.value }))
                    }
                  />
                </div>
              </div>
              <button
                style={{
                  ...baseStyles.primaryButton,
                  background: palette.buttonPrimaryBg,
                  color: palette.buttonPrimaryText
                }}
                onClick={addShopping}
              >
                Aggiungi in lista
              </button>
            </div>
          </div>

          <div style={baseStyles.col}>
            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>Da comprare</span>
                <span
                  style={{
                    ...baseStyles.tag,
                    background: palette.tagBg,
                    color: palette.textMuted
                  }}
                >
                  {toBuy} prodotti
                </span>
              </div>
              {shopping.length === 0 ? (
                <p style={{ fontSize: 13, color: palette.textMuted }}>
                  La lista spesa è vuota.
                </p>
              ) : (
                <>
                  <ul
                    style={{
                      listStyle: "none",
                      padding: 0,
                      margin: 0,
                      fontSize: 13,
                      maxHeight: 320,
                      overflow: "auto"
                    }}
                  >
                    {shopping.map(item => (
                      <li
                        key={item.id}
                        style={{
                          padding: 4,
                          borderRadius: 8,
                          border: "1px solid " + palette.cardBorder,
                          marginBottom: 4,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8
                        }}
                      >
                        <label
                          style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}
                        >
                          <input
                            type="checkbox"
                            checked={item.taken}
                            onChange={() => toggleTaken(item.id)}
                          />
                          <span>
                            {item.name}{" "}
                            <span style={{ color: palette.textMuted }}>
                              ({item.qty} {item.unit})
                            </span>
                          </span>
                        </label>
                        <button
                          style={{
                            ...baseStyles.ghostButton,
                            borderColor: palette.buttonGhostBorder,
                            color: palette.appText
                          }}
                          onClick={() => removeItem(item.id)}
                        >
                          X
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    style={{
                      ...baseStyles.primaryButton,
                      background: palette.buttonPrimaryBg,
                      color: palette.buttonPrimaryText,
                      marginTop: 8
                    }}
                    onClick={confirmPurchased}
                  >
                    Conferma acquistati → aggiorna dispensa
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ----------------- Pasti & pianificazione -----------------

  function renderMeals() {
    function saveMeal() {
      if (!mealForm.name.trim()) return;
      const ingredients = parseIngredients(mealForm.ingredientsText);
      if (mealForm.id) {
        setMeals(prev =>
          prev.map(m =>
            m.id === mealForm.id
              ? {
                  ...m,
                  name: mealForm.name.trim(),
                  type: mealForm.type,
                  variant: mealForm.variant.trim(),
                  ingredients
                }
              : m
          )
        );
      } else {
        setMeals(prev => [
          ...prev,
          {
            id: nextId(prev),
            name: mealForm.name.trim(),
            type: mealForm.type,
            variant: mealForm.variant.trim(),
            ingredients
          }
        ]);
      }
      setMealForm({
        id: null as any,
        name: "",
        type: MEAL_TYPES[0],
        variant: "",
        ingredientsText: ""
      });
    }

    function editMeal(meal: any) {
      setMealForm({
        id: meal.id,
        name: meal.name,
        type: meal.type,
        variant: meal.variant,
        ingredientsText: (meal.ingredients || [])
          .map((ing: any) => `${ing.name}=${ing.qty}=${ing.unit}`)
          .join("; ")
      });
    }

    function deleteMeal(id: number) {
      setMeals(prev => prev.filter(m => m.id !== id));
      setMealPlans(prev => prev.filter(p => p.mealId !== id));
      if (mealForm.id === id) {
        setMealForm({
          id: null as any,
          name: "",
          type: MEAL_TYPES[0],
          variant: "",
          ingredientsText: ""
        });
      }
    }

    function savePlan() {
      if (!planForm.mealId) return;
      const mealIdNum = Number(planForm.mealId);
      const meal = meals.find((m: any) => m.id === mealIdNum);
      const ingredients = meal?.ingredients || [];
      if (planForm.id) {
        // ripristina dispensa per il piano precedente
        const old = mealPlans.find(p => p.id === planForm.id);
        if (old) {
          const oldMeal = meals.find((m: any) => m.id === old.mealId);
          if (oldMeal) adjustPantryForIngredients(oldMeal.ingredients || [], +1);
        }
        setMealPlans(prev =>
          prev.map(p =>
            p.id === planForm.id
              ? {
                  ...p,
                  date: planForm.date,
                  userId: planForm.userId,
                  mealId: mealIdNum,
                  slot: planForm.slot
                }
              : p
          )
        );
      } else {
        setMealPlans(prev => [
          ...prev,
          {
            id: nextId(prev),
            date: planForm.date,
            userId: planForm.userId,
            mealId: mealIdNum,
            slot: planForm.slot
          }
        ]);
      }
      // scala dispensa
      adjustPantryForIngredients(ingredients, -1);
      setPlanForm({ id: null as any, date: todayStr(), userId: 1, mealId: "", slot: "Pranzo" });
    }

    function deletePlan(plan: any) {
      const meal = meals.find((m: any) => m.id === plan.mealId);
      if (meal) adjustPantryForIngredients(meal.ingredients || [], +1);
      setMealPlans(prev => prev.filter(p => p.id !== plan.id));
    }

    function editPlan(plan: any) {
      setPlanForm({
        id: plan.id,
        date: plan.date,
        userId: plan.userId,
        mealId: String(plan.mealId),
        slot: plan.slot
      });
    }

    const weekDates = getWeekDates(planViewDate);

    const filteredMeals = planTypeFilter
      ? meals.filter((m: any) => m.type === planTypeFilter)
      : meals;

    const plansForWeek = mealPlans.filter(p => weekDates.includes(p.date));

    return (
      <div>
        <h2 style={baseStyles.pageTitle}>Pasti & pianificazione</h2>
        <p style={{ ...baseStyles.pageSubtitle, color: palette.textMuted }}>
          Censisci i piatti e pianifica i pasti per famiglia e singoli utenti.
        </p>
        <div style={baseStyles.twoCols}>
          <div style={baseStyles.col}>
            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder,
                marginBottom: 12
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>
                  {mealForm.id ? "Modifica piatto" : "Nuovo piatto"}
                </span>
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>Nome</label>
                <input
                  style={{
                    ...baseStyles.input,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={mealForm.name}
                  onChange={e => setMealForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                  Tipologia piatto
                </label>
                <select
                  style={{
                    ...baseStyles.select,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={mealForm.type}
                  onChange={e => setMealForm(f => ({ ...f, type: e.target.value }))}
                >
                  {MEAL_TYPES.map(t => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                  Variante (es. pomodoro, carbonara...)
                </label>
                <input
                  style={{
                    ...baseStyles.input,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={mealForm.variant}
                  onChange={e =>
                    setMealForm(f => ({ ...f, variant: e.target.value }))
                  }
                />
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                  Ingredienti (nome=qtà=unità; ...)
                </label>
                <textarea
                  rows={3}
                  style={{
                    ...baseStyles.textarea,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={mealForm.ingredientsText}
                  onChange={e =>
                    setMealForm(f => ({ ...f, ingredientsText: e.target.value }))
                  }
                />
              </div>
              <button
                style={{
                  ...baseStyles.primaryButton,
                  background: palette.buttonPrimaryBg,
                  color: palette.buttonPrimaryText
                }}
                onClick={saveMeal}
              >
                Salva piatto
              </button>
            </div>

            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>Pianifica pasto</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ ...baseStyles.formRow, flex: 1 }}>
                  <label style={{ ...baseStyles.label, color: palette.textMuted }}>Data</label>
                  <input
                    type="date"
                    style={{
                      ...baseStyles.input,
                      background: palette.inputBg,
                      borderColor: palette.inputBorder,
                      color: palette.appText
                    }}
                    value={planForm.date}
                    onChange={e =>
                      setPlanForm(f => ({ ...f, date: e.target.value }))
                    }
                  />
                </div>
                <div style={{ ...baseStyles.formRow, flex: 1 }}>
                  <label style={{ ...baseStyles.label, color: palette.textMuted }}>Utente</label>
                  <select
                    style={{
                      ...baseStyles.select,
                      background: palette.inputBg,
                      borderColor: palette.inputBorder,
                      color: palette.appText
                    }}
                    value={planForm.userId}
                    onChange={e =>
                      setPlanForm(f => ({ ...f, userId: Number(e.target.value) }))
                    }
                  >
                    {users.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                    <option value={999999}>Famiglia</option>
                  </select>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ ...baseStyles.formRow, flex: 1 }}>
                  <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                    Slot pasto
                  </label>
                  <select
                    style={{
                      ...baseStyles.select,
                      background: palette.inputBg,
                      borderColor: palette.inputBorder,
                      color: palette.appText
                    }}
                    value={planForm.slot}
                    onChange={e => setPlanForm(f => ({ ...f, slot: e.target.value }))}
                  >
                    {MEAL_SLOTS.map(s => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ ...baseStyles.formRow, flex: 1 }}>
                  <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                    Filtra per tipologia
                  </label>
                  <select
                    style={{
                      ...baseStyles.select,
                      background: palette.inputBg,
                      borderColor: palette.inputBorder,
                      color: palette.appText
                    }}
                    value={planTypeFilter}
                    onChange={e => setPlanTypeFilter(e.target.value)}
                  >
                    <option value="">Tutte</option>
                    {MEAL_TYPES.map(t => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>Piatto</label>
                <select
                  style={{
                    ...baseStyles.select,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={planForm.mealId}
                  onChange={e => setPlanForm(f => ({ ...f, mealId: e.target.value }))}
                >
                  <option value="">Seleziona...</option>
                  {filteredMeals.map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.type} - {getMealFullName(m.id)}
                    </option>
                  ))}
                </select>
              </div>
              <button
                style={{
                  ...baseStyles.primaryButton,
                  background: palette.buttonPrimaryBg,
                  color: palette.buttonPrimaryText
                }}
                onClick={savePlan}
              >
                Salva pianificazione
              </button>
            </div>
          </div>

          <div style={baseStyles.col}>
            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>Piatti censiti</span>
              </div>
              {meals.length === 0 ? (
                <p style={{ fontSize: 13, color: palette.textMuted }}>
                  Nessun piatto censito.
                </p>
              ) : (
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                    fontSize: 13,
                    maxHeight: 160,
                    overflow: "auto"
                  }}
                >
                  {meals.map((m: any) => (
                    <li
                      key={m.id}
                      style={{
                        padding: 4,
                        borderRadius: 8,
                        border: "1px solid " + palette.cardBorder,
                        marginBottom: 4,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center"
                      }}
                    >
                      <div>
                        <strong>{m.type}</strong> - {getMealFullName(m.id)}
                      </div>
                      <div>
                        <button
                          style={{
                            ...baseStyles.ghostButton,
                            borderColor: palette.buttonGhostBorder,
                            color: palette.appText
                          }}
                          onClick={() => editMeal(m)}
                        >
                          Modifica
                        </button>
                        <button
                          style={{
                            ...baseStyles.ghostButton,
                            borderColor: palette.buttonGhostBorder,
                            color: palette.appText
                          }}
                          onClick={() => deleteMeal(m.id)}
                        >
                          Elimina
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>Settimana pianificata</span>
                <span
                  style={{
                    ...baseStyles.tag,
                    background: palette.tagBg,
                    color: palette.textMuted
                  }}
                >
                  {weekDates[0]} - {weekDates[6]}
                </span>
              </div>
              <div style={{ marginBottom: 8, display: "flex", gap: 4 }}>
                <button
                  style={{
                    ...baseStyles.ghostButton,
                    borderColor: palette.buttonGhostBorder,
                    color: palette.appText,
                    marginRight: 0
                  }}
                  onClick={() => setPlanViewDate(addDays(planViewDate, -7))}
                >
                  ◀
                </button>
                <button
                  style={{
                    ...baseStyles.ghostButton,
                    borderColor: palette.buttonGhostBorder,
                    color: palette.appText,
                    marginRight: 0
                  }}
                  onClick={() => setPlanViewDate(today)}
                >
                  Oggi
                </button>
                <button
                  style={{
                    ...baseStyles.ghostButton,
                    borderColor: palette.buttonGhostBorder,
                    color: palette.appText,
                    marginRight: 0
                  }}
                  onClick={() => setPlanViewDate(addDays(planViewDate, 7))}
                >
                  ▶
                </button>
              </div>
              <div style={{ maxHeight: 260, overflow: "auto", fontSize: 12 }}>
                {MEAL_SLOTS.map(slot => (
                  <div key={slot} style={{ marginBottom: 6 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        marginBottom: 2,
                        color: palette.textMuted
                      }}
                    >
                      {slot}
                    </div>
                    {weekDates.map(d => {
                      const list = plansForWeek
                        .filter(p => p.date === d && p.slot === slot)
                        .sort((a, b) =>
                          getUserName(a.userId).localeCompare(getUserName(b.userId))
                        );
                      if (list.length === 0) return null;
                      return (
                        <div key={d} style={{ marginLeft: 8, marginBottom: 2 }}>
                          <div style={{ fontWeight: 500 }}>
                            {new Date(d).toLocaleDateString("it-IT", {
                              weekday: "short",
                              day: "2-digit"
                            })}
                          </div>
                          {list.map(p => (
                            <div
                              key={p.id}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: 4
                              }}
                            >
                              <span>
                                {getMealFullName(p.mealId)}{" "}
                                <span style={{ color: palette.textMuted }}>
                                  ({getUserName(p.userId)})
                                </span>
                              </span>
                              <span>
                                <button
                                  style={{
                                    ...baseStyles.ghostButton,
                                    borderColor: palette.buttonGhostBorder,
                                    color: palette.appText
                                  }}
                                  onClick={() => editPlan(p)}
                                >
                                  ✎
                                </button>
                                <button
                                  style={{
                                    ...baseStyles.ghostButton,
                                    borderColor: palette.buttonGhostBorder,
                                    color: palette.appText
                                  }}
                                  onClick={() => deletePlan(p)}
                                >
                                  X
                                </button>
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ----------------- Compiti & paghette -----------------

  function renderChores() {
    function saveChore() {
      if (!choresForm.title.trim()) return;
      setChores(prev => [
        ...prev,
        {
          id: nextId(prev),
          title: choresForm.title.trim(),
          deadline: choresForm.deadline,
          userId: choresForm.userId,
          amount: Number(choresForm.amount) || 0,
          done: false
        }
      ]);
      setChoResForm({ title: "", deadline: todayStr(), userId: 1, amount: 1 });
    }

    function setChoResForm(v: any) {
      setChoresForm(v);
    }

    function toggleDone(chore: any) {
      if (!chore.done) {
        // completato → accredita
        updateUserBalance(chore.userId, chore.amount);
        setTransactions(prev => [
          ...prev,
          {
            id: nextId(prev),
            userId: chore.userId,
            type: "accredito",
            amount: chore.amount,
            date: today,
            note: `Compito: ${chore.title}`
          }
        ]);
      }
      setChores(prev => prev.map(c => (c.id === chore.id ? { ...c, done: !c.done } : c)));
    }

    function payUser(userId: number, amount: number) {
      if (!amount) return;
      updateUserBalance(userId, -amount);
      setTransactions(prev => [
        ...prev,
        {
          id: nextId(prev),
          userId,
          type: "pagamento",
          amount,
          date: today,
          note: "Pagamento paghetta"
        }
      ]);
    }

    function cancelTransaction(tx: any) {
      // annulla effetto saldo
      if (tx.type === "accredito") {
        updateUserBalance(tx.userId, -tx.amount);
      } else {
        updateUserBalance(tx.userId, tx.amount);
      }
      setTransactions(prev => prev.filter(t => t.id !== tx.id));
    }

    const choresSorted = [...chores].sort((a, b) => a.deadline.localeCompare(b.deadline));

    return (
      <div>
        <h2 style={baseStyles.pageTitle}>Compiti & paghette</h2>
        <p style={{ ...baseStyles.pageSubtitle, color: palette.textMuted }}>
          Assegna compiti, riconosci la paghetta e gestisci i pagamenti.
        </p>
        <div style={baseStyles.twoCols}>
          <div style={baseStyles.col}>
            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder,
                marginBottom: 12
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>Nuovo compito</span>
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>Titolo</label>
                <input
                  style={{
                    ...baseStyles.input,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={choresForm.title}
                  onChange={e =>
                    setChoResForm({
                      ...choresForm,
                      title: e.target.value
                    })
                  }
                />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ ...baseStyles.formRow, flex: 1 }}>
                  <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                    Scadenza
                  </label>
                  <input
                    type="date"
                    style={{
                      ...baseStyles.input,
                      background: palette.inputBg,
                      borderColor: palette.inputBorder,
                      color: palette.appText
                    }}
                    value={choresForm.deadline}
                    onChange={e =>
                      setChoResForm({
                        ...choresForm,
                        deadline: e.target.value
                      })
                    }
                  />
                </div>
                <div style={{ ...baseStyles.formRow, flex: 1 }}>
                  <label style={{ ...baseStyles.label, color: palette.textMuted }}>Utente</label>
                  <select
                    style={{
                      ...baseStyles.select,
                      background: palette.inputBg,
                      borderColor: palette.inputBorder,
                      color: palette.appText
                    }}
                    value={choresForm.userId}
                    onChange={e =>
                      setChoResForm({
                        ...choresForm,
                        userId: Number(e.target.value)
                      })
                    }
                  >
                    {users.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                  Importo paghetta (€)
                </label>
                <input
                  type="number"
                  style={{
                    ...baseStyles.input,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={choresForm.amount}
                  onChange={e =>
                    setChoResForm({
                      ...choresForm,
                      amount: Number(e.target.value)
                    })
                  }
                />
              </div>
              <button
                style={{
                  ...baseStyles.primaryButton,
                  background: palette.buttonPrimaryBg,
                  color: palette.buttonPrimaryText
                }}
                onClick={saveChore}
              >
                Salva compito
              </button>
            </div>

            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>Compiti assegnati</span>
              </div>
              {choresSorted.length === 0 ? (
                <p style={{ fontSize: 13, color: palette.textMuted }}>
                  Nessun compito assegnato.
                </p>
              ) : (
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                    fontSize: 13,
                    maxHeight: 220,
                    overflow: "auto"
                  }}
                >
                  {choresSorted.map(ch => (
                    <li
                      key={ch.id}
                      style={{
                        padding: 4,
                        borderRadius: 8,
                        border: "1px solid " + palette.cardBorder,
                        marginBottom: 4,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center"
                      }}
                    >
                      <label
                        style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}
                      >
                        <input
                          type="checkbox"
                          checked={ch.done}
                          onChange={() => toggleDone(ch)}
                        />
                        <span>
                          {ch.title} ({ch.amount.toFixed(2)} €)
                          <span style={{ color: palette.textMuted }}>
                            {" "}- {getUserName(ch.userId)} - entro {ch.deadline}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div style={baseStyles.col}>
            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder,
                marginBottom: 12
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>Pagamenti manuali</span>
              </div>
              {users.map(u => (
                <div key={u.id} style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 13, marginBottom: 2 }}>
                    {u.name} - saldo: {Number(u.balance || 0).toFixed(2)} €
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <input
                      type="number"
                      placeholder="Importo"
                      style={{
                        ...baseStyles.input,
                        background: palette.inputBg,
                        borderColor: palette.inputBorder,
                        color: palette.appText,
                        flex: 1
                      }}
                      value={paymentInputs[u.id] || ""}
                      onChange={e =>
                        setPaymentInputs(prev => ({ ...prev, [u.id]: e.target.value }))
                      }
                    />
                    <button
                      style={{
                        ...baseStyles.primaryButton,
                        background: palette.buttonPrimaryBg,
                        color: palette.buttonPrimaryText
                      }}
                      onClick={() => {
                        const amt = Number(paymentInputs[u.id] || 0);
                        if (amt > 0) {
                          payUser(u.id, amt);
                          setPaymentInputs(prev => ({ ...prev, [u.id]: "" }));
                        }
                      }}
                    >
                      Paga
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>Storico movimenti</span>
              </div>
              {transactions.length === 0 ? (
                <p style={{ fontSize: 13, color: palette.textMuted }}>
                  Nessun movimento registrato.
                </p>
              ) : (
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                    fontSize: 12,
                    maxHeight: 220,
                    overflow: "auto"
                  }}
                >
                  {transactions
                    .slice()
                    .reverse()
                    .map(tx => (
                      <li
                        key={tx.id}
                        style={{
                          padding: 4,
                          borderRadius: 8,
                          border: "1px solid " + palette.cardBorder,
                          marginBottom: 4,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center"
                        }}
                      >
                        <div>
                          <div>
                            <strong>{tx.type === "accredito" ? "+" : "-"}</strong>
                            {tx.amount.toFixed(2)} € - {getUserName(tx.userId)}
                          </div>
                          <div style={{ color: palette.textMuted }}>
                            {tx.date} - {tx.note}
                          </div>
                        </div>
                        <button
                          style={{
                            ...baseStyles.ghostButton,
                            borderColor: palette.buttonGhostBorder,
                            color: palette.appText
                          }}
                          onClick={() => cancelTransaction(tx)}
                        >
                          Annulla
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ----------------- ToDo -----------------

  function renderTodos() {
    function saveTodo() {
      if (!todoForm.title.trim()) return;
      setTodos(prev => [
        ...prev,
        {
          id: nextId(prev),
          title: todoForm.title.trim(),
          userId: todoForm.userId,
          done: false
        }
      ]);
      setTodoForm({ title: "", userId: 1 });
    }

    function toggleTodo(id: number) {
      setTodos(prev => prev.map(t => (t.id === id ? { ...t, done: !t.done } : t)));
    }

    const visibleTodos = todos.filter(t => (showCompletedTodos ? true : !t.done));

    return (
      <div>
        <h2 style={baseStyles.pageTitle}>Cose da fare</h2>
        <p style={{ ...baseStyles.pageSubtitle, color: palette.textMuted }}>
          Promemoria veloci per tutta la famiglia.
        </p>
        <div style={baseStyles.twoCols}>
          <div style={baseStyles.col}>
            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>Nuovo promemoria</span>
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>Testo</label>
                <input
                  style={{
                    ...baseStyles.input,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={todoForm.title}
                  onChange={e =>
                    setTodoForm(f => ({ ...f, title: e.target.value }))
                  }
                />
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>Utente</label>
                <select
                  style={{
                    ...baseStyles.select,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={todoForm.userId}
                  onChange={e =>
                    setTodoForm(f => ({ ...f, userId: Number(e.target.value) }))
                  }
                >
                  {users.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                style={{
                  ...baseStyles.primaryButton,
                  background: palette.buttonPrimaryBg,
                  color: palette.buttonPrimaryText
                }}
                onClick={saveTodo}
              >
                Salva promemoria
              </button>
            </div>
          </div>

          <div style={baseStyles.col}>
            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>Elenco</span>
                <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={showCompletedTodos}
                    onChange={e => setShowCompletedTodos(e.target.checked)}
                  />
                  Mostra anche completate
                </label>
              </div>
              {visibleTodos.length === 0 ? (
                <p style={{ fontSize: 13, color: palette.textMuted }}>
                  Nessun promemoria.
                </p>
              ) : (
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                    fontSize: 13,
                    maxHeight: 320,
                    overflow: "auto"
                  }}
                >
                  {visibleTodos.map(t => (
                    <li
                      key={t.id}
                      style={{
                        padding: 4,
                        borderRadius: 8,
                        border: "1px solid " + palette.cardBorder,
                        marginBottom: 4,
                        display: "flex",
                        alignItems: "center",
                        gap: 8
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={t.done}
                        onChange={() => toggleTodo(t.id)}
                      />
                      <span
                        style={{
                          textDecoration: t.done ? "line-through" : "none",
                          flex: 1
                        }}
                      >
                        {t.title}
                        <span style={{ color: palette.textMuted }}>
                          {" "}- {getUserName(t.userId)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ----------------- Impostazioni -----------------

  function renderSettings() {
    return (
      <div>
        <h2 style={baseStyles.pageTitle}>Impostazioni</h2>
        <p style={{ ...baseStyles.pageSubtitle, color: palette.textMuted }}>
          Personalizza tema e preferenze notifiche.
        </p>
        <div style={baseStyles.twoCols}>
          <div style={baseStyles.col}>
            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>Tema</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  style={{
                    ...baseStyles.ghostButton,
                    borderColor: palette.buttonGhostBorder,
                    color: palette.appText,
                    marginRight: 0,
                    opacity: settings.theme === "light" ? 1 : 0.7
                  }}
                  onClick={() => setSettings(s => ({ ...s, theme: "light" }))}
                >
                  Chiaro
                </button>
                <button
                  style={{
                    ...baseStyles.ghostButton,
                    borderColor: palette.buttonGhostBorder,
                    color: palette.appText,
                    marginRight: 0,
                    opacity: settings.theme === "dark" ? 1 : 0.7
                  }}
                  onClick={() => setSettings(s => ({ ...s, theme: "dark" }))}
                >
                  Scuro
                </button>
              </div>
            </div>
          </div>

          <div style={baseStyles.col}>
            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>Notifiche (placeholder)</span>
              </div>
              <p style={{ fontSize: 12, color: palette.textMuted }}>
                In una versione successiva qui potremo collegare WhatsApp, email e notifiche
                push.
              </p>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={settings.notifications.email}
                  onChange={e =>
                    setSettings(s => ({
                      ...s,
                      notifications: { ...s.notifications, email: e.target.checked }
                    }))
                  }
                />
                Email
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={settings.notifications.whatsapp}
                  onChange={e =>
                    setSettings(s => ({
                      ...s,
                      notifications: { ...s.notifications, whatsapp: e.target.checked }
                    }))
                  }
                />
                WhatsApp
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={settings.notifications.popup}
                  onChange={e =>
                    setSettings(s => ({
                      ...s,
                      notifications: { ...s.notifications, popup: e.target.checked }
                    }))
                  }
                />
                Popup in app
              </label>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ----------------- Layout principale -----------------

  if (!isAuthenticated) {
    return renderLogin();
  }

  function renderMain() {
    switch (activeNav) {
      case "Home":
        return renderHome();
      case "Utenti":
        return renderUsers();
      case "Calendario":
        return renderCalendar();
      case "Scadenze":
        return renderDeadlines();
      case "Dispensa":
        return renderPantry();
      case "Lista spesa":
        return renderShopping();
      case "Pasti":
        return renderMeals();
      case "Compiti & paghette":
        return renderChores();
      case "ToDo List":
        return renderTodos();
      case "Impostazioni":
        return renderSettings();
      default:
        return renderHome();
    }
  }

  return (
    <div
      style={{
        ...baseStyles.appShell,
        background: palette.appBg,
        color: palette.appText
      }}
    >
      <div
        style={{
          ...baseStyles.appInner,
          background: palette.innerBg
        }}
      >
        <header
          style={{
            ...baseStyles.header,
            background: palette.headerBg,
            color: palette.headerText
          }}
        >
          <div style={baseStyles.headerLeft}>
            <div
              style={{
                ...baseStyles.logoCircle,
                background: "rgba(15,23,42,0.2)",
                color: palette.headerText
              }}
            >
              FH
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>Family Hub</div>
              <div style={{ fontSize: 12, opacity: 0.9 }}>
                {" "}Benvenuto, {currentUser.name}
              </div>
            </div>
          </div>
          <div style={baseStyles.headerRight}>
            <span style={{ fontSize: 12 }}>Tema</span>
            <button
              style={{
                ...baseStyles.ghostButton,
                borderColor: "rgba(248,250,252,0.4)",
                color: palette.headerText,
                marginRight: 0
              }}
              onClick={() =>
                setSettings(s => ({ ...s, theme: s.theme === "dark" ? "light" : "dark" }))
              }
            >
              {settings.theme === "dark" ? "Chiaro" : "Scuro"}
            </button>
            <div>{renderAvatar(currentUser, 32)}</div>
            <button
              style={{
                ...baseStyles.ghostButton,
                borderColor: "rgba(248,250,252,0.4)",
                color: palette.headerText,
                marginRight: 0
              }}
              onClick={handleLogout}
            >
              Esci
            </button>
          </div>
        </header>

        <div
          style={{
            ...baseStyles.body,
            background: palette.mainBg
          }}
        >
          <aside
            style={{
              ...baseStyles.sidebar,
              background: palette.sidebarBg,
              borderRight: "1px solid " + palette.sidebarBorder
            }}
          >
            <ul style={baseStyles.navList}>
              {NAV_ITEMS.map(item => (
                <li key={item}>
                  <button
                    style={{
                      ...baseStyles.navButton,
                      background:
                        activeNav === item ? palette.navActiveBg : "transparent",
                      color:
                        activeNav === item ? palette.navActiveText : palette.appText
                    }}
                    onClick={() => setActiveNav(item)}
                  >
                    {item}
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <main
            style={{
              ...baseStyles.main,
              background: palette.mainBg
            }}
          >
            {renderMain()}
          </main>
        </div>
      </div>
    </div>
  );
}

export default FamilyHubApp;

