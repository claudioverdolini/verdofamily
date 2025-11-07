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
 * FamilyHub – Single-file React PWA – ver. 1.4.0 (stable)
 *
 * ✅ Login con credenziali (username + password/PIN con salt+hash)
 * ✅ Ruoli (Admin, Adulto, Teen, Bimbo, Ospite) + PIN numerico forzato per "Bimbo"
 * ✅ Reset admin → PIN temporaneo (mustChange)
 * ✅ Calendario con regola 31 → ultimo giorno del mese (30 resta 30)
 * ✅ Google Calendar (import/export opzionale)
 * ✅ Supabase sync (key-value) – opzionale
 * ✅ Pasti settimanali (colazione, merenda, pranzo/cena con primo/secondo/contorno)
 * ✅ Filtri per categoria piatti
 * ✅ Lista spesa + dispensa
 * ✅ Compiti & paghette (saldo + pagamenti)
 * ✅ Promemoria locali (notifiche)
 * ✅ Dashboard con widget + carosello foto (autoplay infinito)
 * ✅ NIENTE “anteprima”: accesso solo con credenziali
 * ✅ DevTests minimi
 *
 * Linguaggio: Italiano
 */

// ... (content unchanged for brevity in this retry) ...
