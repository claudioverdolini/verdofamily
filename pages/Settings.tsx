import React, { useState } from 'react'
import { Check, ClipboardCopy, Download, RotateCcw, Upload } from 'lucide-react'
import { useFamily } from '../store'
import type { PageKey, ThemeMode } from '../types'
import { Avatar, Button, Card, CardHeader, Field, PageIntro, Segmented } from '../ui'

const ACCENTS = [
  { name: 'Indigo', color: '#5B5BD6' },
  { name: 'Ocean', color: '#0284C7' },
  { name: 'Forest', color: '#059669' },
  { name: 'Sunset', color: '#EA580C' },
  { name: 'Berry', color: '#C026D3' },
  { name: 'Rose', color: '#E11D48' }
]

const TAB_OPTIONS: Array<{ key: PageKey; label: string }> = [
  { key: 'home', label: 'Home' },
  { key: 'calendar', label: 'Calendario' },
  { key: 'shopping', label: 'Spesa' },
  { key: 'meals', label: 'Pasti' },
  { key: 'chores', label: 'Paghette' },
  { key: 'deadlines', label: 'Scadenze' },
  { key: 'todos', label: 'ToDo' },
  { key: 'users', label: 'Utenti' }
]

const HOME_CARDS = [
  { key: 'today', label: 'Impegni di oggi' },
  { key: 'shopping', label: 'Lista spesa' },
  { key: 'deadlines', label: 'Scadenze' },
  { key: 'wallets', label: 'Paghette' }
] as const

