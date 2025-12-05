// @ts-nocheck
import React, { useState } from "react";

// FAMILY HUB - Versione completa per anteprima
// - Login (Admin/admin, Famiglia/famiglia)
// - Tema chiaro / scuro
// - Home con riepilogo di oggi (pasti, impegni, scadenze, spesa, compiti)
// - Utenti con password, saldo paghetta, cambio password
// - Calendario stile Google Calendar (lista / mese / settimana) CON ORA
// - Scadenze assegnate a utente
// - Dispensa con categorie + Lista spesa collegata
// - Pasti & Pianificazione con griglia settimanale 7x5 e gestione ingredienti
// - Compiti & paghette con storico movimenti e pagamenti liberi
// - ToDo List con archivio

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

const slotOrder = {
  Colazione: 0,
  "II Colazione": 1,
  Pranzo: 2,
  Merenda: 3,
  Cena: 4
};

const weekdayLabels = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function getWeekDates(anyDateStr) {
  const base = new Date(anyDateStr);
  const day = base.getDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(base);
  monday.setDate(base.getDate() + diffToMonday);
  const res = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    res.push(d.toISOString().slice(0, 10));
  }
  return res;
}

function nextId(list) {
  return list.length ? Math.max(...list.map(i => i.id)) + 1 : 1;
}

