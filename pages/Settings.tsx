import React, { useEffect, useState } from 'react'
import { BellRing, CalendarDays, Camera, Check, ClipboardCopy, Cloud, Download, Flame, Heart, Image as ImageIcon, ImagePlus, Leaf, Link2, Moon, RefreshCw, RotateCcw, Sparkles, Unlink, Upload, Waves, Zap } from 'lucide-react'
import { useFamily } from '../store'
import { supabase } from '../supabaseClient'
import type { PageKey, ThemeMode } from '../types'
import { Avatar, Button, Card, CardHeader, Field, PageIntro, Segmented } from '../ui'
import TelegramReportsCard from '../components/TelegramReportsCard'
import { imageFileToAvatarDataUrl, imageFileToBackgroundDataUrl } from '../utils'
import { BACKGROUND_PRESETS } from '../backgrounds'
import { disablePush, enablePush, getPushStatus, sendPushTest, syncPushTopics, type PushStatus, type PushTopics } from '../pushNotifications'

const VISUAL_STYLES = [
  { id: 'violet', name: 'Violet Pop', subtitle: 'Viola + lilla', primary: '#635BFF', secondary: '#A855F7', Icon: Sparkles },
  { id: 'ocean', name: 'Oceano', subtitle: 'Blu + turchese', primary: '#0284C7', secondary: '#06B6D4', Icon: Waves },
  { id: 'emerald', name: 'Smeraldo', subtitle: 'Verde + menta', primary: '#059669', secondary: '#22C55E', Icon: Leaf },
  { id: 'sunset', name: 'Tramonto', subtitle: 'Arancio + corallo', primary: '#F97316', secondary: '#F43F5E', Icon: Flame },
  { id: 'berry', name: 'Berry', subtitle: 'Fucsia + viola', primary: '#C026D3', secondary: '#7C3AED', Icon: Heart },
  { id: 'coral', name: 'Corallo', subtitle: 'Rosso + rosa', primary: '#E11D48', secondary: '#FB7185', Icon: Heart },
  { id: 'midnight', name: 'Notte', subtitle: 'Ardesia + indaco', primary: '#334155', secondary: '#6366F1', Icon: Moon },
  { id: 'electric', name: 'Electric', subtitle: 'Blu + violetto', primary: '#2563EB', secondary: '#8B5CF6', Icon: Zap }
] as const

const BACKGROUND_COLORS = [
  { name: 'Ghiaccio', value: '#EEF6FF' },
  { name: 'Neutro', value: '#F4F6F8' },
  { name: 'Sabbia', value: '#FFF4E6' },
  { name: 'Salvia', value: '#EDF7F0' },
  { name: 'Rosa', value: '#FFF0F4' },
  { name: 'Lavanda', value: '#F5F0FF' }
] as const

const TAB_OPTIONS: Array<{ key: PageKey; label: string }> = [
  { key: 'home', label: 'Home' },
  { key: 'calendar', label: 'Calendario' },
  { key: 'shopping', label: 'Spesa' },
  { key: 'meals', label: 'Pasti' },
  { key: 'chores', label: 'Paghette' },
  { key: 'school', label: 'Scuola' },
  { key: 'board', label: 'Bacheca' },
  { key: 'deadlines', label: 'Scadenze' },
  { key: 'todos', label: 'ToDo' },
  { key: 'reports', label: 'Report' },
  { key: 'users', label: 'Utenti' }
]

const HOME_CARDS = [
  { key: 'today', label: 'Calendario' },
  { key: 'shopping', label: 'Spesa' },
  { key: 'meals', label: 'Pasti' },
  { key: 'school', label: 'Scuola' },
  { key: 'board', label: 'Bacheca' },
  { key: 'deadlines', label: 'Scadenze' },
  { key: 'todos', label: 'Da fare' },
  { key: 'wallets', label: 'Paghette' },
  { key: 'health', label: 'Salute' }
] as const

const BACKUP_MAX_AGE_MS = 24 * 60 * 60 * 1000
const BACKUP_REFRESH_MS = 5 * 60 * 1000

type DriveBackupStatus = {
  enabled: boolean
  last_attempt_at: string | null
  last_success_at: string | null
  last_error: string | null
}

type BackupHistoryItem = {
  id: number
  revision: number
  reason: string
  created_at: string
}

type BackupHealth = {
  ok: boolean
  title: string
  detail: string
}

type RecycleBinItem = {
  id: string
  module: string
  label: string
  payload: any
  deleted_at: string
  deleted_by?: string | null
}

type ConflictDraftItem = {
  id: string
  actor_user_id: string
  base_revision: number
  remote_revision: number
  data: any
  created_at: string
}

type ChangeHistoryItem = {
  id: number
  actor_user_id?: string | null
  event_type: string
  success: boolean
  severity: string
  metadata: Record<string, any>
  created_at: string
}

type GoogleCalendarChoice = {
  id: string
  summary: string
  primary?: boolean
  accessRole?: string
  timeZone?: string
}

type GoogleCalendarStatus = {
  configured: boolean
  connected: boolean
  redirectUri?: string
  connection?: {
    googleEmail?: string
    personalCalendarId?: string
    personalCalendarName?: string
    familyCalendarId?: string
    familyCalendarName?: string
    familyEventTarget?: 'personal' | 'shared' | 'both'
  } | null
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Mai'
  try {
    return new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  } catch {
    return value
  }
}

function backupReason(reason: string) {
  if (reason === 'google_drive_export') return 'Backup automatico Drive'
  if (reason === 'manual_google_drive_export') return 'Backup manuale Drive'
  if (reason === 'pre_restore') return 'Prima di un ripristino'
  if (reason === 'pre_save') return 'Versione precedente'
  return reason || 'Backup'
}

function getBackupHealth(status: DriveBackupStatus | null): BackupHealth {
  if (!status) {
    return { ok: false, title: '⚠️ Backup non verificato', detail: 'In attesa del controllo Google Drive.' }
  }
  if (!status.enabled) {
    return { ok: false, title: '⚠️ Backup da configurare', detail: 'Il backup automatico Google Drive non risulta attivo.' }
  }
  if (status.last_error) {
    return { ok: false, title: '⚠️ Backup da verificare', detail: `Ultimo errore: ${status.last_error}` }
  }
  if (!status.last_success_at) {
    return { ok: false, title: '⚠️ Backup da verificare', detail: 'Nessun backup Google Drive riuscito registrato.' }
  }

  const lastSuccess = new Date(status.last_success_at).getTime()
  if (!Number.isFinite(lastSuccess)) {
    return { ok: false, title: '⚠️ Backup da verificare', detail: 'La data dell’ultimo backup non è valida.' }
  }

  const ageMs = Math.max(0, Date.now() - lastSuccess)
  if (ageMs > BACKUP_MAX_AGE_MS) {
    const hours = Math.floor(ageMs / (60 * 60 * 1000))
    return {
      ok: false,
      title: '⚠️ Backup da verificare',
      detail: `Ultimo Drive: ${formatDateTime(status.last_success_at)} · ${hours} ore fa.`
    }
  }

  return {
    ok: true,
    title: '✅ Backup protetto',
    detail: `Ultimo Drive: ${formatDateTime(status.last_success_at)}`
  }
}