export default function SettingsPage() {
  const { authUser, updateCurrentPrefs, updateCurrentProfile, exportData, importData, resetData } = useFamily()
  const [importText, setImportText] = useState('')
  const [message, setMessage] = useState('')

  const prefs = authUser?.prefs
  if (!authUser || !prefs) return null

  function setTheme(theme: ThemeMode) {
    updateCurrentPrefs({ theme })
  }

  function toggleBottomTab(key: PageKey) {
    const current = prefs.bottomTabs || []
    if (current.includes(key)) {
      if (current.length <= 1) return
      updateCurrentPrefs({ bottomTabs: current.filter(x => x !== key) })
      return
    }
    if (current.length >= 4) return
    updateCurrentPrefs({ bottomTabs: [...current, key] })
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
    const current = prefs.homeCards || []
    if (current.includes(key)) {
      if (current.length <= 1) return
      updateCurrentPrefs({ homeCards: current.filter(x => x !== key) as any })
    } else {
      updateCurrentPrefs({ homeCards: [...current, key] as any })
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

  function doImport() {
    if (!importText.trim()) return
    if (importData(importText)) {
      setMessage('Backup importato correttamente.')
      setImportText('')
    } else {
      setMessage('Il file/JSON non è valido.')
    }
  }

  return <div className="page">
    <PageIntro eyebrow="Personalizzazione" title="Impostazioni" description="Ogni utente può scegliere il proprio stile, la navigazione e cosa vedere in primo piano." />

    <div className="settings-grid">
      <Card>
        <CardHeader title="Profilo" subtitle="Identità visiva personale" />
        <div className="settings-profile"><Avatar user={authUser} size="xl" /><div><strong>{authUser.name}</strong><span>{authUser.role}</span></div></div>
        <div className="form-grid form-grid--2">
          <Field label="Nome"><input value={authUser.name} onChange={e => updateCurrentProfile({ name: e.target.value })} /></Field>
          <Field label="Colore profilo"><input type="color" value={authUser.color} onChange={e => updateCurrentProfile({ color: e.target.value })} /></Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Aspetto" subtitle="Tema e colore principale" />
        <Field label="Tema">
          <Segmented value={prefs.theme} onChange={setTheme} options={[{ value: 'system', label: 'Sistema' }, { value: 'light', label: 'Chiaro' }, { value: 'dark', label: 'Scuro' }]} />
        </Field>
        <div className="accent-grid">{ACCENTS.map(item => <button key={item.color} className={`accent-swatch ${prefs.accent === item.color ? 'is-active' : ''}`} onClick={() => updateCurrentPrefs({ accent: item.color })}><span style={{ background: item.color }} /> <strong>{item.name}</strong>{prefs.accent === item.color ? <Check size={15} /> : null}</button>)}</div>
        <Field label="Colore libero"><input type="color" value={prefs.accent} onChange={e => updateCurrentPrefs({ accent: e.target.value })} /></Field>
        <Field label="Densità interfaccia"><Segmented value={prefs.density} onChange={(density: any) => updateCurrentPrefs({ density })} options={[{ value: 'comfortable', label: 'Comoda' }, { value: 'compact', label: 'Compatta' }]} /></Field>
      </Card>

      <Card>
        <CardHeader title="Barra mobile" subtitle="Scegli fino a 4 sezioni sempre a portata di pollice" />
        <div className="settings-check-grid">{TAB_OPTIONS.map(item => <label key={item.key} className={prefs.bottomTabs.includes(item.key) ? 'is-selected' : ''}><input type="checkbox" checked={prefs.bottomTabs.includes(item.key)} onChange={() => toggleBottomTab(item.key)} /><span>{item.label}</span></label>)}</div>
        <div className="sortable-list">{prefs.bottomTabs.map((key, index) => <div key={key}><span>{TAB_OPTIONS.find(x => x.key === key)?.label || key}</span><div><button disabled={index === 0} onClick={() => moveTab(index, -1)}>↑</button><button disabled={index === prefs.bottomTabs.length - 1} onClick={() => moveTab(index, 1)}>↓</button></div></div>)}</div>
      </Card>

      <Card>
        <CardHeader title="Home" subtitle="Scegli quali riepiloghi mostrare" />
        <div className="settings-check-grid">{HOME_CARDS.map(item => <label key={item.key} className={prefs.homeCards.includes(item.key) ? 'is-selected' : ''}><input type="checkbox" checked={prefs.homeCards.includes(item.key)} onChange={() => toggleHomeCard(item.key)} /><span>{item.label}</span></label>)}</div>
        <label className="toggle-row"><input type="checkbox" checked={prefs.showBalances} onChange={e => updateCurrentPrefs({ showBalances: e.target.checked })} /><span>Mostra i saldi delle paghette</span></label>
      </Card>

      <Card>
        <CardHeader title="Notifiche" subtitle="Preferenze pronte per push/WhatsApp" />
        <div className="settings-toggle-list">
          {[
            ['calendar', 'Calendario', 'Impegni e variazioni'],
            ['deadlines', 'Scadenze', 'Promemoria prima della data'],
            ['chores', 'Compiti', 'Nuovi compiti e completamenti'],
            ['shopping', 'Lista spesa', 'Aggiornamenti alla lista'],
            ['whatsapp', 'WhatsApp', 'Canale preferito quando disponibile']
          ].map(([key, label, sub]) => <label key={key}><div><strong>{label}</strong><span>{sub}</span></div><input type="checkbox" checked={(prefs.notifications as any)[key]} onChange={e => updateCurrentPrefs({ notifications: { ...prefs.notifications, [key]: e.target.checked } })} /></label>)}
        </div>
        <div className="callout">Le preferenze sono operative nell’app; per push e WhatsApp automatici serve il backend cloud, che questa interfaccia è già pronta a collegare.</div>
      </Card>

      <Card className="settings-card--wide">
        <CardHeader title="Dati & backup" subtitle="Esporta prima di cambi importanti; puoi ripristinare tutto in pochi secondi." />
        <div className="backup-actions"><Button variant="soft" icon={<ClipboardCopy size={17} />} onClick={copyBackup}>Copia backup</Button><Button variant="soft" icon={<Download size={17} />} onClick={downloadBackup}>Scarica JSON</Button></div>
        <Field label="Importa backup" hint="Incolla qui un backup JSON creato da VerdoFamily."><textarea rows={5} value={importText} onChange={e => setImportText(e.target.value)} /></Field>
        <div className="backup-footer"><Button variant="ghost" icon={<Upload size={17} />} onClick={doImport}>Importa</Button><Button variant="danger" icon={<RotateCcw size={17} />} onClick={() => { if (confirm('Ripristinare i dati demo? Questa operazione cancella i dati locali.')) resetData() }}>Ripristina dati demo</Button></div>
        {message ? <div className="callout callout--success">{message}</div> : null}
      </Card>
    </div>
  </div>
}
