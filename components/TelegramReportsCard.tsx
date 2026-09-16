import React, { useEffect, useState } from 'react'
import { Bot, CheckCircle2, ExternalLink, Plus, RefreshCw, Send, Unlink } from 'lucide-react'
import { useFamily } from '../store'
import { supabase } from '../supabaseClient'
import { Button, Card, CardHeader, Field, Segmented } from '../ui'

type SectionKey = 'agenda' | 'meals' | 'shopping' | 'lowStock' | 'deadlines' | 'todos' | 'chores'

type ReportSchedule = {
  id?: string
  name: string
  enabled: boolean
  time_local: string
  timezone: string
  days: number[]
  target_day_offset: 0 | 1
  scope: 'personal' | 'family'
  sections: Record<SectionKey, boolean>
  include_health: boolean
}

type TelegramStatus = {
  configured: boolean
  connected: boolean
  bot?: { username?: string; firstName?: string } | null
  botError?: string
  connection?: { telegramUsername?: string; firstName?: string; linkedAt?: string } | null
  schedules?: ReportSchedule[]
}

const DAY_OPTIONS = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mer' },
  { value: 4, label: 'Gio' },
  { value: 5, label: 'Ven' },
  { value: 6, label: 'Sab' },
  { value: 7, label: 'Dom' }
]

const SECTION_OPTIONS: Array<{ key: SectionKey; label: string; hint: string }> = [
  { key: 'agenda', label: 'Impegni', hint: 'Calendario del giorno' },
  { key: 'meals', label: 'Pasti', hint: 'Programma pranzo/cena' },
  { key: 'shopping', label: 'Lista spesa', hint: 'Articoli ancora da comprare' },
  { key: 'lowStock', label: 'Sotto scorta', hint: 'Prodotti dispensa sotto il minimo' },
  { key: 'deadlines', label: 'Scadenze', hint: 'Scadenze previste nel giorno' },
  { key: 'todos', label: 'ToDo', hint: 'Attività ancora aperte' },
  { key: 'chores', label: 'Compiti', hint: 'Compiti/paghette in scadenza' }
]

function blankSchedule(): ReportSchedule {
  return {
    name: 'Buongiorno',
    enabled: true,
    time_local: '07:30',
    timezone: 'Europe/Rome',
    days: [1, 2, 3, 4, 5, 6, 7],
    target_day_offset: 0,
    scope: 'personal',
    sections: {
      agenda: true,
      meals: true,
      shopping: true,
      lowStock: false,
      deadlines: true,
      todos: true,
      chores: false
    },
    include_health: false
  }
}

function normalizeSchedule(value: any): ReportSchedule {
  const fallback = blankSchedule()
  return {
    ...fallback,
    ...value,
    time_local: String(value?.time_local || fallback.time_local).slice(0, 5),
    days: Array.isArray(value?.days) && value.days.length ? value.days.map(Number) : fallback.days,
    target_day_offset: Number(value?.target_day_offset || 0) === 1 ? 1 : 0,
    scope: value?.scope === 'family' ? 'family' : 'personal',
    sections: { ...fallback.sections, ...(value?.sections || {}) },
    include_health: value?.include_health === true
  }
}