export default function SettingsPage() {
  const {
    data,
    authUser,
    updateCurrentPrefs,
    updateCurrentProfile,
    setAssistantName,
    exportData,
    importData,
    resetData,
    cloudAuthenticated,
    familyId,
    syncNow,
    restoreRecycleItem,
    recoverConflictDraft
  } = useFamily()
  const [importText, setImportText] = useState('')
  const [message, setMessage] = useState('')
  const [driveStatus, setDriveStatus] = useState<DriveBackupStatus | null>(null)
  const [backupHistory, setBackupHistory] = useState<BackupHistoryItem[]>([])
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupLoading, setBackupLoading] = useState(false)
  const [googleStatus, setGoogleStatus] = useState<GoogleCalendarStatus | null>(null)
  const [googleCalendars, setGoogleCalendars] = useState<GoogleCalendarChoice[]>([])
  const [googleBusy, setGoogleBusy] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [backgroundBusy, setBackgroundBusy] = useState(false)
  const [googleMessage, setGoogleMessage] = useState('')
  const [googleDraft, setGoogleDraft] = useState({ personalCalendarId: 'primary', familyCalendarId: '', familyEventTarget: 'personal' as 'personal' | 'shared' | 'both' })
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushMessage, setPushMessage] = useState('')
  const [recycleItems, setRecycleItems] = useState<RecycleBinItem[]>([])
  const [conflictDrafts, setConflictDrafts] = useState<ConflictDraftItem[]>([])
  const [changeHistory, setChangeHistory] = useState<ChangeHistoryItem[]>([])
  const [safetyBusy, setSafetyBusy] = useState<string | null>(null)

  const prefs = authUser?.prefs
  const pushTopics: PushTopics = {
    calendar: prefs?.notifications?.calendar !== false,
    deadlines: prefs?.notifications?.deadlines !== false,
    chores: prefs?.notifications?.chores !== false,
    school: prefs?.notifications?.school !== false,
    board: prefs?.notifications?.board !== false,
    shopping: prefs?.notifications?.shopping !== false
  }
  const backupHealth = getBackupHealth(driveStatus)

  async function changeAvatar(file?: File) {
    if (!file) return
    setAvatarBusy(true)
    try {
      const avatarUrl = await imageFileToAvatarDataUrl(file)
      updateCurrentProfile({ avatarUrl })
    } catch (error: any) {
      setMessage(error?.message || 'Impossibile elaborare la foto.')
    } finally {
      setAvatarBusy(false)
    }
  }

  async function changeBackground(file?: File) {
    if (!file) return
    setBackgroundBusy(true)
    setMessage('')
    try {
      const backgroundImage = await imageFileToBackgroundDataUrl(file)
      updateCurrentPrefs({ backgroundImage, backgroundPreset: 'custom' })
      setMessage('Sfondo personalizzato applicato.')
    } catch (error: any) {
      setMessage(error?.message || 'Impossibile elaborare lo sfondo.')
    } finally {
      setBackgroundBusy(false)
    }
  }

  function removeCustomBackground() {
    if (!prefs?.backgroundImage) return
    if (!confirm('Rimuovere definitivamente la foto di sfondo personalizzata?')) return
    updateCurrentPrefs({ backgroundImage: undefined, backgroundPreset: 'none' })
    setMessage('Foto di sfondo rimossa.')
  }

  useEffect(() => {
    void refreshBackupStatus()
    void refreshGoogleCalendar()
    void refreshSafetyData()
    const params = new URLSearchParams(window.location.search)
    const googleResult = params.get('googleCalendar')
    if (googleResult === 'connected') setGoogleMessage('Google Calendar collegato. Scegli ora dove sincronizzare gli eventi.')
    if (googleResult === 'error') setGoogleMessage(`Collegamento Google non riuscito${params.get('reason') ? `: ${params.get('reason')}` : '.'}`)
    if (googleResult) window.history.replaceState({}, '', window.location.pathname)
  }, [familyId, cloudAuthenticated])

  useEffect(() => {
    if (!familyId || !cloudAuthenticated) return
    const timer = window.setInterval(() => {
      void refreshBackupStatus()
    }, BACKUP_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [familyId, cloudAuthenticated])

  useEffect(() => {
    if (!familyId || !cloudAuthenticated) {
      setPushStatus(null)
      return
    }
    void getPushStatus(familyId).then(setPushStatus).catch(() => setPushStatus(null))
  }, [familyId, cloudAuthenticated])

  useEffect(() => {
    void refreshSafetyData()
  }, [familyId, cloudAuthenticated, authUser?.role])

  useEffect(() => {
    if (!familyId || !cloudAuthenticated || !pushStatus?.subscribed) return
    void syncPushTopics(familyId, pushTopics).catch(() => {})
  }, [
    familyId,
    cloudAuthenticated,
    pushStatus?.subscribed,
    prefs?.notifications?.calendar,
    prefs?.notifications?.deadlines,
    prefs?.notifications?.chores,
    prefs?.notifications?.school,
    prefs?.notifications?.board,
    prefs?.notifications?.shopping
  ])

  if (!authUser || !prefs) return null

  async function refreshPushStatus() {
    if (!familyId || !cloudAuthenticated) {
      setPushStatus(null)
      return
    }
    try {
      setPushStatus(await getPushStatus(familyId))
    } catch {
      setPushStatus(null)
    }
  }

  async function activatePush() {
    if (!familyId) return
    setPushBusy(true)
    setPushMessage('')
    try {
      await enablePush(familyId, pushTopics)
      await refreshPushStatus()
      setPushMessage('Notifiche push attivate su questo dispositivo.')
    } catch (error: any) {
      setPushMessage(error?.message || 'Attivazione notifiche non riuscita.')
    } finally {
      setPushBusy(false)
    }
  }

  async function deactivatePush() {
    if (!familyId) return
    if (!confirm('Disattivare le notifiche push su questo dispositivo?')) return
    setPushBusy(true)
    setPushMessage('')
    try {
      await disablePush(familyId)
      await refreshPushStatus()
      setPushMessage('Notifiche push disattivate su questo dispositivo.')
    } catch (error: any) {
      setPushMessage(error?.message || 'Disattivazione notifiche non riuscita.')
    } finally {
      setPushBusy(false)
    }
  }

  async function testPush() {
    if (!familyId) return
    setPushBusy(true)
    setPushMessage('')
    try {
      const result = await sendPushTest(familyId)
      setPushMessage(result?.sent ? 'Notifica di prova inviata.' : 'Test eseguito, ma il dispositivo non ha ricevuto la push.')
    } catch (error: any) {
      setPushMessage(error?.message || 'Test notifiche non riuscito.')
    } finally {
      setPushBusy(false)
    }
  }

  async function refreshBackupStatus() {
    if (!supabase || !familyId || !cloudAuthenticated) {
      setDriveStatus(null)
      setBackupHistory([])
      return
    }
    setBackupLoading(true)
    try {
      const [statusResult, historyResult] = await Promise.all([
        supabase.rpc('get_drive_backup_status', { p_family_id: familyId }),
        supabase
          .from('family_backups')
          .select('id,revision,reason,created_at')
          .eq('family_id', familyId)
          .order('created_at', { ascending: false })
          .limit(10)
      ])

      if (!statusResult.error) {
        const row = Array.isArray(statusResult.data) ? statusResult.data[0] : statusResult.data
        setDriveStatus(row || null)
      }
      if (!historyResult.error) setBackupHistory((historyResult.data || []) as BackupHistoryItem[])
    } finally {
      setBackupLoading(false)
    }
  }

  async function callGoogleCalendar(action: string, extra: Record<string, any> = {}) {
    if (!supabase || !familyId) throw new Error('Cloud non disponibile.')
    const { data: result, error } = await supabase.functions.invoke('google-calendar-sync', { body: { action, familyId, ...extra } })
    if (error) throw new Error(error.message || 'Errore Google Calendar')
    if (result?.error) throw new Error(result.error)
    return result
  }

  async function refreshGoogleCalendar() {
    if (!supabase || !familyId || !cloudAuthenticated) {
      setGoogleStatus(null)
      setGoogleCalendars([])
      return
    }
    setGoogleBusy(true)
    try {
      const status = await callGoogleCalendar('status') as GoogleCalendarStatus
      setGoogleStatus(status)
      const connection = status?.connection
      setGoogleDraft({
        personalCalendarId: connection?.personalCalendarId || 'primary',
        familyCalendarId: connection?.familyCalendarId || '',
        familyEventTarget: connection?.familyEventTarget || 'personal'
      })
      if (status?.connected) {
        const result = await callGoogleCalendar('calendars')
        setGoogleCalendars(result?.calendars || [])
      } else setGoogleCalendars([])
    } catch (error: any) {
      setGoogleMessage(`Google Calendar: ${error?.message || 'stato non disponibile'}`)
    } finally {
      setGoogleBusy(false)
    }
  }

  async function connectGoogleCalendar() {
    setGoogleBusy(true)
    setGoogleMessage('')
    try {
      const result = await callGoogleCalendar('auth-url')
      if (!result?.url) throw new Error('URL di collegamento non disponibile.')
      window.location.assign(result.url)
    } catch (error: any) {
      setGoogleMessage(`Collegamento non riuscito: ${error?.message || 'errore sconosciuto'}`)
      setGoogleBusy(false)
    }
  }

  async function saveGoogleCalendarSettings() {
    if ((googleDraft.familyEventTarget === 'shared' || googleDraft.familyEventTarget === 'both') && !googleDraft.familyCalendarId) {
      setGoogleMessage('Scegli prima un calendario famiglia condiviso.')
      return
    }
    setGoogleBusy(true)
    setGoogleMessage('')
    try {
      await callGoogleCalendar('save-settings', googleDraft)
      setGoogleMessage('Impostazioni Google Calendar salvate e calendario sincronizzato.')
      await refreshGoogleCalendar()
    } catch (error: any) {
      setGoogleMessage(`Salvataggio non riuscito: ${error?.message || 'errore sconosciuto'}`)
    } finally {
      setGoogleBusy(false)
    }
  }

  async function syncGoogleCalendarNow() {
    setGoogleBusy(true)
    setGoogleMessage('')
    try {
      await syncNow()
      const result = await callGoogleCalendar('sync-all')
      setGoogleMessage(`Google Calendar sincronizzato${typeof result?.synced === 'number' ? `: ${result.synced} collegamenti evento aggiornati` : ''}.`)
    } catch (error: any) {
      setGoogleMessage(`Sincronizzazione non riuscita: ${error?.message || 'errore sconosciuto'}`)
    } finally {
      setGoogleBusy(false)
    }
  }

  async function disconnectGoogleCalendar() {
    if (!confirm('Scollegare il tuo account Google Calendar da VerdoFamily? Gli eventi già copiati su Google non vengono cancellati.')) return
    setGoogleBusy(true)
    setGoogleMessage('')
    try {
      await callGoogleCalendar('disconnect')
      setGoogleMessage('Account Google Calendar scollegato.')
      await refreshGoogleCalendar()
    } catch (error: any) {
      setGoogleMessage(`Scollegamento non riuscito: ${error?.message || 'errore sconosciuto'}`)
    } finally {
      setGoogleBusy(false)
    }
  }

  async function runDriveBackup() {
    if (!supabase || !familyId) return
    setBackupBusy(true)
    setMessage('')
    try {
      await syncNow()
      const { data: result, error } = await supabase.functions.invoke('google-drive-backup-runner', {
        body: { familyId }
      })
      if (error) {
        setMessage(`Backup Google Drive non riuscito: ${error.message}`)
      } else if (result?.ok) {
        const fileName = result?.results?.[0]?.fileName
        setMessage(fileName ? `Backup Google Drive creato: ${fileName}` : 'Backup Google Drive creato correttamente.')
      } else {
        setMessage(`Backup Google Drive non riuscito: ${result?.error || result?.results?.[0]?.error || 'errore sconosciuto'}`)
      }
      await refreshBackupStatus()
    } catch (error: any) {
      setMessage(`Backup Google Drive non riuscito: ${error?.message || 'errore sconosciuto'}`)
    } finally {
      setBackupBusy(false)
    }
  }

  async function restoreBackup(item: BackupHistoryItem) {
    if (!supabase) return
    if (!confirm(`Ripristinare il backup revisione ${item.revision} del ${formatDateTime(item.created_at)}? Prima del ripristino verrà salvata automaticamente anche la situazione attuale.`)) return
    setBackupBusy(true)
    setMessage('')
    try {
      const { error } = await supabase.rpc('restore_family_backup', { p_backup_id: item.id })
      if (error) {
        setMessage(`Ripristino non riuscito: ${error.message}`)
      } else {
        setMessage('Backup ripristinato. I dispositivi collegati si aggiorneranno automaticamente.')
        await refreshBackupStatus()
      }
    } finally {
      setBackupBusy(false)
    }
  }

  function setTheme(theme: ThemeMode) {
    updateCurrentPrefs({ theme })
  }

  function applyCustomAccent(accent: string) {
    if (!accent) return
    const root = document.documentElement
    root.style.setProperty('--accent', accent)
    root.style.setProperty('--accent2', accent)
    root.style.setProperty('--accent-glow', accent)
    root.dataset.visualStyle = 'custom'
    updateCurrentPrefs({ accent, visualStyle: 'custom' as any })
  }

  function applyBackgroundColor(backgroundColor: string) {
    if (!/^#[0-9a-f]{6}$/i.test(backgroundColor)) return
    const normalized = backgroundColor.toUpperCase()
    const root = document.documentElement
    root.style.setProperty('--app-wallpaper', `linear-gradient(${normalized}, ${normalized})`)
    root.style.setProperty('--wallpaper-strength', '1')
    root.dataset.wallpaper = 'on'
    updateCurrentPrefs({ backgroundColor: normalized, backgroundPreset: 'color' as any })
  }

  function toggleBottomTab(key: PageKey) {
    updateCurrentPrefs(currentPrefs => {
      const current = currentPrefs.bottomTabs || []
      if (current.includes(key)) {
        if (current.length <= 1) return {}
        return { bottomTabs: current.filter(x => x !== key) }
      }
      if (current.length >= 4) return {}
      return { bottomTabs: [...current, key] }
    })
  }

  function moveTab(index: number, dir: -1 | 1) {
    const next = [...prefs.bottomTabs]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    updateCurrentPrefs({ bottomTabs: next })
  }

  function toggleHomeCard(key: typeof HOME_CARDS[number]['key']) {
    updateCurrentPrefs(currentPrefs => {
      const current = currentPrefs.homeCards || []
      if (current.includes(key)) {
        if (current.length <= 1) return {}
        return { homeCards: current.filter(x => x !== key) as any }
      }
      return { homeCards: [...current, key] as any }
    })
  }

  function historyLabel(type: string) {
    const labels: Record<string, string> = {
      family_document_saved: 'Salvataggio famiglia',
      family_document_conflict: 'Conflitto tra dispositivi',
      family_backup_created: 'Backup creato',
      family_backup_restored: 'Backup ripristinato',
      recycle_item_archived: 'Elemento spostato nel Cestino',
      recycle_item_restored: 'Elemento ripristinato dal Cestino',
      recycle_item_purged: 'Elemento eliminato definitivamente',
      family_conflict_draft_saved: 'Bozza conflitto salvata',
      family_conflict_draft_resolved: 'Bozza conflitto recuperata'
    }
    return labels[type] || type.replaceAll('_', ' ')
  }

  async function refreshSafetyData() {
    if (!supabase || !familyId || !cloudAuthenticated || authUser?.role === 'bimbo') {
      setRecycleItems([])
      setConflictDrafts([])
      setChangeHistory([])
      return
    }
    try {
      const [trashResult, conflictResult, historyResult] = await Promise.all([
        supabase.rpc('get_family_recycle_bin', { p_family_id: familyId, p_limit: 100 }),
        supabase.rpc('get_family_conflict_drafts', { p_family_id: familyId, p_limit: 20 }),
        supabase.rpc('get_family_change_history', { p_family_id: familyId, p_limit: 50 })
      ])
      if (!trashResult.error) setRecycleItems((trashResult.data || []) as RecycleBinItem[])
      if (!conflictResult.error) setConflictDrafts((conflictResult.data || []) as ConflictDraftItem[])
      if (!historyResult.error) setChangeHistory((historyResult.data || []) as ChangeHistoryItem[])
    } catch (error) {
      console.warn('refresh safety data', error)
    }
  }

  async function restoreRecycle(item: RecycleBinItem) {
    if (!confirm(`Ripristinare “${item.label}” dal Cestino?`)) return
    setSafetyBusy(item.id)
    try {
      const ok = await restoreRecycleItem(item.id, item.payload)
      setMessage(ok ? `“${item.label}” ripristinato.` : 'Ripristino non completato.')
      await refreshSafetyData()
    } finally {
      setSafetyBusy(null)
    }
  }

  async function purgeRecycle(item: RecycleBinItem) {
    if (!supabase) return
    if (!confirm(`Eliminare definitivamente “${item.label}” dal Cestino? Questa copia non sarà più recuperabile dal Cestino, ma resteranno disponibili le versioni complete di backup previste dalla politica di conservazione.`)) return
    setSafetyBusy(item.id)
    try {
      const { error } = await supabase.rpc('purge_family_recycle_item', { p_id: item.id })
      if (error) throw error
      setMessage(`“${item.label}” eliminato definitivamente dal Cestino.`)
      await refreshSafetyData()
    } catch (error: any) {
      setMessage(error?.message || 'Eliminazione definitiva non riuscita.')
    } finally {
      setSafetyBusy(null)
    }
  }

  async function recoverConflict(item: ConflictDraftItem) {
    if (!confirm(`Recuperare la bozza del ${formatDateTime(item.created_at)}? Prima verrà creato automaticamente un backup completo della situazione attuale. La bozza sostituirà i dati correnti con quelli che questo dispositivo stava tentando di salvare.`)) return
    setSafetyBusy(item.id)
    try {
      const ok = await recoverConflictDraft(item.id, item.data)
      setMessage(ok ? 'Bozza di conflitto recuperata. È stato creato anche un backup della situazione precedente.' : 'Recupero della bozza non completato.')
      await Promise.all([refreshSafetyData(), refreshBackupStatus()])
    } finally {
      setSafetyBusy(null)
    }
  }

  async function copyBackup() {
    const text = exportData()
    try {
      await navigator.clipboard.writeText(text)
      setMessage('Backup copiato negli appunti.')
    } catch {
      setImportText(text)
      setMessage('Copia manualmente il JSON qui sotto.')
    }
  }

  function downloadBackup() {
    const blob = new Blob([exportData()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `verdofamily-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function doImport() {
    if (!importText.trim()) return
    if (supabase && familyId && cloudAuthenticated) {
      const { error } = await supabase.rpc('create_family_backup', {
        p_family_id: familyId,
        p_reason: 'before_manual_import'
      })
      if (error) {
        setMessage('Non riesco a creare il backup di sicurezza: importazione annullata.')
        return
      }
    }
    if (importData(importText)) {
      setMessage('Backup importato correttamente. La situazione precedente è stata salvata prima dell’importazione.')
      setImportText('')
    } else {
      setMessage('Il file/JSON non è valido.')
    }
  }

  return <div className="page">
    <PageIntro eyebrow="Centro di controllo" title="Impostazioni" description="Ogni scelta è separata per funzione: profilo, aspetto dell’app, uso quotidiano, connessioni e sicurezza dei dati." />

    <nav className="settings-jump-nav" aria-label="Vai alla sezione">
      {[
        ['settings-profile', 'Profilo e aspetto'],
        ['settings-daily', 'Uso quotidiano'],
        ['settings-connections', 'Connessioni'],
        ['settings-data', 'Sicurezza e dati']
      ].map(([id, label]) => <button key={id} onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{label}</button>)}
    </nav>

    <div className="settings-flow">
      <section id="settings-profile" className="settings-section">
        <div className="settings-section__head">
          <div><span>01</span><h2>Profilo e aspetto</h2></div>
          <p>Prima chi sei, poi come vuoi vedere l’app. Colori del profilo, interfaccia e sfondo sono tre impostazioni diverse.</p>
        </div>

        <div className="settings-profile-appearance-stack">
          <Card className="settings-card--wide settings-zone-card">
            <div className="settings-zone-heading">
              <div>
                <span className="settings-zone-kicker">Profilo personale</span>
                <h3>Come vieni riconosciuto</h3>
                <p>Foto, nome e colore identificativo servono a distinguerti dagli altri membri della famiglia.</p>
              </div>
            </div>

            <div className="profile-settings-grid">
              <div>
                <div className="settings-profile settings-profile--compact"><Avatar user={authUser} size="lg" /><div><strong>{authUser.name}</strong><span>{authUser.role}</span></div></div>
                <div className="settings-profile-photo-actions">
                  <label className="btn btn--soft btn--sm"><Camera size={15} /> {avatarBusy ? 'Elaboro…' : authUser.avatarUrl ? 'Cambia foto' : 'Aggiungi foto'}<input type="file" accept="image/*" hidden disabled={avatarBusy} onChange={e => changeAvatar(e.target.files?.[0])} /></label>
                  {authUser.avatarUrl ? <button className="text-link" onClick={() => { if (confirm('Rimuovere la foto identificativa dal tuo profilo?')) updateCurrentProfile({ avatarUrl: '' }) }}>Rimuovi foto</button> : null}
                </div>
              </div>
              <div className="form-grid form-grid--2 profile-fields">
                <Field label="Nome"><input value={authUser.name} onChange={e => updateCurrentProfile({ name: e.target.value })} /></Field>
                <Field label="Colore identificativo" hint="Usato per avatar e riferimenti al tuo profilo; non cambia i colori dell’app."><input type="color" value={authUser.color} onChange={e => updateCurrentProfile({ color: e.target.value })} /></Field>
              </div>
            </div>
          </Card>

          <Card className="settings-card--wide settings-zone-card">
            <div className="settings-zone-heading">
              <div>
                <span className="settings-zone-kicker">Aspetto dell’app</span>
                <h3>Come vuoi vedere VerdoFamily</h3>
                <p>Qui modifichi luminosità, spaziatura, colore dell’interfaccia e sfondo. Ogni gruppo indica chiaramente cosa cambia.</p>
              </div>
            </div>

            <div className="appearance-settings-grid">
              <section className="appearance-block">
                <div className="appearance-block__head">
                  <div><strong>Visualizzazione</strong><span>Dimensioni e luminosità</span></div>
                </div>
                <div className="form-grid form-grid--2">
                  <Field label="Tema"><Segmented value={prefs.theme} onChange={setTheme} options={[{ value: 'system', label: 'Sistema' }, { value: 'light', label: 'Chiaro' }, { value: 'dark', label: 'Scuro' }]} /></Field>
                  <Field label="Spaziatura" hint="Comoda = più respiro. Compatta = più contenuti a schermo."><Segmented value={prefs.density} onChange={(density: any) => updateCurrentPrefs({ density })} options={[{ value: 'comfortable', label: 'Comoda' }, { value: 'compact', label: 'Compatta' }]} /></Field>
                </div>
              </section>

              <section className="appearance-block">
                <div className="appearance-block__head">
                  <div><strong>Colore dell’interfaccia</strong><span>Pulsanti, icone, selezioni e dettagli</span></div>
                  <em>Non cambia lo sfondo</em>
                </div>
                <div className="theme-preset-grid">
                  {VISUAL_STYLES.map(item => {
                    const Icon = item.Icon
                    const selected = prefs.visualStyle === item.id
                    return <button
                      type="button"
                      key={item.id}
                      className={`theme-preset ${selected ? 'is-active' : ''}`}
                      onClick={() => updateCurrentPrefs({ visualStyle: item.id as any, accent: item.primary })}
                    >
                      <span className="theme-preset__preview" style={{ '--theme-a': item.primary, '--theme-b': item.secondary } as React.CSSProperties}><Icon size={20} /></span>
                      <span className="theme-preset__copy"><strong>{item.name}</strong><small>{item.subtitle}</small></span>
                      {selected ? <Check size={16} /> : null}
                    </button>
                  })}
                </div>
                <Field label="Colore personalizzato dell’interfaccia" hint="Se vuoi un colore diverso dalle palette sopra.">
                  <div className="custom-accent-control">
                    <input
                      type="color"
                      value={prefs.accent}
                      aria-label="Colore personalizzato dell’interfaccia"
                      onInput={e => applyCustomAccent((e.currentTarget as HTMLInputElement).value)}
                      onChange={e => applyCustomAccent(e.currentTarget.value)}
                    />
                    <code>{String(prefs.accent || '#635BFF').toUpperCase()}</code>
                  </div>
                </Field>
              </section>

              <section className="appearance-block appearance-block--wide">
                <div className="appearance-block__head">
                  <div><strong>Sfondo dell’app</strong><span>La superficie dietro a schede e contenuti</span></div>
                  <em>Questo cambia lo sfondo</em>
                </div>

                <div className="background-source-grid">
                  <button
                    type="button"
                    className={`background-preset ${prefs.backgroundPreset === 'none' ? 'is-active' : ''}`}
                    onClick={() => updateCurrentPrefs({ backgroundPreset: 'none' })}
                  >
                    <span className="background-preset__preview"><ImageIcon size={21} /></span>
                    <span><strong>Pulito</strong><small>Sfondo neutro dell’app</small></span>
                    {prefs.backgroundPreset === 'none' ? <Check size={15} /> : null}
                  </button>

                  <button
                    type="button"
                    className={`background-preset ${prefs.backgroundPreset === 'color' ? 'is-active' : ''}`}
                    onClick={() => applyBackgroundColor(prefs.backgroundColor || '#EEF6FF')}
                  >
                    <span className="background-preset__preview" style={{ background: prefs.backgroundColor || '#EEF6FF' }} />
                    <span><strong>Colore pieno</strong><small>Scegli qualsiasi tinta</small></span>
                    {prefs.backgroundPreset === 'color' ? <Check size={15} /> : null}
                  </button>

                  {prefs.backgroundImage ? <button
                    type="button"
                    className={`background-preset ${prefs.backgroundPreset === 'custom' ? 'is-active' : ''}`}
                    onClick={() => updateCurrentPrefs({ backgroundPreset: 'custom' })}
                  >
                    <span className="background-preset__preview" style={{ backgroundImage: `url("${prefs.backgroundImage}")` }} />
                    <span><strong>La tua foto</strong><small>Usa l’immagine caricata</small></span>
                    {prefs.backgroundPreset === 'custom' ? <Check size={15} /> : null}
                  </button> : <label className="background-preset background-preset--upload">
                    <input
                      type="file"
                      accept="image/*"
                      disabled={backgroundBusy}
                      onChange={e => { const file = e.target.files?.[0]; if (file) void changeBackground(file); e.currentTarget.value = '' }}
                    />
                    <span className="background-preset__preview"><ImagePlus size={22} /></span>
                    <span><strong>{backgroundBusy ? 'Elaborazione…' : 'Foto personale'}</strong><small>Carica una tua immagine</small></span>
                  </label>}
                </div>

                {prefs.backgroundPreset === 'color' ? <div className="solid-background-panel">
                  <div className="appearance-inline-title"><strong>Scegli il colore di sfondo</strong><span>Puoi partire da una tinta pronta oppure usare il selettore.</span></div>
                  <div className="solid-background-palette">
                    {BACKGROUND_COLORS.map(item => <button
                      type="button"
                      key={item.value}
                      className={String(prefs.backgroundColor || '').toUpperCase() === item.value ? 'is-active' : ''}
                      onClick={() => applyBackgroundColor(item.value)}
                      title={item.name}
                      aria-label={`Sfondo ${item.name}`}
                    ><span style={{ background: item.value }} /><small>{item.name}</small></button>)}
                  </div>
                  <Field label="Colore personalizzato dello sfondo">
                    <div className="custom-accent-control">
                      <input
                        type="color"
                        value={prefs.backgroundColor || '#EEF6FF'}
                        aria-label="Colore personalizzato dello sfondo"
                        onInput={e => applyBackgroundColor((e.currentTarget as HTMLInputElement).value)}
                        onChange={e => applyBackgroundColor(e.currentTarget.value)}
                      />
                      <code>{String(prefs.backgroundColor || '#EEF6FF').toUpperCase()}</code>
                    </div>
                  </Field>
                </div> : null}

                <div className="appearance-divider-label"><span>Sfumature pronte</span><small>Alternative al colore pieno o alla foto</small></div>
                <div className="background-preset-grid background-preset-grid--gradients">
                  {BACKGROUND_PRESETS.filter(item => item.id !== 'none').map(item => {
                    const selected = prefs.backgroundPreset === item.id
                    return <button
                      type="button"
                      key={item.id}
                      className={`background-preset ${selected ? 'is-active' : ''}`}
                      onClick={() => updateCurrentPrefs({ backgroundPreset: item.id as any })}
                    >
                      <span className="background-preset__preview" style={{ backgroundImage: item.css }} />
                      <span><strong>{item.name}</strong><small>{item.subtitle}</small></span>
                      {selected ? <Check size={15} /> : null}
                    </button>
                  })}
                </div>

                {prefs.backgroundPreset !== 'none' && prefs.backgroundPreset !== 'color' ? <div className="wallpaper-controls">
                  <Field label={`Intensità sfondo · ${Math.round(prefs.backgroundStrength)}%`} hint="Più alta = sfondo più visibile.">
                    <input type="range" min="8" max="60" step="1" value={prefs.backgroundStrength} onChange={e => updateCurrentPrefs({ backgroundStrength: Number(e.target.value) })} />
                  </Field>
                  <Field label={`Sfocatura · ${Math.round(prefs.backgroundBlur)} px`} hint="Ammorbidisce foto e sfumature dietro alle card.">
                    <input type="range" min="0" max="12" step="1" value={prefs.backgroundBlur} onChange={e => updateCurrentPrefs({ backgroundBlur: Number(e.target.value) })} />
                  </Field>
                </div> : null}

                {prefs.backgroundImage ? <div className="wallpaper-custom-actions">
                  {prefs.backgroundPreset !== 'custom' ? <Button size="sm" variant="ghost" onClick={() => updateCurrentPrefs({ backgroundPreset: 'custom' })}>Usa la mia foto</Button> : null}
                  <label className="btn btn--ghost btn--sm"><ImagePlus size={14} /> Cambia foto<input type="file" accept="image/*" hidden disabled={backgroundBusy} onChange={e => { const file = e.target.files?.[0]; if (file) void changeBackground(file); e.currentTarget.value = '' }} /></label>
                  <Button size="sm" variant="danger" onClick={removeCustomBackground}>Rimuovi foto</Button>
                </div> : null}
              </section>
            </div>
          </Card>
        </div>
      </section>

      <section id="settings-daily" className="settings-section">
        <div className="settings-section__head">
          <div><span>02</span><h2>Uso quotidiano</h2></div>
          <p>Decidi cosa mostrare sul tablet di casa, cosa tenere a portata di mano e quali avvisi vuoi ricevere.</p>
        </div>
        <Card className="settings-card--wide settings-unified-card">
          <div className="settings-unified-grid settings-unified-grid--daily">
            <section className="settings-subsection">
              <div className="settings-subsection__head"><div><strong>Assistente vocale</strong><span>Personalizza come chiamarlo in tutta la famiglia</span></div></div>
              <Field label="Nome assistente" hint="Massimo 24 caratteri. Il nome è condiviso su tutti i dispositivi.">
                <input key={data.assistantName || 'Verdo'} defaultValue={data.assistantName || 'Verdo'} maxLength={24} disabled={authUser.role === 'bimbo'} onBlur={e => setAssistantName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur() }} />
              </Field>
              <div className="callout">Tocca il microfono “Parla con {data.assistantName || 'Verdo'}”. L’ascolto parte solo quando lo attivi.</div>
            </section>

            <section className="settings-subsection">
              <div className="settings-subsection__head"><div><strong>Home</strong><span>Riepiloghi visibili a colpo d’occhio</span></div></div>
              <div className="settings-check-grid settings-check-grid--compact">{HOME_CARDS.map(item => <label key={item.key} className={prefs.homeCards.includes(item.key) ? 'is-selected' : ''}><input type="checkbox" checked={prefs.homeCards.includes(item.key)} onChange={() => toggleHomeCard(item.key)} /><span>{item.label}</span></label>)}</div>
              <label className="toggle-row settings-toggle-standalone"><input type="checkbox" checked={prefs.showBalances} onChange={e => updateCurrentPrefs({ showBalances: e.target.checked })} /><span>Mostra i saldi delle paghette</span></label>
            </section>

            <section className="settings-subsection">
              <div className="settings-subsection__head"><div><strong>Navigazione mobile</strong><span>Fino a 4 sezioni sempre disponibili</span></div></div>
              <div className="settings-check-grid settings-check-grid--compact">{TAB_OPTIONS.map(item => <label key={item.key} className={prefs.bottomTabs.includes(item.key) ? 'is-selected' : ''}><input type="checkbox" checked={prefs.bottomTabs.includes(item.key)} onChange={() => toggleBottomTab(item.key)} /><span>{item.label}</span></label>)}</div>
              <div className="sortable-list sortable-list--compact">{prefs.bottomTabs.map((key, index) => <div key={key}><span>{TAB_OPTIONS.find(x => x.key === key)?.label || key}</span><div><button disabled={index === 0} onClick={() => moveTab(index, -1)}>↑</button><button disabled={index === prefs.bottomTabs.length - 1} onClick={() => moveTab(index, 1)}>↓</button></div></div>)}</div>
            </section>

            <section className="settings-subsection settings-subsection--wide">
              <div className="settings-subsection__head"><div><strong>Avvisi</strong><span>Scegli quali cambiamenti devono attirare la tua attenzione</span></div></div>
              <div className="settings-toggle-list settings-toggle-list--grid">
                {[
                  ['calendar', 'Calendario', 'Impegni e variazioni'],
                  ['deadlines', 'Scadenze', 'Promemoria prima della data'],
                  ['chores', 'Compiti', 'Nuovi compiti e completamenti'],
                  ['school', 'Scuola', 'Compiti, verifiche e materiale'],
                  ['board', 'Bacheca', 'Nuovi messaggi e promemoria familiari'],
                  ['shopping', 'Lista spesa', 'Aggiornamenti alla lista'],
                  ['whatsapp', 'WhatsApp', 'Canale preferito quando disponibile']
                ].map(([key, label, sub]) => <label key={key}><div><strong>{label}</strong><span>{sub}</span></div><input type="checkbox" checked={(prefs.notifications as any)[key]} onChange={e => { const checked = e.target.checked; updateCurrentPrefs(currentPrefs => ({ notifications: { ...currentPrefs.notifications, [key]: checked } })) }} /></label>)}
              </div>
            </section>
          </div>
        </Card>
      </section>

      <section id="settings-connections" className="settings-section">
        <div className="settings-section__head">
          <div><span>03</span><h2>Connessioni & automazioni</h2></div>
          <p>Servizi esterni che lavorano con VerdoFamily: calendario, report e notifiche automatiche.</p>
        </div>
      <Card className="settings-card--wide">
        <CardHeader title="Notifiche push" subtitle="Avvisi reali sul telefono, tablet o computer anche quando VerdoFamily non è aperto." />
        {!cloudAuthenticated || !familyId ? <div className="callout">Accedi con il tuo account VerdoFamily cloud per attivare le notifiche push.</div> : !pushStatus ? <div className="backup-actions"><Button variant="soft" icon={<RefreshCw size={17} />} onClick={refreshPushStatus} disabled={pushBusy}>{pushBusy ? 'Controllo…' : 'Verifica disponibilità'}</Button></div> : !pushStatus.supported ? <div className="callout">Questo browser non supporta Web Push. Su iPhone/iPad usa VerdoFamily installata nella schermata Home; su Android e computer usa un browser aggiornato.</div> : <>
          <div className={pushStatus.subscribed ? 'callout callout--success' : 'callout'}>{pushStatus.subscribed ? '✅ Push attive su questo dispositivo. Le categorie seguono le preferenze Avvisi qui sopra.' : pushStatus.permission === 'denied' ? '⚠️ Le notifiche sono bloccate dal browser. Riabilitale nelle impostazioni del sito/dispositivo e poi premi Verifica.' : 'Le push non sono ancora attive su questo dispositivo.'}</div>
          <Field label="Dettagli notifiche" hint="Completi mostra titolo, ora e persona. Riservati mantiene un testo generico sulla schermata bloccata.">
            <Segmented
              value={prefs.notificationDetail || 'full'}
              onChange={(notificationDetail: any) => updateCurrentPrefs({ notificationDetail })}
              options={[{ value: 'full', label: 'Completi' }, { value: 'private', label: 'Riservati' }]}
            />
          </Field>
          <div className="backup-actions">
            {pushStatus.subscribed ? <><Button variant="soft" icon={<BellRing size={17} />} onClick={testPush} disabled={pushBusy}>{pushBusy ? 'Attendi…' : 'Invia notifica di prova'}</Button><Button variant="ghost" onClick={deactivatePush} disabled={pushBusy}>Disattiva su questo dispositivo</Button></> : <Button icon={<BellRing size={17} />} onClick={activatePush} disabled={pushBusy || pushStatus.permission === 'denied'}>{pushBusy ? 'Attivazione…' : 'Attiva notifiche push'}</Button>}
            <Button variant="ghost" icon={<RefreshCw size={16} />} onClick={refreshPushStatus} disabled={pushBusy}>Verifica</Button>
          </div>
        </>}
        {pushMessage ? <div className={pushMessage.includes('attivat') || pushMessage.includes('inviata') ? 'callout callout--success' : 'callout'}>{pushMessage}</div> : null}
      </Card>

      <Card className="settings-card--wide">
        <CardHeader title="Google Calendar" subtitle="Ogni adulto può collegare il proprio account e scegliere dove ricevere gli eventi VerdoFamily." />
        {!cloudAuthenticated || !familyId ? <div className="callout">Accedi con il tuo account VerdoFamily cloud per collegare Google Calendar.</div> : !googleStatus ? <div className="backup-actions"><Button variant="soft" icon={<RefreshCw size={17} />} onClick={refreshGoogleCalendar} disabled={googleBusy}>{googleBusy ? 'Controllo…' : 'Verifica configurazione'}</Button></div> : !googleStatus.configured ? <>
          <div className="callout"><strong>Integrazione pronta, manca l’autorizzazione Google.</strong><br />Il backend VerdoFamily è già predisposto. Completa una sola volta la configurazione OAuth indicata da ChatGPT, poi ogni utente potrà collegare il proprio account.</div>
          {googleStatus.redirectUri ? <Field label="URI di reindirizzamento Google" hint="Va inserito tra gli URI autorizzati del client OAuth Google."><input readOnly value={googleStatus.redirectUri} /></Field> : null}
        </> : !googleStatus.connected ? <>
          <div className="callout">Collega il tuo account Google. VerdoFamily richiederà accesso agli eventi e all’elenco dei calendari, senza usare inviti automatici ai familiari.</div>
          <Button icon={<Link2 size={17} />} onClick={connectGoogleCalendar} disabled={googleBusy}>{googleBusy ? 'Collegamento…' : 'Collega Google Calendar'}</Button>
        </> : <>
          <div className="callout callout--success"><strong>✅ Google Calendar collegato</strong>{googleStatus.connection?.googleEmail ? <><br />{googleStatus.connection.googleEmail}</> : null}</div>
          <div className="form-grid form-grid--2">
            <Field label="Calendario personale" hint="Visite e impegni assegnati a te vengono copiati qui."><select value={googleDraft.personalCalendarId} onChange={e => setGoogleDraft({ ...googleDraft, personalCalendarId: e.target.value })}><option value="primary">Calendario principale Google</option>{googleCalendars.filter(item => !item.primary).map(item => <option key={item.id} value={item.id}>{item.summary}</option>)}</select></Field>
            <Field label="Calendario famiglia condiviso" hint="Opzionale: usato dagli eventi marcati Famiglia."><select value={googleDraft.familyCalendarId} onChange={e => setGoogleDraft({ ...googleDraft, familyCalendarId: e.target.value })}><option value="">Nessuno</option>{googleCalendars.map(item => <option key={item.id} value={item.id}>{item.summary}{item.primary ? ' (principale)' : ''}</option>)}</select></Field>
            <Field label="Eventi Famiglia" className="field--wide"><Segmented value={googleDraft.familyEventTarget} onChange={(familyEventTarget: any) => setGoogleDraft({ ...googleDraft, familyEventTarget })} options={[{ value: 'personal', label: 'Calendari personali' }, { value: 'shared', label: 'Solo condiviso' }, { value: 'both', label: 'Entrambi' }]} /></Field>
          </div>
          <div className="callout"><CalendarDays size={16} /> Gli eventi assegnati a più persone vengono copiati nel calendario personale di ciascun partecipante che ha collegato Google. Gli eventi “Famiglia” seguono invece la scelta qui sopra. Non vengono inviati inviti Google.</div>
          <div className="backup-actions"><Button onClick={saveGoogleCalendarSettings} disabled={googleBusy}>Salva e sincronizza</Button><Button variant="soft" icon={<RefreshCw size={17} />} onClick={syncGoogleCalendarNow} disabled={googleBusy}>Sincronizza ora</Button><Button variant="ghost" icon={<Unlink size={17} />} onClick={disconnectGoogleCalendar} disabled={googleBusy}>Scollega</Button></div>
        </>}
        {googleMessage ? <div className="callout" style={{ marginTop: 12 }}>{googleMessage}</div> : null}
      </Card>

      <TelegramReportsCard />
      </section>

      <section id="settings-data" className="settings-section">
        <div className="settings-section__head">
          <div><span>04</span><h2>Dati & recupero</h2></div>
          <p>Backup, cronologia e strumenti di emergenza raccolti in un unico punto.</p>
        </div>

      <Card className="settings-card--wide">
        <CardHeader title="Dati & backup" subtitle="Backup automatici nel cloud e su Google Drive, più esportazione manuale locale." />

        {cloudAuthenticated && familyId ? <>
          <div className={backupHealth.ok ? 'callout callout--success' : 'callout'}>
            <strong>{backupHealth.title}</strong><br />
            {backupHealth.detail}
            {driveStatus?.enabled ? <><br />Controllo automatico attivo ogni 5 minuti.</> : null}
          </div>
          <div className="backup-actions">
            <Button variant="soft" icon={<Cloud size={17} />} onClick={runDriveBackup} disabled={backupBusy}>{backupBusy ? 'Backup in corso…' : 'Backup Google Drive ora'}</Button>
            <Button variant="ghost" icon={<RefreshCw size={17} />} onClick={refreshBackupStatus} disabled={backupLoading}>{backupLoading ? 'Verifica…' : 'Verifica stato'}</Button>
          </div>
          <div className="callout">Il backup automatico viene eseguito ogni notte. Se per più di 24 ore non viene registrato un backup riuscito, qui comparirà automaticamente un avviso. Ogni salvataggio importante conserva inoltre una versione precedente nel database.</div>

          {backupHistory.length ? <>
            <CardHeader title="Cronologia ripristinabile" subtitle="Ultime versioni conservate su Supabase" />
            <div className="sortable-list">{backupHistory.map(item => <div key={item.id}><span><strong>Rev. {item.revision}</strong> · {backupReason(item.reason)} · {formatDateTime(item.created_at)}</span><div><button disabled={backupBusy} onClick={() => restoreBackup(item)}>Ripristina</button></div></div>)}</div>
          </> : null}
        </> : <div className="callout">Accedi con il tuo account cloud per attivare backup automatici e cronologia ripristinabile.</div>}

        {cloudAuthenticated && familyId && authUser.role !== 'bimbo' ? <>
          <CardHeader title="Protezione multi-device" subtitle="Conflitti, Cestino e cronologia delle modifiche" />
          <div className="callout callout--success">
            <strong>Protezione dati attiva.</strong><br />
            Ogni scrittura usa una revisione globale; Paghette, Scuola e Salute accettano modifiche solo dalla revisione corrente. In caso di conflitto, la copia locale viene salvata come bozza prima di ricaricare i dati più recenti.
          </div>

          {conflictDrafts.length ? <>
            <div className="callout">
              <strong>⚠️ {conflictDrafts.length} {conflictDrafts.length === 1 ? 'bozza di conflitto da verificare' : 'bozze di conflitto da verificare'}.</strong><br />
              Sono copie locali salvate automaticamente quando due dispositivi hanno modificato dati quasi nello stesso momento.
            </div>
            <div className="sortable-list">
              {conflictDrafts.map(item => <div key={item.id}>
                <span><strong>Bozza protetta</strong> · {formatDateTime(item.created_at)} · rev. {item.base_revision} → {item.remote_revision}</span>
                <div><button disabled={safetyBusy === item.id} onClick={() => recoverConflict(item)}>{safetyBusy === item.id ? 'Attendi…' : 'Recupera'}</button></div>
              </div>)}
            </div>
          </> : null}

          <CardHeader title="Cestino recuperabile" subtitle="Le eliminazioni vengono archiviate qui prima di essere applicate." />
          {recycleItems.length ? <div className="sortable-list">
            {recycleItems.map(item => <div key={item.id}>
              <span><strong>{item.label}</strong> · {item.module} · {formatDateTime(item.deleted_at)}</span>
              <div>
                <button disabled={safetyBusy === item.id} onClick={() => restoreRecycle(item)}>Ripristina</button>
                <button disabled={safetyBusy === item.id} onClick={() => purgeRecycle(item)}>Elimina definitivamente</button>
              </div>
            </div>)}
          </div> : <div className="callout">Cestino vuoto. Le prossime eliminazioni protette compariranno qui.</div>}

          <CardHeader title="Cronologia sicurezza" subtitle="Ultime operazioni rilevanti, senza contenuto privato dei dati." />
          {changeHistory.length ? <div className="sortable-list">
            {changeHistory.slice(0, 20).map(item => <div key={item.id}>
              <span><strong>{historyLabel(item.event_type)}</strong> · {formatDateTime(item.created_at)}{Array.isArray(item.metadata?.modules) && item.metadata.modules.length ? ` · ${item.metadata.modules.join(', ')}` : ''}</span>
              <div><span className="badge">{item.success ? 'OK' : 'Verifica'}</span></div>
            </div>)}
          </div> : <div className="callout">La cronologia inizierà a popolarsi con i prossimi salvataggi e operazioni di recupero.</div>}
          <div className="backup-actions"><Button variant="ghost" icon={<RefreshCw size={17} />} onClick={refreshSafetyData}>Aggiorna sicurezza</Button></div>
        </> : null}

        <CardHeader title="Copia manuale" subtitle="Una copia JSON resta utile anche fuori dal cloud." />
        <div className="backup-actions"><Button variant="soft" icon={<ClipboardCopy size={17} />} onClick={copyBackup}>Copia backup</Button><Button variant="soft" icon={<Download size={17} />} onClick={downloadBackup}>Scarica JSON</Button></div>
        <Field label="Importa backup" hint="Incolla qui un backup JSON creato da VerdoFamily."><textarea rows={5} value={importText} onChange={e => setImportText(e.target.value)} /></Field>
        <div className="backup-footer"><Button variant="ghost" icon={<Upload size={17} />} onClick={() => { if (confirm('Importare questo backup? I dati presenti verranno sostituiti da quelli contenuti nel file.')) doImport() }}>Importa</Button><Button variant="danger" icon={<RotateCcw size={17} />} onClick={resetData}>Ripristina dati demo</Button></div>
        {message ? <div className="callout callout--success">{message}</div> : null}
      </Card>
      </section>
    </div>
  </div>
}