function parseIngredients(text) {
  if (!text || !text.trim()) return [];
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

// ----------------- Dati iniziali -----------------

const initialUsers = [
  { id: 1, name: "Admin", role: "admin", balance: 0, password: "admin" },
  { id: 2, name: "Famiglia", role: "adulto", balance: 0, password: "famiglia" }
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

const baseStyles = {
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
  // Tema & impostazioni generali
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

  // Navigazione & login
  const [activeNav, setActiveNav] = useState("Home");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginForm, setLoginForm] = useState({ name: "", password: "" });
  const [loginError, setLoginError] = useState("");

  // Dati principali
  const [users, setUsers] = useState(initialUsers);
  const [selectedUserId, setSelectedUserId] = useState(1);

  // Calendario
  const [calendarEvents, setCalendarEvents] = useState([]); // {id,title,date,time,userId}
  const [calendarForm, setCalendarForm] = useState({
    title: "",
    date: todayStr(),
    time: "18:00",
    userId: 1
  });
  const [calendarViewMode, setCalendarViewMode] = useState("month"); // list | month | week
  const [calendarCurrentDate, setCalendarCurrentDate] = useState(todayStr());

  // Scadenze
  const [deadlines, setDeadlines] = useState([]); // {id,title,date,userId}
  const [deadlinesForm, setDeadlinesForm] = useState({
    title: "",
    date: todayStr(),
    userId: 1
  });

  // Dispensa
  const [categories, setCategories] = useState(initialCategories);
  const [newCategory, setNewCategory] = useState("");
  const [pantry, setPantry] = useState([]); // {id,name,qty,unit,category}
  const [pantryForm, setPantryForm] = useState({
    name: "",
    qty: 1,
    unit: "pz",
    category: initialCategories[0]
  });

  // Lista spesa
  const [shopping, setShopping] = useState([]); // {id,name,qty,unit,taken}
  const [shoppingForm, setShoppingForm] = useState({ name: "", qty: 1, unit: "pz" });

  // Pasti
  const [meals, setMeals] = useState(initialMeals); // {id,name,type,variant,ingredients[]}
  const [mealForm, setMealForm] = useState({
    name: "",
    type: MEAL_TYPES[0],
    variant: "",
    ingredientsText: ""
  });
  const [editingMealId, setEditingMealId] = useState(null);

  const [mealPlans, setMealPlans] = useState([]); // {id,date,userId,mealId,slot}
  const [planForm, setPlanForm] = useState({
    date: todayStr(),
    userId: 1,
    mealId: "",
    slot: "Pranzo"
  });
  const [planViewDate, setPlanViewDate] = useState(todayStr());

  // Compiti & paghette
  const [chores, setChores] = useState([]); // {id,title,deadline,userId,amount,done}
  const [choresForm, setChoresForm] = useState({
    title: "",
    deadline: todayStr(),
    userId: 1,
    amount: 1
  });
  const [transactions, setTransactions] = useState([]); // {id,userId,type,amount,date,note}
  const [paymentInputs, setPaymentInputs] = useState({}); // userId -> string

  // ToDo
  const [todos, setTodos] = useState([]); // {id,title,userId,done}
  const [todoForm, setTodoForm] = useState({ title: "", userId: 1 });
  const [showCompletedTodos, setShowCompletedTodos] = useState(false);

  // Gestione utenti & password
  const [newUser, setNewUser] = useState({ name: "", role: "adulto", password: "" });
  const [selfPwdForm, setSelfPwdForm] = useState({ newPwd: "", confirm: "" });
  const [adminPwdEdits, setAdminPwdEdits] = useState({});

  const currentUser = users.find(u => u.id === selectedUserId) || users[0];

  function getUserName(id) {
    const u = users.find(x => x.id === id);
    return u ? u.name : "Sconosciuto";
  }

  function getMealFullName(id) {
    const m = meals.find(x => x.id === id);
    if (!m) return "";
    return m.variant ? m.name + " (" + m.variant + ")" : m.name;
  }

  function adjustPantryForIngredients(ings, factor) {
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

  // --- Dati Home ---
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
            <label style={{ ...baseStyles.label, color: palette.textMuted }}>Password</label>
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
            <div style={{ color: "#f97373", fontSize: 12, marginBottom: 8 }}>
              {loginError}
            </div>
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
              <span style={baseStyles.cardTitle}>Pasti di oggi</span>
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
            {todayMeals.length === 0 ? (
              <p style={{ fontSize: 13, color: palette.textMuted }}>
                Nessun pasto pianificato.
              </p>
            ) : (
              <ul style={{ paddingLeft: 18, fontSize: 13 }}>
                {todayMeals.map(p => (
                  <li key={p.id}>
                    <strong>{p.slot}</strong>: {getMealFullName(p.mealId)}{" "}
                    <span style={{ color: palette.textMuted }}>
                      ({getUserName(p.userId)})
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
          password: newUser.password || ""
        }
      ]);
      setNewUser({ name: "", role: "adulto", password: "" });
    }

    function deleteUser(id) {
      if (!canAdmin) return;
      if (users.length === 1) return;
      setUsers(prev => prev.filter(u => u.id !== id));
      if (selectedUserId === id) {
        const first = users.find(u => u.id !== id);
        if (first) setSelectedUserId(first.id);
      }
    }

    function forcePassword(userId) {
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

    return (
      <div>
        <h2 style={baseStyles.pageTitle}>Utenti</h2>
        <p style={{ ...baseStyles.pageSubtitle, color: palette.textMuted }}>
          Gestisci utenti, ruoli, password e saldo paghetta.
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
                    border: "1px solid " + palette.cardBorder
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between"
                    }}
                  >
                    <div>
                      <div>
                        <strong>{u.name}</strong>{" "}
                        <span style={{ color: palette.textMuted, fontSize: 12 }}>
                          ({u.role})
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: palette.textMuted }}>
                        Saldo paghetta: {u.balance.toFixed(2)} €
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        style={{
                          ...baseStyles.ghostButton,
                          borderColor: palette.buttonGhostBorder,
                          color: palette.appText
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
                            color: palette.appText
                          }}
                          onClick={() => deleteUser(u.id)}
                        >
                          Elimina
                        </button>
                      )}
                    </div>
                  </div>
                  {canAdmin && (
                    <div style={{ marginTop: 6 }}>
                      <input
                        type="password"
                        placeholder="Nuova password (admin)"
                        style={{
                          ...baseStyles.input,
                          fontSize: 12,
                          background: palette.inputBg,
                          borderColor: palette.inputBorder,
                          color: palette.appText
                        }}
                        value={adminPwdEdits[u.id] || ""}
                        onChange={e =>
                          setAdminPwdEdits(prev => ({ ...prev, [u.id]: e.target.value }))
                        }
                      />
                      <button
                        style={{
                          ...baseStyles.ghostButton,
                          marginTop: 4,
                          borderColor: palette.buttonGhostBorder,
                          color: palette.appText
                        }}
                        onClick={() => forcePassword(u.id)}
                      >
                        Forza password
                      </button>
                    </div>
                  )}
                </div>
              ))}
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
                <span style={baseStyles.cardTitle}>Cambia la tua password</span>
                <span
                  style={{
                    ...baseStyles.tag,
                    background: palette.tagBg,
                    color: palette.textMuted
                  }}
                >
                  {currentUser.name}
                </span>
              </div>
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
                  onChange={e => setSelfPwdForm(p => ({ ...p, newPwd: e.target.value }))}
                />
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                  Conferma
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
                  onChange={e => setSelfPwdForm(p => ({ ...p, confirm: e.target.value }))}
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
          </div>
        </div>
      </div>
    );
  }

  // ----------------- Calendario -----------------

  function renderCalendar() {
    const sorted = [...calendarEvents].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return (a.time || "").localeCompare(b.time || "");
    });

    const eventsByDate = {};
    calendarEvents.forEach(ev => {
      if (!eventsByDate[ev.date]) eventsByDate[ev.date] = [];
      eventsByDate[ev.date].push(ev);
    });
    Object.keys(eventsByDate).forEach(d => {
      eventsByDate[d].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    });

    const current = new Date(calendarCurrentDate);
    const year = current.getFullYear();
    const month = current.getMonth();

    const firstOfMonth = new Date(year, month, 1);
    const firstWeekday = (firstOfMonth.getDay() + 6) % 7; // 0=Mon..6=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const monthWeeks = [];
    let dayCounter = 1 - firstWeekday;
    for (let w = 0; w < 6; w++) {
      const weekRow = [];
      for (let d = 0; d < 7; d++) {
        if (dayCounter < 1 || dayCounter > daysInMonth) {
          weekRow.push(null);
        } else {
          const dateObj = new Date(year, month, dayCounter);
          weekRow.push(dateObj.toISOString().slice(0, 10));
        }
        dayCounter++;
      }
      monthWeeks.push(weekRow);
    }

    const weekDates = getWeekDates(calendarCurrentDate);

    function changeMonth(delta) {
      const d = new Date(calendarCurrentDate);
      d.setMonth(d.getMonth() + delta);
      setCalendarCurrentDate(d.toISOString().slice(0, 10));
    }

    function changeWeek(delta) {
      setCalendarCurrentDate(addDays(calendarCurrentDate, delta * 7));
    }

    function addEvent() {
      if (!calendarForm.title.trim()) return;
      setCalendarEvents(prev => [
        ...prev,
        {
          id: nextId(prev),
          title: calendarForm.title.trim(),
          date: calendarForm.date,
          time: calendarForm.time || "",
          userId: Number(calendarForm.userId)
        }
      ]);
      setCalendarForm(f => ({ ...f, title: "" }));
    }

    function removeEvent(id) {
      setCalendarEvents(prev => prev.filter(e => e.id !== id));
    }

    const monthLabel = current.toLocaleDateString("it-IT", {
      month: "long",
      year: "numeric"
    });

    return (
      <div>
        <h2 style={baseStyles.pageTitle}>Calendario</h2>
        <p style={{ ...baseStyles.pageSubtitle, color: palette.textMuted }}>
          Vista stile Google Calendar: mensile, settimanale o lista. Ogni impegno ha anche l'ora.
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
                <span style={baseStyles.cardTitle}>Nuovo impegno</span>
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
                  onChange={e => setCalendarForm(f => ({ ...f, title: e.target.value }))}
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
                  value={calendarForm.date}
                  onChange={e => setCalendarForm(f => ({ ...f, date: e.target.value }))}
                />
              </div>
              <div style={baseStyles.formRow}>
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
                  onChange={e => setCalendarForm(f => ({ ...f, time: e.target.value }))}
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
                onClick={addEvent}
              >
                Aggiungi impegno
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
                <span style={baseStyles.cardTitle}>Vista</span>
                <span
                  style={{
                    ...baseStyles.tag,
                    background: palette.tagBg,
                    color: palette.textMuted
                  }}
                >
                  {calendarViewMode}
                </span>
              </div>
              <div style={{ marginBottom: 8, display: "flex", gap: 6 }}>
                <button
                  style={{
                    ...baseStyles.ghostButton,
                    borderColor: palette.buttonGhostBorder,
                    color: palette.appText,
                    background:
                      calendarViewMode === "list" ? palette.navActiveBg : "transparent"
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
                    background:
                      calendarViewMode === "month" ? palette.navActiveBg : "transparent"
                  }}
                  onClick={() => setCalendarViewMode("month")}
                >
                  Mese
                </button>
                <button
                  style={{
                    ...baseStyles.ghostButton,
                    borderColor: palette.buttonGhostBorder,
                    color: palette.appText,
                    background:
                      calendarViewMode === "week" ? palette.navActiveBg : "transparent"
                  }}
                  onClick={() => setCalendarViewMode("week")}
                >
                  Settimana
                </button>
              </div>

              {calendarViewMode === "list" && (
                <div
                  style={{
                    maxHeight: 260,
                    overflow: "auto",
                    fontSize: 13,
                    borderTop: "1px solid " + palette.cardBorder,
                    paddingTop: 6
                  }}
                >
                  {sorted.length === 0 ? (
                    <p style={{ color: palette.textMuted }}>
                      Nessun impegno inserito.
                    </p>
                  ) : (
                    <ul style={{ paddingLeft: 18 }}>
                      {sorted.map(e => (
                        <li key={e.id} style={{ marginBottom: 4 }}>
                          <strong>
                            {e.date} {e.time}
                          </strong>{" "}
                          - {e.title}{" "}
                          <span style={{ color: palette.textMuted }}>
                            ({getUserName(e.userId)})
                          </span>
                          <button
                            style={{
                              ...baseStyles.ghostButton,
                              marginLeft: 6,
                              borderColor: palette.buttonGhostBorder,
                              color: palette.appText
                            }}
                            onClick={() => removeEvent(e.id)}
                          >
                            X
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {calendarViewMode === "month" && (
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 6
                    }}
                  >
                    <button
                      style={{
                        ...baseStyles.ghostButton,
                        borderColor: palette.buttonGhostBorder,
                        color: palette.appText
                      }}
                      onClick={() => changeMonth(-1)}
                    >
                      ←
                    </button>
                    <span style={{ fontSize: 13 }}>{monthLabel}</span>
                    <button
                      style={{
                        ...baseStyles.ghostButton,
                        borderColor: palette.buttonGhostBorder,
                        color: palette.appText
                      }}
                      onClick={() => changeMonth(1)}
                    >
                      →
                    </button>
                  </div>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 11,
                      border: "1px solid " + palette.tableBorder
                    }}
                  >
                    <thead>
                      <tr>
                        {weekdayLabels.map(d => (
                          <th
                            key={d}
                            style={{
                              padding: 4,
                              borderBottom: "1px solid " + palette.tableBorder,
                              background: palette.tableHeaderBg,
                              textAlign: "center"
                            }}
                          >
                            {d}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {monthWeeks.map((week, wi) => (
                        <tr key={wi}>
                          {week.map((dateStr, di) => {
                            if (!dateStr) {
                              return (
                                <td
                                  key={wi + "-" + di}
                                  style={{
                                    border: "1px solid " + palette.tableBorder,
                                    height: 60,
                                    verticalAlign: "top"
                                  }}
                                />
                              );
                            }
                            const isToday = dateStr === today;
                            const dayNum = new Date(dateStr).getDate();
                            const evs = eventsByDate[dateStr] || [];
                            return (
                              <td
                                key={wi + "-" + di}
                                style={{
                                  border: "1px solid " + palette.tableBorder,
                                  padding: 4,
                                  verticalAlign: "top",
                                  background: isToday
                                    ? settings.theme === "dark"
                                      ? "rgba(56,189,248,0.15)"
                                      : "#e0f2fe"
                                    : "transparent"
                                }}
                              >
                                <div style={{ fontSize: 11, marginBottom: 2 }}>{dayNum}</div>
                                {evs.map(ev => (
                                  <div
                                    key={ev.id}
                                    style={{
                                      fontSize: 10,
                                      padding: "1px 3px",
                                      borderRadius: 4,
                                      background:
                                        settings.theme === "dark"
                                          ? "rgba(59,130,246,0.4)"
                                          : "#dbeafe",
                                      marginBottom: 2,
                                      cursor: "pointer"
                                    }}
                                    title={ev.title + " (" + getUserName(ev.userId) + ")"}
                                  >
                                    {ev.time ? ev.time + " " : ""}
                                    {ev.title}
                                  </div>
                                ))}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {calendarViewMode === "week" && (
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 6
                    }}
                  >
                    <button
                      style={{
                        ...baseStyles.ghostButton,
                        borderColor: palette.buttonGhostBorder,
                        color: palette.appText
                      }}
                      onClick={() => changeWeek(-1)}
                    >
                      ←
                    </button>
                    <span style={{ fontSize: 13 }}>
                      Settimana di {weekDates[0]} - {weekDates[6]}
                    </span>
                    <button
                      style={{
                        ...baseStyles.ghostButton,
                        borderColor: palette.buttonGhostBorder,
                        color: palette.appText
                      }}
                      onClick={() => changeWeek(1)}
                    >
                      →
                    </button>
                  </div>
                  <div style={{ fontSize: 12 }}>
                    {weekDates.map(d => {
                      const label = new Date(d).toLocaleDateString("it-IT", {
                        weekday: "short",
                        day: "2-digit",
                        month: "2-digit"
                      });
                      const evs = (eventsByDate[d] || []).sort((a, b) =>
                        (a.time || "").localeCompare(b.time || "")
                      );
                      return (
                        <div
                          key={d}
                          style={{
                            borderBottom: "1px solid " + palette.cardBorder,
                            padding: "4px 0"
                          }}
                        >
                          <div style={{ fontWeight: 600 }}>{label}</div>
                          {evs.length === 0 ? (
                            <div style={{ color: palette.textMuted }}>Nessun impegno</div>
                          ) : (
                            evs.map(ev => (
                              <div
                                key={ev.id}
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  marginTop: 2
                                }}
                              >
                                <span>
                                  {ev.time ? ev.time + " - " : ""}
                                  {ev.title}{" "}
                                  <span style={{ color: palette.textMuted }}>
                                    ({getUserName(ev.userId)})
                                  </span>
                                </span>
                                <button
                                  style={{
                                    ...baseStyles.ghostButton,
                                    borderColor: palette.buttonGhostBorder,
                                    color: palette.appText
                                  }}
                                  onClick={() => removeEvent(ev.id)}
                                >
                                  X
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
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
                <span style={baseStyles.cardTitle}>Impegni futuri</span>
              </div>
              {sorted.length === 0 ? (
                <p style={{ fontSize: 13, color: palette.textMuted }}>
                  Nessun impegno registrato.
                </p>
              ) : (
                <ul style={{ paddingLeft: 18, fontSize: 13 }}>
                  {sorted.slice(0, 10).map(e => (
                    <li key={e.id}>
                      <strong>
                        {e.date} {e.time}
                      </strong>{" "}
                      - {e.title}{" "}
                      <span style={{ color: palette.textMuted }}>
                        ({getUserName(e.userId)})
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

  // ----------------- Scadenze -----------------

  function renderDeadlines() {
    const sorted = [...deadlines].sort((a, b) => a.date.localeCompare(b.date));

    function addDeadline() {
      if (!deadlinesForm.title.trim()) return;
      setDeadlines(prev => [
        ...prev,
        {
          id: nextId(prev),
          title: deadlinesForm.title.trim(),
          date: deadlinesForm.date,
          userId: Number(deadlinesForm.userId)
        }
      ]);
      setDeadlinesForm(f => ({ ...f, title: "" }));
    }

    function removeDeadline(id) {
      setDeadlines(prev => prev.filter(d => d.id !== id));
    }

    return (
      <div>
        <h2 style={baseStyles.pageTitle}>Scadenze</h2>
        <p style={{ ...baseStyles.pageSubtitle, color: palette.textMuted }}>
          Tieni traccia delle scadenze importanti e assegna un referente.
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
                  onChange={e => setDeadlinesForm(f => ({ ...f, title: e.target.value }))}
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
                  onChange={e => setDeadlinesForm(f => ({ ...f, date: e.target.value }))}
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
                onClick={addDeadline}
              >
                Aggiungi scadenza
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
                  Nessuna scadenza inserita.
                </p>
              ) : (
                <ul style={{ paddingLeft: 18, fontSize: 13 }}>
                  {sorted.map(d => (
                    <li key={d.id} style={{ marginBottom: 4 }}>
                      <strong>{d.date}</strong> - {d.title}{" "}
                      <span style={{ color: palette.textMuted }}>
                        ({getUserName(d.userId)})
                      </span>
                      <button
                        style={{
                          ...baseStyles.ghostButton,
                          marginLeft: 6,
                          borderColor: palette.buttonGhostBorder,
                          color: palette.appText
                        }}
                        onClick={() => removeDeadline(d.id)}
                      >
                        X
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

  // ----------------- Dispensa -----------------

  function renderPantry() {
    function addCategory() {
      const name = newCategory.trim();
      if (!name) return;
      if (categories.includes(name)) return;
      setCategories(prev => [...prev, name]);
      setNewCategory("");
    }

    function addPantryItem() {
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
      setPantryForm(p => ({ ...p, name: "", qty: 1 }));
    }

    function removeItem(id) {
      setPantry(prev => prev.filter(p => p.id !== id));
    }

    function changeQty(id, delta) {
      setPantry(prev =>
        prev.map(p =>
          p.id === id ? { ...p, qty: Math.max(0, (p.qty || 0) + delta) } : p
        )
      );
    }

    const grouped = {};
    pantry.forEach(p => {
      if (!grouped[p.category]) grouped[p.category] = [];
      grouped[p.category].push(p);
    });

    return (
      <div>
        <h2 style={baseStyles.pageTitle}>Dispensa</h2>
        <p style={{ ...baseStyles.pageSubtitle, color: palette.textMuted }}>
          Censimento prodotti food e no food, organizzati per categoria.
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
                <span style={baseStyles.cardTitle}>Categorie</span>
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                  Nuova categoria
                </label>
                <input
                  style={{
                    ...baseStyles.input,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={newCategory}
                  onChange={e => setNewCategory(e.target.value)}
                />
              </div>
              <button
                style={{
                  ...baseStyles.primaryButton,
                  background: palette.buttonPrimaryBg,
                  color: palette.buttonPrimaryText
                }}
                onClick={addCategory}
              >
                Aggiungi categoria
              </button>
              <ul style={{ paddingLeft: 18, fontSize: 13, marginTop: 8 }}>
                {categories.map(c => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
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
                <span style={baseStyles.cardTitle}>Nuovo prodotto</span>
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
                  onChange={e => setPantryForm(p => ({ ...p, name: e.target.value }))}
                />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ ...baseStyles.formRow, flex: 1 }}>
                  <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                    Quantità
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
                      setPantryForm(p => ({ ...p, qty: Number(e.target.value) || 0 }))
                    }
                  />
                </div>
                <div style={{ ...baseStyles.formRow, width: 80 }}>
                  <label style={{ ...baseStyles.label, color: palette.textMuted }}>Unità</label>
                  <input
                    style={{
                      ...baseStyles.input,
                      background: palette.inputBg,
                      borderColor: palette.inputBorder,
                      color: palette.appText
                    }}
                    value={pantryForm.unit}
                    onChange={e => setPantryForm(p => ({ ...p, unit: e.target.value }))}
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
                  onChange={e => setPantryForm(p => ({ ...p, category: e.target.value }))}
                >
                  {categories.map(c => (
                    <option key={c} value={c}>
                      {c}
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
                onClick={addPantryItem}
              >
                Aggiungi in dispensa
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
                <span style={baseStyles.cardTitle}>Prodotti in dispensa</span>
              </div>
              {pantry.length === 0 ? (
                <p style={{ fontSize: 13, color: palette.textMuted }}>
                  Nessun prodotto inserito.
                </p>
              ) : (
                <div style={{ maxHeight: 260, overflow: "auto", fontSize: 13 }}>
                  {Object.keys(grouped).map(cat => (
                    <div key={cat} style={{ marginBottom: 6 }}>
                      <div style={{ fontWeight: 600 }}>{cat}</div>
                      {grouped[cat].map(p => (
                        <div
                          key={p.id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginTop: 2
                          }}
                        >
                          <span>
                            {p.name}: {p.qty} {p.unit}
                          </span>
                          <span>
                            <button
                              style={{
                                ...baseStyles.ghostButton,
                                borderColor: palette.buttonGhostBorder,
                                color: palette.appText
                              }}
                              onClick={() => changeQty(p.id, -1)}
                            >
                              -
                            </button>
                            <button
                              style={{
                                ...baseStyles.ghostButton,
                                borderColor: palette.buttonGhostBorder,
                                color: palette.appText
                              }}
                              onClick={() => changeQty(p.id, 1)}
                            >
                              +
                            </button>
                            <button
                              style={{
                                ...baseStyles.ghostButton,
                                borderColor: palette.buttonGhostBorder,
                                color: palette.appText
                              }}
                              onClick={() => removeItem(p.id)}
                            >
                              X
                            </button>
                          </span>
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

    function toggleTaken(id) {
      setShopping(prev =>
        prev.map(s => (s.id === id ? { ...s, taken: !s.taken } : s))
      );
    }

    function removeShopping(id) {
      setShopping(prev => prev.filter(s => s.id !== id));
    }

    function confirmToPantry() {
      const toTransfer = shopping.filter(s => s.taken);
      if (!toTransfer.length) return;
      setPantry(prev => {
        const next = [...prev];
        toTransfer.forEach(item => {
          const idx = next.findIndex(
            p =>
              p.name.toLowerCase() === item.name.toLowerCase() &&
              p.unit === item.unit
          );
          const qty = Number(item.qty) || 0;
          if (idx === -1) {
            next.push({
              id: nextId(next),
              name: item.name,
              qty,
              unit: item.unit,
              category: "Generico"
            });
          } else {
            const it = next[idx];
            next[idx] = { ...it, qty: (it.qty || 0) + qty };
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
          Genera la lista della spesa e invia automaticamente gli acquisti in dispensa.
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
                <span style={baseStyles.cardTitle}>Nuovo prodotto</span>
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
                  onChange={e => setShoppingForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ ...baseStyles.formRow, flex: 1 }}>
                  <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                    Quantità
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
                      setShoppingForm(f => ({ ...f, qty: Number(e.target.value) || 0 }))
                    }
                  />
                </div>
                <div style={{ ...baseStyles.formRow, width: 80 }}>
                  <label style={{ ...baseStyles.label, color: palette.textMuted }}>Unità</label>
                  <input
                    style={{
                      ...baseStyles.input,
                      background: palette.inputBg,
                      borderColor: palette.inputBorder,
                      color: palette.appText
                    }}
                    value={shoppingForm.unit}
                    onChange={e => setShoppingForm(f => ({ ...f, unit: e.target.value }))}
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
                Aggiungi alla lista
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
                <span style={baseStyles.cardTitle}>Lista spesa</span>
              </div>
              {shopping.length === 0 ? (
                <p style={{ fontSize: 13, color: palette.textMuted }}>
                  La lista spesa è vuota.
                </p>
              ) : (
                <>
                  <ul style={{ paddingLeft: 0, listStyle: "none", fontSize: 13 }}>
                    {shopping.map(s => (
                      <li
                        key={s.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: 4
                        }}
                      >
                        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <input
                            type="checkbox"
                            checked={s.taken}
                            onChange={() => toggleTaken(s.id)}
                          />
                          <span
                            style={{
                              textDecoration: s.taken ? "line-through" : "none",
                              color: s.taken ? palette.textMuted : palette.appText
                            }}
                          >
                            {s.name} ({s.qty} {s.unit})
                          </span>
                        </label>
                        <button
                          style={{
                            ...baseStyles.ghostButton,
                            borderColor: palette.buttonGhostBorder,
                            color: palette.appText
                          }}
                          onClick={() => removeShopping(s.id)}
                        >
                          X
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p style={{ fontSize: 12, color: palette.textMuted }}>
                    Prodotti ancora da acquistare: {toBuy}
                  </p>
                  <button
                    style={{
                      ...baseStyles.primaryButton,
                      background: palette.buttonPrimaryBg,
                      color: palette.buttonPrimaryText
                    }}
                    onClick={confirmToPantry}
                  >
                    Conferma acquisti → dispensa
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ----------------- Pasti & Pianificazione -----------------

  function renderMeals() {
    const weekDates = getWeekDates(planViewDate);

    function saveMeal() {
      if (!mealForm.name.trim()) return;
      const ingredients = parseIngredients(mealForm.ingredientsText);
      if (editingMealId) {
        setMeals(prev =>
          prev.map(m =>
            m.id === editingMealId
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
      setMealForm({ name: "", type: MEAL_TYPES[0], variant: "", ingredientsText: "" });
      setEditingMealId(null);
    }

    function editMeal(m) {
      setEditingMealId(m.id);
      setMealForm({
        name: m.name,
        type: m.type,
        variant: m.variant,
        ingredientsText: m.ingredients
          .map(i => `${i.name}=${i.qty}=${i.unit}`)
          .join("; ")
      });
    }

    function deleteMeal(id) {
      setMeals(prev => prev.filter(m => m.id !== id));
      setMealPlans(prev => prev.filter(p => p.mealId !== id));
      if (editingMealId === id) {
        setEditingMealId(null);
        setMealForm({
          name: "",
          type: MEAL_TYPES[0],
          variant: "",
          ingredientsText: ""
        });
      }
    }

    function addPlan() {
      if (!planForm.mealId) return;
      const mealId = Number(planForm.mealId);
      const meal = meals.find(m => m.id === mealId);
      if (meal && meal.ingredients && meal.ingredients.length) {
        adjustPantryForIngredients(meal.ingredients, -1);
      }
      setMealPlans(prev => [
        ...prev,
        {
          id: nextId(prev),
          date: planForm.date,
          userId: Number(planForm.userId),
          mealId,
          slot: planForm.slot
        }
      ]);
    }

    function removePlan(id) {
      setMealPlans(prev => {
        const plan = prev.find(p => p.id === id);
        if (plan) {
          const meal = meals.find(m => m.id === plan.mealId);
          if (meal && meal.ingredients && meal.ingredients.length) {
            adjustPantryForIngredients(meal.ingredients, 1);
          }
        }
        return prev.filter(p => p.id !== id);
      });
    }

    function changeWeek(delta) {
      setPlanViewDate(addDays(planViewDate, delta * 7));
    }

    const plansByDateSlot = {};
    mealPlans.forEach(p => {
      const key = p.date + "|" + p.slot;
      if (!plansByDateSlot[key]) plansByDateSlot[key] = [];
      plansByDateSlot[key].push(p);
    });

    const userOptions = [
      { id: 0, name: "Famiglia" },
      ...users.map(u => ({ id: u.id, name: u.name }))
    ];

    const allPlansSorted = [...mealPlans].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      const sa = slotOrder[a.slot] ?? 99;
      const sb = slotOrder[b.slot] ?? 99;
      if (sa !== sb) return sa - sb;
      return getUserName(a.userId).localeCompare(getUserName(b.userId));
    });

    return (
      <div>
        <h2 style={baseStyles.pageTitle}>Pasti &amp; pianificazione</h2>
        <p style={{ ...baseStyles.pageSubtitle, color: palette.textMuted }}>
          Censisci i piatti e pianifica i pasti settimanali per gli utenti o per la famiglia.
        </p>
        <div style={baseStyles.twoCols}>
          {/* Colonna piatti */}
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
                  {editingMealId ? "Modifica piatto" : "Nuovo piatto"}
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
                  Variante (es. pomodoro, bianca...)
                </label>
                <input
                  style={{
                    ...baseStyles.input,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={mealForm.variant}
                  onChange={e => setMealForm(f => ({ ...f, variant: e.target.value }))}
                />
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>
                  Ingredienti (nome=quantità=unità; ...)
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
                {editingMealId ? "Salva modifiche" : "Salva piatto"}
              </button>
              {editingMealId && (
                <button
                  style={{
                    ...baseStyles.ghostButton,
                    borderColor: palette.buttonGhostBorder,
                    color: palette.appText
                  }}
                  onClick={() => {
                    setEditingMealId(null);
                    setMealForm({
                      name: "",
                      type: MEAL_TYPES[0],
                      variant: "",
                      ingredientsText: ""
                    });
                  }}
                >
                  Annulla
                </button>
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
                <span style={baseStyles.cardTitle}>Piatti censiti</span>
              </div>
              {meals.length === 0 ? (
                <p style={{ fontSize: 13, color: palette.textMuted }}>
                  Nessun piatto inserito.
                </p>
              ) : (
                <ul style={{ paddingLeft: 18, fontSize: 13 }}>
                  {meals.map(m => (
                    <li key={m.id} style={{ marginBottom: 4 }}>
                      <strong>{m.name}</strong>{" "}
                      <span style={{ color: palette.textMuted }}>
                        ({m.type}
                        {m.variant ? ", " + m.variant : ""})
                      </span>
                      <button
                        style={{
                          ...baseStyles.ghostButton,
                          marginLeft: 6,
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
                          marginLeft: 4,
                          borderColor: palette.buttonGhostBorder,
                          color: palette.appText
                        }}
                        onClick={() => deleteMeal(m.id)}
                      >
                        X
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Colonna pianificazione */}
          <div style={baseStyles.col}>
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
                  value={planForm.date}
                  onChange={e => setPlanForm(f => ({ ...f, date: e.target.value }))}
                />
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>Pasto</label>
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
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>Utente</label>
                <select
                  style={{
                    ...baseStyles.select,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={planForm.userId}
                  onChange={e => setPlanForm(f => ({ ...f, userId: Number(e.target.value) }))}
                >
                  <option value={0}>Famiglia</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
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
                  <option value="">Seleziona piatto...</option>
                  {meals.map(m => (
                    <option key={m.id} value={m.id}>
                      {getMealFullName(m.id)}
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
                onClick={addPlan}
              >
                Aggiungi pianificazione
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
                <span style={baseStyles.cardTitle}>Settimana pianificata</span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 6,
                  fontSize: 12
                }}
              >
                <button
                  style={{
                    ...baseStyles.ghostButton,
                    borderColor: palette.buttonGhostBorder,
                    color: palette.appText
                  }}
                  onClick={() => changeWeek(-1)}
                >
                  ←
                </button>
                <span>
                  {weekDates[0]} - {weekDates[6]}
                </span>
                <button
                  style={{
                    ...baseStyles.ghostButton,
                    borderColor: palette.buttonGhostBorder,
                    color: palette.appText
                  }}
                  onClick={() => changeWeek(1)}
                >
                  →
                </button>
              </div>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 11,
                  border: "1px solid " + palette.tableBorder
                }}
              >
                <thead>
                  <tr>
                    <th
                      style={{
                        padding: 4,
                        borderBottom: "1px solid " + palette.tableBorder,
                        background: palette.tableHeaderBg
                      }}
                    >
                      Pasto
                    </th>
                    {weekDates.map(d => (
                      <th
                        key={d}
                        style={{
                          padding: 4,
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
                          padding: 4,
                          fontWeight: 600
                        }}
                      >
                        {slot}
                      </td>
                      {weekDates.map(d => {
                        const key = d + "|" + slot;
                        const plans = plansByDateSlot[key] || [];
                        return (
                          <td
                            key={d}
                            style={{
                              border: "1px solid " + palette.tableBorder,
                              padding: 4,
                              verticalAlign: "top"
                            }}
                          >
                            {plans.length === 0 ? (
                              <span style={{ color: palette.textMuted }}>-</span>
                            ) : (
                              plans.map(p => (
                                <div
                                  key={p.id}
                                  style={{
                                    marginBottom: 2,
                                    display: "flex",
                                    justifyContent: "space-between",
                                    gap: 4
                                  }}
                                >
                                  <span>
                                    {getMealFullName(p.mealId)}{" "}
                                    <span style={{ color: palette.textMuted }}>
                                      ({p.userId === 0 ? "Famiglia" : getUserName(p.userId)})
                                    </span>
                                  </span>
                                  <button
                                    style={{
                                      ...baseStyles.ghostButton,
                                      borderColor: palette.buttonGhostBorder,
                                      color: palette.appText
                                    }}
                                    onClick={() => removePlan(p.id)}
                                  >
                                    X
                                  </button>
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

            <div
              style={{
                ...baseStyles.card,
                background: palette.cardBg,
                border: "1px solid " + palette.cardBorder
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>Elenco pianificazioni</span>
              </div>
              {allPlansSorted.length === 0 ? (
                <p style={{ fontSize: 13, color: palette.textMuted }}>
                  Nessun pasto pianificato.
                </p>
              ) : (
                <ul style={{ paddingLeft: 18, fontSize: 13 }}>
                  {allPlansSorted.map(p => (
                    <li key={p.id}>
                      <strong>
                        {p.date} - {p.slot}
                      </strong>{" "}
                      {getMealFullName(p.mealId)}{" "}
                      <span style={{ color: palette.textMuted }}>
                        ({p.userId === 0 ? "Famiglia" : getUserName(p.userId)})
                      </span>
                      <button
                        style={{
                          ...baseStyles.ghostButton,
                          marginLeft: 6,
                          borderColor: palette.buttonGhostBorder,
                          color: palette.appText
                        }}
                        onClick={() => removePlan(p.id)}
                      >
                        X
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

  // ----------------- Compiti & Paghette -----------------

  function renderChores() {
    function addChore() {
      if (!choresForm.title.trim()) return;
      setChores(prev => [
        ...prev,
        {
          id: nextId(prev),
          title: choresForm.title.trim(),
          deadline: choresForm.deadline,
          userId: Number(choresForm.userId),
          amount: Number(choresForm.amount) || 0,
          done: false
        }
      ]);
      setChoresForm({ title: "", deadline: todayStr(), userId: 1, amount: 1 });
    }

    function toggleDone(id) {
      setChores(prev => {
        const next = prev.map(c =>
          c.id === id ? { ...c, done: !c.done } : c
        );
        const chore = prev.find(c => c.id === id);
        if (chore && !chore.done) {
          const amount = Number(chore.amount) || 0;
          if (amount > 0) {
            setUsers(us =>
              us.map(u =>
                u.id === chore.userId ? { ...u, balance: (u.balance || 0) + amount } : u
              )
            );
            setTransactions(tr => [
              ...tr,
              {
                id: nextId(tr),
                userId: chore.userId,
                type: "accredito",
                amount,
                date: todayStr(),
                note: "Compito: " + chore.title
              }
            ]);
          }
        }
        return next;
      });
    }

    function payUser(userId) {
      const input = paymentInputs[userId];
      const amount = Number(input);
      if (!amount || amount <= 0) return;
      const user = users.find(u => u.id === userId);
      if (!user) return;
      const maxPayable = user.balance || 0;
      const realAmount = Math.min(amount, maxPayable);
      if (realAmount <= 0) return;
      setUsers(prev =>
        prev.map(u =>
          u.id === userId ? { ...u, balance: (u.balance || 0) - realAmount } : u
        )
      );
      setTransactions(prev => [
        ...prev,
        {
          id: nextId(prev),
          userId,
          type: "pagamento",
          amount: realAmount,
          date: todayStr(),
          note: "Pagamento paghetta"
        }
      ]);
      setPaymentInputs(prev => ({ ...prev, [userId]: "" }));
    }

    const choresSorted = [...chores].sort((a, b) => a.deadline.localeCompare(b.deadline));
    const usersWithBalance = users.filter(u => (u.balance || 0) > 0);

    return (
      <div>
        <h2 style={baseStyles.pageTitle}>Compiti &amp; paghette</h2>
        <p style={{ ...baseStyles.pageSubtitle, color: palette.textMuted }}>
          Assegna compiti, riconosci paghette e gestisci i pagamenti.
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
                  onChange={e => setChoresForm(f => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div style={baseStyles.formRow}>
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>Scadenza</label>
                <input
                  type="date"
                  style={{
                    ...baseStyles.input,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={choresForm.deadline}
                  onChange={e => setChoresForm(f => ({ ...f, deadline: e.target.value }))}
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
                  value={choresForm.userId}
                  onChange={e =>
                    setChoresForm(f => ({ ...f, userId: Number(e.target.value) }))
                  }
                >
                  {users.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
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
                    setChoresForm(f => ({ ...f, amount: Number(e.target.value) || 0 }))
                  }
                />
              </div>
              <button
                style={{
                  ...baseStyles.primaryButton,
                  background: palette.buttonPrimaryBg,
                  color: palette.buttonPrimaryText
                }}
                onClick={addChore}
              >
                Aggiungi compito
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
                  Nessun compito inserito.
                </p>
              ) : (
                <ul style={{ paddingLeft: 18, fontSize: 13 }}>
                  {choresSorted.map(c => (
                    <li key={c.id} style={{ marginBottom: 4 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={c.done}
                          onChange={() => toggleDone(c.id)}
                        />
                        <span
                          style={{
                            textDecoration: c.done ? "line-through" : "none",
                            color: c.done ? palette.textMuted : palette.appText
                          }}
                        >
                          {c.title} ({getUserName(c.userId)}) - scade il {c.deadline} - {" "}
                          {c.amount.toFixed(2)} €
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
                border: "1px solid " + palette.cardBorder
              }}
            >
              <div style={baseStyles.cardHeaderRow}>
                <span style={baseStyles.cardTitle}>Pagamenti paghette</span>
              </div>
              {usersWithBalance.length === 0 ? (
                <p style={{ fontSize: 13, color: palette.textMuted }}>
                  Nessun saldo da pagare.
                </p>
              ) : (
                <ul style={{ paddingLeft: 18, fontSize: 13 }}>
                  {usersWithBalance.map(u => (
                    <li key={u.id} style={{ marginBottom: 6 }}>
                      <div>
                        <strong>{u.name}</strong> - saldo {u.balance.toFixed(2)} €
                      </div>
                      <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                        <input
                          type="number"
                          placeholder="Importo"
                          style={{
                            ...baseStyles.input,
                            flex: 1,
                            background: palette.inputBg,
                            borderColor: palette.inputBorder,
                            color: palette.appText
                          }}
                          value={paymentInputs[u.id] || ""}
                          onChange={e =>
                            setPaymentInputs(prev => ({
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
                          onClick={() => payUser(u.id)}
                        >
                          Paga
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
                <span style={baseStyles.cardTitle}>Storico movimenti</span>
              </div>
              {transactions.length === 0 ? (
                <p style={{ fontSize: 13, color: palette.textMuted }}>
                  Nessun movimento registrato.
                </p>
              ) : (
                <ul style={{ paddingLeft: 18, fontSize: 13 }}>
                  {transactions
                    .slice()
                    .reverse()
                    .slice(0, 20)
                    .map(t => (
                      <li key={t.id}>
                        <strong>{t.date}</strong> - {t.type === "accredito" ? "+" : "-"}
                        {t.amount.toFixed(2)} € a {getUserName(t.userId)} ({t.note})
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

  // ----------------- ToDo List -----------------

  function renderTodos() {
    function addTodo() {
      if (!todoForm.title.trim()) return;
      setTodos(prev => [
        ...prev,
        {
          id: nextId(prev),
          title: todoForm.title.trim(),
          userId: Number(todoForm.userId),
          done: false
        }
      ]);
      setTodoForm({ title: "", userId: 1 });
    }

    function toggleTodo(id) {
      setTodos(prev => prev.map(t => (t.id === id ? { ...t, done: !t.done } : t)));
    }

    const visibleTodos = todos.filter(t => (showCompletedTodos ? true : !t.done));

    return (
      <div>
        <h2 style={baseStyles.pageTitle}>Cose da fare (ToDo List)</h2>
        <p style={{ ...baseStyles.pageSubtitle, color: palette.textMuted }}>
          Promemoria semplici, anche assegnati a un utente. Le attività completate vengono
          archiviate.
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
                <label style={{ ...baseStyles.label, color: palette.textMuted }}>Titolo</label>
                <input
                  style={{
                    ...baseStyles.input,
                    background: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.appText
                  }}
                  value={todoForm.title}
                  onChange={e => setTodoForm(f => ({ ...f, title: e.target.value }))}
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
                  onChange={e => setTodoForm(f => ({ ...f, userId: Number(e.target.value) }))}
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
                onClick={addTodo}
              >
                Aggiungi promemoria
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
                <span style={baseStyles.cardTitle}>Elenco cose da fare</span>
                <label style={{ fontSize: 12, color: palette.textMuted }}>
                  <input
                    type="checkbox"
                    checked={showCompletedTodos}
                    onChange={e => setShowCompletedTodos(e.target.checked)}
                    style={{ marginRight: 4 }}
                  />
                  Mostra anche completate
                </label>
              </div>
              {visibleTodos.length === 0 ? (
                <p style={{ fontSize: 13, color: palette.textMuted }}>
                  Nessun promemoria da mostrare.
                </p>
              ) : (
                <ul style={{ paddingLeft: 18, fontSize: 13 }}>
                  {visibleTodos.map(t => (
                    <li key={t.id} style={{ marginBottom: 4 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={t.done}
                          onChange={() => toggleTodo(t.id)}
                        />
                        <span
                          style={{
                            textDecoration: t.done ? "line-through" : "none",
                            color: t.done ? palette.textMuted : palette.appText
                          }}
                        >
                          {t.title} ({getUserName(t.userId)})
                        </span>
                      </label>
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
    function toggleTheme() {
      setSettings(prev => ({
        ...prev,
        theme: prev.theme === "dark" ? "light" : "dark"
      }));
    }

    function toggleNotif(key) {
      setSettings(prev => ({
        ...prev,
        notifications: { ...prev.notifications, [key]: !prev.notifications[key] }
      }));
    }

    return (
      <div>
        <h2 style={baseStyles.pageTitle}>Impostazioni</h2>
        <p style={{ ...baseStyles.pageSubtitle, color: palette.textMuted }}>
          Personalizza il tema e le modalità di notifica.
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
              <p style={{ fontSize: 13, color: palette.textMuted }}>
                Scegli tra tema scuro e tema chiaro.
              </p>
              <button
                style={{
                  ...baseStyles.primaryButton,
                  background: palette.buttonPrimaryBg,
                  color: palette.buttonPrimaryText
                }}
                onClick={toggleTheme}
              >
                Passa a tema {settings.theme === "dark" ? "chiaro" : "scuro"}
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
                <span style={baseStyles.cardTitle}>Notifiche (simboliche)</span>
              </div>
              <p style={{ fontSize: 13, color: palette.textMuted }}>
                Qui puoi indicare come preferiresti ricevere le notifiche. In questa anteprima
                non vengono ancora inviate realmente, ma le preferenze sono salvate.
              </p>
              <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
                <input
                  type="checkbox"
                  checked={settings.notifications.email}
                  onChange={() => toggleNotif("email")}
                  style={{ marginRight: 4 }}
                />
                Email
              </label>
              <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
                <input
                  type="checkbox"
                  checked={settings.notifications.whatsapp}
                  onChange={() => toggleNotif("whatsapp")}
                  style={{ marginRight: 4 }}
                />
                WhatsApp
              </label>
              <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
                <input
                  type="checkbox"
                  checked={settings.notifications.popup}
                  onChange={() => toggleNotif("popup")}
                  style={{ marginRight: 4 }}
                />
                Notifiche a schermo (popup)
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

  let content = null;
  if (activeNav === "Home") content = renderHome();
  else if (activeNav === "Utenti") content = renderUsers();
  else if (activeNav === "Calendario") content = renderCalendar();
  else if (activeNav === "Scadenze") content = renderDeadlines();
  else if (activeNav === "Dispensa") content = renderPantry();
  else if (activeNav === "Lista spesa") content = renderShopping();
  else if (activeNav === "Pasti") content = renderMeals();
  else if (activeNav === "Compiti & paghette") content = renderChores();
  else if (activeNav === "ToDo List") content = renderTodos();
  else if (activeNav === "Impostazioni") content = renderSettings();

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
                background: "rgba(15,23,42,0.18)",
                color: palette.headerText
              }}
            >
              FH
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>Family Hub</div>
              <div style={{ fontSize: 12, opacity: 0.85 }}>
                Gestione familiare: agenda, spesa, pasti e paghette.
              </div>
            </div>
          </div>
          <div style={baseStyles.headerRight}>
            <span style={{ fontSize: 12 }}>Ciao, {currentUser.name}</span>
            <button
              style={{
                ...baseStyles.ghostButton,
                borderColor: "rgba(248,250,252,0.7)",
                color: palette.headerText,
                background: "transparent"
              }}
              onClick={handleLogout}
            >
              Esci
            </button>
          </div>
        </header>

        <div style={baseStyles.body}>
          <aside
            style={{
              ...baseStyles.sidebar,
              background: palette.sidebarBg,
              borderRight: "1px solid " + palette.sidebarBorder
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8
              }}
            >
              <span style={{ fontSize: 12, color: palette.textMuted }}>Navigazione</span>
              <button
                style={{
                  ...baseStyles.ghostButton,
                  borderColor: palette.buttonGhostBorder,
                  color: palette.appText,
                  padding: "2px 8px",
                  fontSize: 11
                }}
                onClick={() =>
                  setSettings(prev => ({
                    ...prev,
                    theme: prev.theme === "dark" ? "light" : "dark"
                  }))
                }
              >
                {settings.theme === "dark" ? "Chiaro" : "Scuro"}
              </button>
            </div>
            <ul style={baseStyles.navList}>
              {NAV_ITEMS.map(item => {
                const active = activeNav === item;
                return (
                  <li key={item}>
                    <button
                      style={{
                        ...baseStyles.navButton,
                        background: active ? palette.navActiveBg : "transparent",
                        color: active ? palette.navActiveText : palette.appText
                      }}
                      onClick={() => setActiveNav(item)}
                    >
                      {item}
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          <main
            style={{
              ...baseStyles.main,
              background: palette.mainBg
            }}
          >
            {content}
          </main>
        </div>
      </div>
    </div>
  );
}

export default FamilyHubApp;