export default function TelegramReportsCard() {
  const { familyId, cloudAuthenticated } = useFamily()
  const [status, setStatus] = useState<TelegramStatus | null>(null)
  const [draft, setDraft] = useState<ReportSchedule>(() => blankSchedule())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void refreshStatus()
  }, [familyId, cloudAuthenticated])

  async function callTelegram(action: string, extra: Record<string, any> = {}) {
    if (!supabase || !familyId) throw new Error('Cloud non disponibile.')
    const { data, error } = await supabase.functions.invoke('telegram-reports', {
      body: { action, familyId, ...extra }
    })
    if (error) throw new Error(error.message || 'Errore Telegram')
    if (data?.error) throw new Error(data.error)
    return data
  }

  async function refreshStatus() {
    if (!supabase || !familyId || !cloudAuthenticated) {
      setStatus(null)
      return
    }
    setBusy(true)
    try {
      const result = await callTelegram('status')
      setStatus(result)
    } catch (error: any) {
      setMessage(`Telegram: ${error?.message || 'stato non disponibile'}`)
    } finally {
      setBusy(false)
    }
  }

  async function startLink() {
    const popup = window.open('about:blank', '_blank')
    setBusy(true)
    setMessage('')
    try {
      const result = await callTelegram('link-url')
      if (!result?.url) throw new Error('Link Telegram non disponibile.')
      setMessage('In Telegram premi “Avvia/Start”, poi torna qui e clicca “Verifica collegamento”.')
      if (popup) {
        popup.opener = null
        popup.location.href = result.url
      } else {
        window.location.assign(result.url)
      }
    } catch (error: any) {
      popup?.close()
      setMessage(`Collegamento non riuscito: ${error?.message || 'errore sconosciuto'}`)
    } finally {
      setBusy(false)
    }
  }

  async function pollLink() {
    setBusy(true)
    setMessage('')
    try {
      const result = await callTelegram('poll-link')
      setStatus(result)
      if (result?.connected) {
        setMessage('✅ Telegram collegato correttamente.')
      } else {
        setMessage('Non vedo ancora il collegamento. Apri il bot, premi Avvia e riprova tra qualche secondo.')
      }
    } catch (error: any) {
      setMessage(`Verifica non riuscita: ${error?.message || 'errore sconosciuto'}`)
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    if (!confirm('Scollegare Telegram da VerdoFamily? I report resteranno configurati ma non verranno inviati finché non ricolleghi un account.')) return
    setBusy(true)
    try {
      await callTelegram('disconnect')
      setMessage('Telegram scollegato.')
      await refreshStatus()
    } catch (error: any) {
      setMessage(`Scollegamento non riuscito: ${error?.message || 'errore sconosciuto'}`)
    } finally {
      setBusy(false)
    }
  }

  function toggleDay(day: number) {
    const current = draft.days.includes(day)
    const next = current ? draft.days.filter(item => item !== day) : [...draft.days, day].sort()
    if (!next.length) return
    setDraft({ ...draft, days: next })
  }

  function toggleSection(key: SectionKey) {
    setDraft({ ...draft, sections: { ...draft.sections, [key]: !draft.sections[key] } })
  }

  function editSchedule(schedule: ReportSchedule) {
    setDraft(normalizeSchedule(schedule))
    setMessage('Modifica il report e poi premi “Salva report”.')
  }

  function newSchedule() {
    setDraft(blankSchedule())
    setMessage('Nuovo report: scegli orario, giorni e contenuti.')
  }

  async function saveSchedule() {
    setBusy(true)
    setMessage('')
    try {
      const result = await callTelegram('save-schedule', { schedule: draft })
      setStatus(result)
      setDraft(blankSchedule())
      setMessage('✅ Report salvato. Verrà inviato automaticamente all’orario scelto.')
    } catch (error: any) {
      setMessage(`Salvataggio non riuscito: ${error?.message || 'errore sconosciuto'}`)
    } finally {
      setBusy(false)
    }
  }

  async function deleteSchedule(id?: string) {
    if (!id || !confirm('Eliminare questo report automatico?')) return
    setBusy(true)
    try {
      const result = await callTelegram('delete-schedule', { scheduleId: id })
      setStatus(result)
      if (draft.id === id) setDraft(blankSchedule())
      setMessage('Report eliminato.')
    } catch (error: any) {
      setMessage(`Eliminazione non riuscita: ${error?.message || 'errore sconosciuto'}`)
    } finally {
      setBusy(false)
    }
  }

  async function sendTest(id?: string) {
    if (!id) return
    setBusy(true)
    setMessage('')
    try {
      await callTelegram('send-test', { scheduleId: id })
      setMessage('✅ Report di prova inviato su Telegram.')
    } catch (error: any) {
      setMessage(`Invio di prova non riuscito: ${error?.message || 'errore sconosciuto'}`)
    } finally {
      setBusy(false)
    }
  }

  return <Card className="settings-card--wide">
    <CardHeader
      title="Telegram & report automatici"
      subtitle="Ricevi gratuitamente agenda, pasti, spesa e altri riepiloghi anche quando VerdoFamily è chiuso."
      action={status?.connected ? <Button variant="soft" size="sm" icon={<Plus size={15} />} onClick={newSchedule}>Nuovo report</Button> : null}
    />

    {!cloudAuthenticated || !familyId ? <div className="callout">Accedi con il tuo account VerdoFamily cloud per configurare i report automatici.</div> : !status ? <div className="backup-actions"><Button variant="soft" icon={<RefreshCw size={17} />} onClick={refreshStatus} disabled={busy}>{busy ? 'Controllo…' : 'Verifica Telegram'}</Button></div> : !status.configured ? <div className="callout">Il backend è pronto, ma manca il secret <strong>TELEGRAM_BOT_TOKEN</strong> su Supabase.</div> : !status.connected ? <>
      <div className="callout"><Bot size={17} /> Collega il tuo account Telegram personale. Ogni membro della famiglia potrà collegare il proprio account separatamente.</div>
      <div className="backup-actions">
        <Button icon={<ExternalLink size={17} />} onClick={startLink} disabled={busy}>{busy ? 'Preparazione…' : `Collega @${status.bot?.username || 'bot Telegram'}`}</Button>
        <Button variant="soft" icon={<RefreshCw size={17} />} onClick={pollLink} disabled={busy}>Verifica collegamento</Button>
      </div>
    </> : <>
      <div className="callout callout--success"><CheckCircle2 size={17} /> <strong>Telegram collegato</strong>{status.connection?.firstName ? ` · ${status.connection.firstName}` : ''}{status.connection?.telegramUsername ? ` (@${status.connection.telegramUsername})` : ''}</div>

      {(status.schedules || []).length ? <>
        <CardHeader title="Report attivi" subtitle="Puoi creare più invii nella stessa giornata." />
        <div className="sortable-list">{(status.schedules || []).map(schedule => <div key={schedule.id}>
          <span><strong>{schedule.name}</strong> · {schedule.time_local} · {schedule.target_day_offset === 1 ? 'giorno successivo' : 'giorno stesso'} · {schedule.scope === 'family' ? 'famiglia' : 'personale'}{schedule.enabled ? '' : ' · disattivato'}</span>
          <div>
            <button onClick={() => editSchedule(schedule)} disabled={busy}>Modifica</button>
            <button onClick={() => sendTest(schedule.id)} disabled={busy}>Prova</button>
            <button onClick={() => deleteSchedule(schedule.id)} disabled={busy}>Elimina</button>
          </div>
        </div>)}</div>
      </> : <div className="callout">Nessun report programmato. Configura il primo qui sotto.</div>}

      <CardHeader title={draft.id ? `Modifica “${draft.name}”` : 'Configura un report'} subtitle="Ogni report può avere orario, giorni e contenuti diversi." />
      <div className="form-grid form-grid--2">
        <Field label="Nome report"><input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Es. Buongiorno" /></Field>
        <Field label="Orario"><input type="time" value={draft.time_local} onChange={e => setDraft({ ...draft, time_local: e.target.value })} /></Field>
        <Field label="Giorno del riepilogo"><Segmented value={String(draft.target_day_offset)} onChange={(value: string) => setDraft({ ...draft, target_day_offset: value === '1' ? 1 : 0 })} options={[{ value: '0', label: 'Oggi' }, { value: '1', label: 'Domani' }]} /></Field>
        <Field label="Contenuti"><Segmented value={draft.scope} onChange={(scope: 'personal' | 'family') => setDraft({ ...draft, scope })} options={[{ value: 'personal', label: 'I miei' }, { value: 'family', label: 'Famiglia' }]} /></Field>
      </div>

      <Field label="Giorni di invio">
        <div className="settings-check-grid">{DAY_OPTIONS.map(day => <label key={day.value} className={draft.days.includes(day.value) ? 'is-selected' : ''}><input type="checkbox" checked={draft.days.includes(day.value)} onChange={() => toggleDay(day.value)} /><span>{day.label}</span></label>)}</div>
      </Field>

      <Field label="Sezioni del report">
        <div className="settings-toggle-list">{SECTION_OPTIONS.map(section => <label key={section.key}><div><strong>{section.label}</strong><span>{section.hint}</span></div><input type="checkbox" checked={draft.sections[section.key]} onChange={() => toggleSection(section.key)} /></label>)}</div>
      </Field>

      <div className={draft.include_health ? 'callout' : 'callout'}>
        <label className="toggle-row"><input type="checkbox" checked={draft.include_health} onChange={e => setDraft({ ...draft, include_health: e.target.checked })} /><span><strong>Includi dati salute</strong><br />Disattivato di default: visite, terapie e promemoria sanitari non escono dall’app finché non lo abiliti espressamente.</span></label>
      </div>

      <div className="backup-actions">
        <Button icon={<Send size={17} />} onClick={saveSchedule} disabled={busy}>{busy ? 'Salvataggio…' : 'Salva report'}</Button>
        {draft.id ? <Button variant="soft" onClick={newSchedule} disabled={busy}>Annulla modifica</Button> : null}
        <Button variant="ghost" icon={<Unlink size={17} />} onClick={disconnect} disabled={busy}>Scollega Telegram</Button>
      </div>
    </>}

    {message ? <div className="callout" style={{ marginTop: 12 }}>{message}</div> : null}
  </Card>
}
