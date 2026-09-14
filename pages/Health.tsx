import React, { useMemo, useState } from 'react'
import { Activity, Check, FileText, HeartPulse, Package, Pencil, Pill, Plus, Stethoscope, Trash2 } from 'lucide-react'
import { useFamily } from '../store'
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Modal, PageIntro, Segmented } from '../ui'
import { localDateISO, medicineInventorySummary, parseISODate, therapyDailyUse, therapyLineRequiredTablets } from '../utils'

type HealthSection = 'overview' | 'visits' | 'inventory' | 'therapy' | 'records'

function formatDate(value?: string) {
  if (!value) return '—'
  try {
    return parseISODate(value).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return value
  }
}

function positiveNumber(value: any) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function nonNegativeNumber(value: any) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

function therapyPhase(item: any) {
  if (item.done) return { label: 'Archiviata', tone: 'success' as const }
  const start = item.therapyStartDate || ''
  const end = item.therapyEndDate || ''
  const today = localDateISO()
  if (!start) return { label: 'Da definire', tone: 'warning' as const }
  if (end && end < start) return { label: 'Date da verificare', tone: 'danger' as const }
  if (today < start) return { label: 'Programmata', tone: 'neutral' as const }
  if (end && today > end) return { label: 'Terminata', tone: 'success' as const }
  if (end && today === end) return { label: 'Ultimo giorno', tone: 'warning' as const }
  return { label: 'In corso', tone: 'violet' as const }
}

function stockStatus(summary: ReturnType<typeof medicineInventorySummary>, done: boolean) {
  if (done) return { label: 'Archiviato', tone: 'success' as const }
  if (summary.packageCount > 0 && summary.totalStock <= 0) return { label: 'Esaurito', tone: 'danger' as const }
  if (summary.shortageDate || summary.shortageKnown > 0) return { label: 'Scorta insufficiente', tone: 'warning' as const }
  if (summary.expiredPackageCount > 0) return { label: 'Scaduti presenti', tone: 'danger' as const }
  if (summary.expiringSoonPackageCount > 0) return { label: 'Scadenza vicina', tone: 'warning' as const }
  if (!summary.packageCount) return { label: 'Nessuna confezione', tone: 'neutral' as const }
  return { label: 'Scorta OK', tone: 'success' as const }
}

function visitStatus(item: any) {
  const status = item.healthStatus || (item.done ? 'completed' : 'scheduled')
  if (status === 'completed') return { label: 'Effettuata', tone: 'success' as const }
  if (status === 'cancelled') return { label: 'Annullata', tone: 'neutral' as const }
  if (item.date < localDateISO()) return { label: 'Da aggiornare', tone: 'warning' as const }
  return { label: 'Programmata', tone: 'violet' as const }
}

function recordKindLabel(kind?: string) {
  return ({ exam: 'Esame', report: 'Referto', vaccine: 'Vaccino', document: 'Documento', note: 'Nota clinica' } as Record<string, string>)[kind || ''] || 'Documento'
}

function nextNestedId(list: Array<{ id?: number }>) {
  return list.length ? Math.max(...list.map(item => Number(item.id || 0))) + 1 : 1
}

export default function HealthPage() {
  const { data, authUser, upsertDeadline, toggleDeadline, deleteDeadline } = useFamily()
  const [section, setSection] = useState<HealthSection>('overview')
  const [editing, setEditing] = useState<any>(null)
  const [personFilter, setPersonFilter] = useState<number | 'all'>('all')

  const medicines = useMemo(
    () => data.deadlines.filter(item => item.kind === 'medicine').slice().sort((a, b) => Number(a.done) - Number(b.done) || a.title.localeCompare(b.title)),
    [data.deadlines]
  )
  const therapies = useMemo(
    () => data.deadlines.filter(item => item.kind === 'therapy').slice().sort((a, b) => Number(a.done) - Number(b.done) || (a.therapyStartDate || a.date).localeCompare(b.therapyStartDate || b.date)),
    [data.deadlines]
  )
  const visits = useMemo(
    () => data.deadlines.filter(item => item.kind === 'visit').slice().sort((a, b) => {
      const aScheduled = (a.healthStatus || 'scheduled') === 'scheduled' && a.date >= localDateISO()
      const bScheduled = (b.healthStatus || 'scheduled') === 'scheduled' && b.date >= localDateISO()
      if (aScheduled !== bScheduled) return aScheduled ? -1 : 1
      return aScheduled ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)
    }),
    [data.deadlines]
  )
  const records = useMemo(
    () => data.deadlines.filter(item => item.kind === 'health-record').slice().sort((a, b) => b.date.localeCompare(a.date)),
    [data.deadlines]
  )

  const visibleVisits = personFilter === 'all' ? visits : visits.filter(item => item.userId === personFilter)
  const visibleTherapies = personFilter === 'all' ? therapies : therapies.filter(item => item.userId === personFilter)
  const visibleRecords = personFilter === 'all' ? records : records.filter(item => item.userId === personFilter)
  const today = localDateISO()
  const upcomingVisits = visibleVisits.filter(item => (item.healthStatus || 'scheduled') === 'scheduled' && item.date >= today)
  const activeTherapies = visibleTherapies.filter(item => !item.done && (item.therapyStartDate || item.date) <= today && (!item.therapyEndDate || item.therapyEndDate >= today))
  const medicineAlerts = medicines.filter(item => {
    const summary = medicineInventorySummary(item, therapies)
    return !item.done && (summary.shortageDate || summary.shortageKnown > 0 || summary.expiredPackageCount > 0 || summary.expiringSoonPackageCount > 0)
  })

  function blankPackage(existing: any[] = []) {
    return { id: nextNestedId(existing), expiryDate: '', quantity: '', packageSize: '', lot: '', addedAt: localDateISO() }
  }

  function blankTherapyMedicine(existing: any[] = []) {
    const used = new Set(existing.map(line => Number(line.medicineId || 0)))
    const firstAvailable = medicines.find(medicine => !used.has(medicine.id)) || medicines[0]
    return { id: nextNestedId(existing), medicineId: firstAvailable?.id || 0, tabletsPerDose: 1, dosesPerDay: 1, usage: '' }
  }

  function openNew(kind: 'visit' | 'inventory' | 'therapy' | 'record') {
    if (kind === 'visit') {
      setEditing({ id: undefined, title: '', date: localDateISO(), time: '', userId: authUser?.id || data.users[0]?.id || 1, done: false, kind: 'visit', healthStatus: 'scheduled', specialty: '', doctor: '', facility: '', purpose: '', outcome: '', nextVisitDate: '', notes: '' })
      return
    }
    if (kind === 'record') {
      setEditing({ id: undefined, title: '', date: localDateISO(), userId: authUser?.id || data.users[0]?.id || 1, done: false, kind: 'health-record', healthRecordKind: 'exam', provider: '', result: '', notes: '' })
      return
    }
    if (kind === 'inventory') {
      setEditing({ id: undefined, title: '', date: localDateISO(), userId: 0, done: false, kind: 'medicine', activeIngredient: '', purpose: '', notes: '', defaultPackageSize: '', packages: [blankPackage()] })
      return
    }
    setEditing({ id: undefined, title: '', date: localDateISO(), userId: authUser?.id || data.users[0]?.id || 1, done: false, kind: 'therapy', prescriber: '', purpose: '', notes: '', therapyStartDate: localDateISO(), therapyEndDate: '', therapyMedicines: medicines.length ? [blankTherapyMedicine()] : [] })
  }

  function editItem(item: any) {
    const copy = JSON.parse(JSON.stringify(item))
    if (copy.kind === 'medicine') copy.packages ||= []
    if (copy.kind === 'therapy') copy.therapyMedicines ||= []
    setEditing(copy)
  }

  function save() {
    if (!editing) return

    if (editing.kind === 'visit') {
      if (!editing.title?.trim() || !editing.date) return
      const status = editing.healthStatus || 'scheduled'
      upsertDeadline({
        ...editing,
        title: editing.title.trim(),
        userId: Number(editing.userId),
        kind: 'visit',
        healthStatus: status,
        done: status === 'completed' || status === 'cancelled',
        specialty: editing.specialty?.trim() || '',
        doctor: editing.doctor?.trim() || '',
        facility: editing.facility?.trim() || '',
        purpose: editing.purpose?.trim() || '',
        outcome: editing.outcome?.trim() || '',
        notes: editing.notes?.trim() || ''
      })
      setEditing(null)
      return
    }

    if (editing.kind === 'health-record') {
      if (!editing.title?.trim() || !editing.date) return
      upsertDeadline({ ...editing, title: editing.title.trim(), userId: Number(editing.userId), kind: 'health-record', done: false, provider: editing.provider?.trim() || '', result: editing.result?.trim() || '', notes: editing.notes?.trim() || '' })
      setEditing(null)
      return
    }

    if (editing.kind === 'medicine') {
      if (!editing.title?.trim()) return
      const packages = (editing.packages || []).filter((pkg: any) => pkg.expiryDate || pkg.lot?.trim() || Number(pkg.quantity || 0) > 0).map((pkg: any, index: number) => ({
        id: Number(pkg.id) || index + 1,
        expiryDate: pkg.expiryDate || '',
        quantity: nonNegativeNumber(pkg.quantity),
        packageSize: positiveNumber(pkg.packageSize),
        lot: pkg.lot?.trim() || '',
        addedAt: pkg.addedAt || localDateISO()
      }))
      const nearestExpiry = packages.map((pkg: any) => pkg.expiryDate).filter(Boolean).sort()[0] || localDateISO()
      upsertDeadline({ ...editing, title: editing.title.trim(), date: nearestExpiry, userId: 0, kind: 'medicine', activeIngredient: editing.activeIngredient?.trim() || '', purpose: editing.purpose?.trim() || '', notes: editing.notes?.trim() || '', defaultPackageSize: positiveNumber(editing.defaultPackageSize), packages, therapyStartDate: undefined, therapyEndDate: undefined, therapyMedicines: undefined, prescriber: undefined, usage: undefined })
      setEditing(null)
      return
    }

    if (editing.kind === 'therapy') {
      if (!editing.therapyStartDate) return alert('Indica almeno la data di inizio della terapia.')
      if (editing.therapyEndDate && editing.therapyEndDate < editing.therapyStartDate) return alert('La data di fine terapia non può essere precedente alla data di inizio.')
      const therapyMedicines = (editing.therapyMedicines || []).filter((line: any) => Number(line.medicineId || 0) > 0).map((line: any, index: number) => ({
        id: Number(line.id) || index + 1,
        medicineId: Number(line.medicineId),
        tabletsPerDose: Number(positiveNumber(line.tabletsPerDose) || 1),
        dosesPerDay: Number(positiveNumber(line.dosesPerDay) || 1),
        usage: line.usage?.trim() || ''
      }))
      if (!therapyMedicines.length) return alert('Aggiungi almeno un medicinale alla terapia.')
      const patient = data.users.find(user => user.id === Number(editing.userId))
      const title = editing.title?.trim() || `Terapia ${patient?.name || ''}`.trim()
      upsertDeadline({ ...editing, title, date: editing.therapyEndDate || editing.therapyStartDate, userId: Number(editing.userId || authUser?.id || data.users[0]?.id || 1), kind: 'therapy', prescriber: editing.prescriber?.trim() || '', purpose: editing.purpose?.trim() || '', notes: editing.notes?.trim() || '', therapyStartDate: editing.therapyStartDate, therapyEndDate: editing.therapyEndDate || '', therapyMedicines })
      setEditing(null)
    }
  }

  function deleteEditing() {
    if (!editing?.id) return
    if (editing.kind === 'medicine') {
      const linked = therapies.filter(therapy => (therapy.therapyMedicines || []).some(line => Number(line.medicineId) === Number(editing.id)))
      if (linked.length) return alert(`Questo medicinale è collegato a ${linked.length} ${linked.length === 1 ? 'terapia' : 'terapie'}. Rimuovilo prima dalle terapie oppure archivialo.`)
    }
    deleteDeadline(editing.id)
    setEditing(null)
  }

  function addPackage() {
    const current = editing?.packages || []
    setEditing({ ...editing, packages: [...current, blankPackage(current)] })
  }
  function updatePackage(id: number, patch: any) { setEditing({ ...editing, packages: (editing.packages || []).map((pkg: any) => Number(pkg.id) === Number(id) ? { ...pkg, ...patch } : pkg) }) }
  function removePackage(id: number) { setEditing({ ...editing, packages: (editing.packages || []).filter((pkg: any) => Number(pkg.id) !== Number(id)) }) }
  function addTherapyMedicine() {
    const current = editing?.therapyMedicines || []
    if (medicines.length) setEditing({ ...editing, therapyMedicines: [...current, blankTherapyMedicine(current)] })
  }
  function updateTherapyMedicine(id: number, patch: any) { setEditing({ ...editing, therapyMedicines: (editing.therapyMedicines || []).map((line: any) => Number(line.id) === Number(id) ? { ...line, ...patch } : line) }) }
  function removeTherapyMedicine(id: number) { setEditing({ ...editing, therapyMedicines: (editing.therapyMedicines || []).filter((line: any) => Number(line.id) !== Number(id)) }) }

  const planningTherapies = editing?.kind === 'therapy' ? (editing.id ? therapies.map(therapy => therapy.id === editing.id ? editing : therapy) : [...therapies, { ...editing, id: -1 }]) : therapies

  const pageAction = section === 'visits'
    ? <Button icon={<Plus size={18} />} onClick={() => openNew('visit')}>Nuova visita</Button>
    : section === 'inventory'
      ? <Button icon={<Package size={18} />} onClick={() => openNew('inventory')}>Aggiungi medicinale</Button>
      : section === 'therapy'
        ? <Button icon={<Stethoscope size={18} />} onClick={() => openNew('therapy')} disabled={!medicines.length}>Nuova terapia</Button>
        : section === 'records'
          ? <Button icon={<Plus size={18} />} onClick={() => openNew('record')}>Nuovo documento</Button>
          : <Button icon={<Plus size={18} />} onClick={() => openNew('visit')}>Aggiungi visita</Button>

  return <div className="page">
    <PageIntro eyebrow="Cartella sanitaria familiare" title="Salute" description="Visite, terapie, medicinali, esami e documenti sanitari raccolti in un unico posto, senza mescolarli con le normali scadenze." actions={pageAction} />

    <div className="page-tabs-wrap">
      <Segmented value={section} onChange={setSection} options={[
        { value: 'overview', label: 'Panoramica' },
        { value: 'visits', label: 'Visite' },
        { value: 'therapy', label: 'Terapie' },
        { value: 'inventory', label: 'Medicine' },
        { value: 'records', label: 'Esami & referti' }
      ]} />
    </div>

    {(section === 'overview' || section === 'visits' || section === 'therapy' || section === 'records') ? <div style={{ marginBottom: 14, maxWidth: 320 }}><Field label="Persona"><select value={personFilter} onChange={e => setPersonFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}><option value="all">Tutta la famiglia</option>{data.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></Field></div> : null}

    {section === 'overview' ? <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginBottom: 14 }}>
        <Card><CardHeader title="Prossime visite" subtitle={upcomingVisits.length ? `${upcomingVisits.length} programmate` : 'Nessuna visita imminente'} /><strong style={{ fontSize: 26 }}>{upcomingVisits.length}</strong>{upcomingVisits[0] ? <div className="muted" style={{ marginTop: 6 }}>{formatDate(upcomingVisits[0].date)} · {upcomingVisits[0].title}</div> : null}</Card>
        <Card><CardHeader title="Terapie attive" subtitle="In corso oggi" /><strong style={{ fontSize: 26 }}>{activeTherapies.length}</strong>{activeTherapies[0] ? <div className="muted" style={{ marginTop: 6 }}>{activeTherapies[0].title}</div> : null}</Card>
        <Card><CardHeader title="Medicine da controllare" subtitle="Scorte o scadenze" /><strong style={{ fontSize: 26 }}>{medicineAlerts.length}</strong>{medicineAlerts[0] ? <div className="muted" style={{ marginTop: 6 }}>{medicineAlerts[0].title}</div> : null}</Card>
        <Card><CardHeader title="Storico sanitario" subtitle="Visite e documenti registrati" /><strong style={{ fontSize: 26 }}>{visibleVisits.filter(v => v.healthStatus === 'completed').length + visibleRecords.length}</strong></Card>
      </div>

      <Card>
        <CardHeader title="Prossime attività" subtitle="Visite programmate e terapie attive della persona selezionata." />
        {upcomingVisits.length || activeTherapies.length ? <div className="deadline-list">
          {upcomingVisits.slice(0, 5).map(item => { const user = data.users.find(u => u.id === item.userId); return <div className="deadline-row" key={`v-${item.id}`}><div className="deadline-date"><strong>{item.date.slice(8, 10)}</strong><span>{item.date.slice(5, 7)}</span></div><div className="deadline-copy"><strong>{item.title}</strong><span>{user?.name}{item.doctor ? ` · ${item.doctor}` : ''}{item.facility ? ` · ${item.facility}` : ''}</span></div><Badge tone="violet">Visita</Badge><IconButton label="Apri" onClick={() => { setSection('visits'); editItem(item) }}><Pencil size={17} /></IconButton></div> })}
          {activeTherapies.slice(0, 5).map(item => { const user = data.users.find(u => u.id === item.userId); return <div className="deadline-row" key={`t-${item.id}`}><div className="deadline-date"><strong>{(item.therapyEndDate || item.date)?.slice(8, 10) || '—'}</strong><span>{(item.therapyEndDate || item.date)?.slice(5, 7) || '—'}</span></div><div className="deadline-copy"><strong>{item.title}</strong><span>{user?.name} · {item.therapyEndDate ? `fino al ${formatDate(item.therapyEndDate)}` : 'continuativa'}</span></div><Badge tone="success">Terapia</Badge><IconButton label="Apri" onClick={() => { setSection('therapy'); editItem(item) }}><Pencil size={17} /></IconButton></div> })}
        </div> : <EmptyState icon={<HeartPulse size={28} />} title="Tutto tranquillo" text="Non risultano visite imminenti o terapie attive per la selezione corrente." />}
      </Card>
    </> : null}

    {section === 'visits' ? <Card>
      <CardHeader title="Visite e controlli" subtitle="Programma le prossime visite e conserva lo storico di quelle già effettuate." />
      {visibleVisits.length ? <div className="deadline-list">{visibleVisits.map(item => {
        const user = data.users.find(u => u.id === item.userId)
        const status = visitStatus(item)
        const details = [user?.name, item.specialty, item.doctor, item.facility, item.time ? `ore ${item.time}` : '', item.nextVisitDate ? `prossimo controllo ${formatDate(item.nextVisitDate)}` : ''].filter(Boolean).join(' · ')
        return <div key={item.id} className={`deadline-row ${item.healthStatus === 'cancelled' ? 'is-done' : ''}`}>
          <div className="deadline-date"><strong>{item.date.slice(8, 10)}</strong><span>{item.date.slice(5, 7)}</span></div>
          <div className="deadline-copy"><strong>{item.title}</strong><span>{details}</span>{item.outcome ? <span>Esito: {item.outcome}</span> : null}</div>
          <Badge tone={status.tone}>{status.label}</Badge>
          <IconButton label="Modifica" onClick={() => editItem(item)}><Pencil size={17} /></IconButton>
          <IconButton label="Elimina" onClick={() => deleteDeadline(item.id)}><Trash2 size={17} /></IconButton>
        </div>
      })}</div> : <EmptyState icon={<Stethoscope size={28} />} title="Nessuna visita registrata" text="Inserisci una visita programmata oppure ricostruisci lo storico delle visite già effettuate." action={<Button onClick={() => openNew('visit')}>Aggiungi visita</Button>} />}
    </Card> : null}

    {section === 'records' ? <Card>
      <CardHeader title="Esami, referti e documenti" subtitle="Uno storico semplice per analisi, referti, vaccini, certificati e note sanitarie." />
      {visibleRecords.length ? <div className="deadline-list">{visibleRecords.map(item => { const user = data.users.find(u => u.id === item.userId); return <div key={item.id} className="deadline-row"><div className="deadline-date"><strong>{item.date.slice(8, 10)}</strong><span>{item.date.slice(5, 7)}</span></div><div className="deadline-copy"><strong>{item.title}</strong><span>{user?.name} · {recordKindLabel(item.healthRecordKind)}{item.provider ? ` · ${item.provider}` : ''}</span>{item.result ? <span>Esito: {item.result}</span> : null}</div><Badge tone="neutral">{recordKindLabel(item.healthRecordKind)}</Badge><IconButton label="Modifica" onClick={() => editItem(item)}><Pencil size={17} /></IconButton><IconButton label="Elimina" onClick={() => deleteDeadline(item.id)}><Trash2 size={17} /></IconButton></div> })}</div> : <EmptyState icon={<FileText size={28} />} title="Nessun documento sanitario" text="Registra esami, referti, vaccini o altre informazioni cliniche." action={<Button onClick={() => openNew('record')}>Aggiungi documento</Button>} />}
    </Card> : null}

    {section === 'inventory' ? <Card>
      <CardHeader title="Magazzino medicinali" subtitle="Ogni medicinale può avere più confezioni, anche con scadenze diverse. Le scorte sono condivise tra tutte le terapie." />
      {medicines.length ? <div className="deadline-list">{medicines.map(item => {
        const summary = medicineInventorySummary(item, therapies)
        const status = stockStatus(summary, item.done)
        const details = [`${summary.packageCount} ${summary.packageCount === 1 ? 'confezione' : 'confezioni'}`, `${summary.totalStock} compresse disponibili`, summary.therapyCount ? `${summary.therapyCount} terapie collegate` : 'nessuna terapia collegata', summary.activeDailyUse ? `consumo ${summary.activeDailyUse}/giorno` : '', summary.coverageUntil ? `copertura fino al ${formatDate(summary.coverageUntil)}` : '', summary.shortageKnown ? `mancano almeno ${summary.shortageKnown} compresse${summary.packagesToBuy ? ` (≈ ${summary.packagesToBuy} conf.)` : ''}` : ''].filter(Boolean).join(' · ')
        const expiry = summary.earliestExpiry
        return <div key={item.id} className={`deadline-row ${item.done ? 'is-done' : ''}`}><button className="check-item__check" onClick={() => toggleDeadline(item.id)}>{item.done ? <Check size={16} /> : null}</button><div className="deadline-date"><strong>{expiry ? expiry.slice(8, 10) : '—'}</strong><span>{expiry ? expiry.slice(5, 7) : 'SCAD'}</span></div><div className="deadline-copy"><strong>{item.title}</strong><span>{details}</span></div><Badge tone={status.tone}>{status.label}</Badge><IconButton label="Modifica" onClick={() => editItem(item)}><Pencil size={17} /></IconButton><IconButton label="Elimina" onClick={() => { const linked = therapies.some(therapy => (therapy.therapyMedicines || []).some(line => Number(line.medicineId) === item.id)); if (linked) alert('Il medicinale è collegato a una terapia. Rimuovilo prima dalla terapia o archivialo.'); else deleteDeadline(item.id) }}><Trash2 size={17} /></IconButton></div>
      })}</div> : <EmptyState icon={<Package size={26} />} title="Magazzino vuoto" text="Inserisci un medicinale e le confezioni che hai in casa." action={<Button onClick={() => openNew('inventory')}>Aggiungi medicinale</Button>} />}
    </Card> : null}

    {section === 'therapy' ? <Card>
      <CardHeader title="Terapie prescritte" subtitle="Una terapia può contenere più medicinali e può richiedere più confezioni dello stesso farmaco." />
      {!medicines.length ? <EmptyState icon={<Pill size={26} />} title="Prima crea il magazzino" text="Aggiungi almeno un medicinale; poi potrai collegarlo alle terapie." action={<Button onClick={() => setSection('inventory')}>Vai alle medicine</Button>} /> : visibleTherapies.length ? <div className="deadline-list">{visibleTherapies.map(item => {
        const user = data.users.find(person => person.id === item.userId)
        const phase = therapyPhase(item)
        const lineDetails = (item.therapyMedicines || []).map(line => {
          const medicine = medicines.find(product => product.id === Number(line.medicineId))
          if (!medicine) return 'Medicinale non trovato'
          const required = item.therapyEndDate ? therapyLineRequiredTablets(item.therapyStartDate || '', item.therapyEndDate, line) : null
          const packSize = Number(medicine.defaultPackageSize || medicine.packages?.find(pkg => Number(pkg.packageSize || 0) > 0)?.packageSize || 0)
          const boxes = required !== null && packSize > 0 ? Math.ceil(Number(required || 0) / packSize) : 0
          const globalSummary = medicineInventorySummary(medicine, therapies)
          const warning = globalSummary.shortageDate ? ` ⚠ scorta insufficiente dal ${formatDate(globalSummary.shortageDate)}` : ''
          return `${medicine.title}: ${line.tabletsPerDose} × ${line.dosesPerDay}/g${required !== null ? ` · ${required} cps${boxes ? ` ≈ ${boxes} conf.` : ''}` : ' · continuativa'}${warning}`
        }).join(' | ')
        const details = [user?.name ? `Per ${user.name}` : '', item.prescriber ? `Dr. ${item.prescriber}` : '', `${formatDate(item.therapyStartDate)} → ${item.therapyEndDate ? formatDate(item.therapyEndDate) : 'continuativa'}`, lineDetails].filter(Boolean).join(' · ')
        return <div key={item.id} className={`deadline-row ${item.done ? 'is-done' : ''}`}><button className="check-item__check" onClick={() => toggleDeadline(item.id)}>{item.done ? <Check size={16} /> : null}</button><div className="deadline-date"><strong>{(item.therapyStartDate || item.date).slice(8, 10)}</strong><span>{(item.therapyStartDate || item.date).slice(5, 7)}</span></div><div className="deadline-copy"><strong>{item.title}</strong><span>{details}</span></div><Badge tone={phase.tone}>{phase.label}</Badge><IconButton label="Modifica" onClick={() => editItem(item)}><Pencil size={17} /></IconButton><IconButton label="Elimina" onClick={() => deleteDeadline(item.id)}><Trash2 size={17} /></IconButton></div>
      })}</div> : <EmptyState icon={<Stethoscope size={26} />} title="Nessuna terapia" text="Registra una prescrizione e collega uno o più medicinali dal magazzino." action={<Button onClick={() => openNew('therapy')}>Nuova terapia</Button>} />}
    </Card> : null}

    <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.kind === 'visit' ? (editing?.id ? 'Modifica visita' : 'Nuova visita') : editing?.kind === 'health-record' ? (editing?.id ? 'Modifica documento sanitario' : 'Nuovo documento sanitario') : editing?.kind === 'medicine' ? (editing?.id ? 'Modifica medicinale' : 'Nuovo medicinale') : (editing?.id ? 'Modifica terapia' : 'Nuova terapia')} size={editing?.kind === 'visit' || editing?.kind === 'health-record' ? 'md' : 'lg'} footer={<div className="modal-actions"><div>{editing?.id ? <Button variant="danger" onClick={deleteEditing}>Elimina</Button> : null}</div><div className="modal-actions__right"><Button variant="ghost" onClick={() => setEditing(null)}>Annulla</Button><Button onClick={save}>Salva</Button></div></div>}>
      {editing?.kind === 'visit' ? <div className="form-grid form-grid--2">
        <Field label="Visita / controllo" className="field--wide"><input autoFocus value={editing.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Es. Visita cardiologica" /></Field>
        <Field label="Persona"><select value={editing.userId} onChange={e => setEditing({ ...editing, userId: Number(e.target.value) })}>{data.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></Field>
        <Field label="Stato"><select value={editing.healthStatus || 'scheduled'} onChange={e => setEditing({ ...editing, healthStatus: e.target.value })}><option value="scheduled">Programmata</option><option value="completed">Effettuata</option><option value="cancelled">Annullata</option></select></Field>
        <Field label="Data"><input type="date" value={editing.date || ''} onChange={e => setEditing({ ...editing, date: e.target.value })} /></Field>
        <Field label="Ora"><input type="time" value={editing.time || ''} onChange={e => setEditing({ ...editing, time: e.target.value })} /></Field>
        <Field label="Specialità"><input value={editing.specialty || ''} onChange={e => setEditing({ ...editing, specialty: e.target.value })} placeholder="Es. Cardiologia" /></Field>
        <Field label="Medico / specialista"><input value={editing.doctor || ''} onChange={e => setEditing({ ...editing, doctor: e.target.value })} /></Field>
        <Field label="Struttura"><input value={editing.facility || ''} onChange={e => setEditing({ ...editing, facility: e.target.value })} /></Field>
        <Field label="Prossimo controllo"><input type="date" value={editing.nextVisitDate || ''} onChange={e => setEditing({ ...editing, nextVisitDate: e.target.value })} /></Field>
        <Field label="Motivo" className="field--wide"><textarea rows={2} value={editing.purpose || ''} onChange={e => setEditing({ ...editing, purpose: e.target.value })} /></Field>
        <Field label="Esito / indicazioni" className="field--wide"><textarea rows={3} value={editing.outcome || ''} onChange={e => setEditing({ ...editing, outcome: e.target.value })} /></Field>
        <Field label="Note" className="field--wide"><textarea rows={2} value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} /></Field>
      </div> : null}

      {editing?.kind === 'health-record' ? <div className="form-grid form-grid--2">
        <Field label="Titolo" className="field--wide"><input autoFocus value={editing.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Es. Analisi del sangue" /></Field>
        <Field label="Persona"><select value={editing.userId} onChange={e => setEditing({ ...editing, userId: Number(e.target.value) })}>{data.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></Field>
        <Field label="Tipo"><select value={editing.healthRecordKind || 'exam'} onChange={e => setEditing({ ...editing, healthRecordKind: e.target.value })}><option value="exam">Esame</option><option value="report">Referto</option><option value="vaccine">Vaccino</option><option value="document">Documento / certificato</option><option value="note">Nota clinica</option></select></Field>
        <Field label="Data"><input type="date" value={editing.date || ''} onChange={e => setEditing({ ...editing, date: e.target.value })} /></Field>
        <Field label="Struttura / professionista"><input value={editing.provider || ''} onChange={e => setEditing({ ...editing, provider: e.target.value })} /></Field>
        <Field label="Esito / risultato" className="field--wide"><textarea rows={3} value={editing.result || ''} onChange={e => setEditing({ ...editing, result: e.target.value })} /></Field>
        <Field label="Note" className="field--wide"><textarea rows={3} value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} /></Field>
      </div> : null}

      {editing?.kind === 'medicine' ? <div className="form-grid form-grid--2">
        <Field label="Nome medicinale" className="field--wide"><input autoFocus value={editing.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Es. Tachipirina 500 mg" /></Field>
        <Field label="Principio attivo"><input value={editing.activeIngredient || ''} onChange={e => setEditing({ ...editing, activeIngredient: e.target.value })} placeholder="Facoltativo" /></Field>
        <Field label="Compresse per confezione" hint="Serve per stimare quante scatole acquistare."><input type="number" min="0" step="1" value={editing.defaultPackageSize ?? ''} onChange={e => setEditing({ ...editing, defaultPackageSize: e.target.value })} placeholder="Es. 30" /></Field>
        <Field label="A cosa serve" className="field--wide"><input value={editing.purpose || ''} onChange={e => setEditing({ ...editing, purpose: e.target.value })} /></Field>
        <Field label="Note" className="field--wide"><textarea rows={2} value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} /></Field>
        <Card className="field--wide"><CardHeader title="Confezioni in magazzino" subtitle="Ogni riga rappresenta una confezione fisica. Quantità = compresse effettivamente rimaste oggi." action={<Button size="sm" variant="soft" icon={<Plus size={15} />} onClick={addPackage}>Confezione</Button>} />
          {(editing.packages || []).length ? <div className="receipt-matches">{(editing.packages || []).map((pkg: any, index: number) => <div className="receipt-match" key={pkg.id}><div className="receipt-match__head"><strong>Confezione {index + 1}</strong><IconButton label="Rimuovi confezione" onClick={() => removePackage(pkg.id)}><Trash2 size={16} /></IconButton></div><div className="form-grid form-grid--2" style={{ marginTop: 10 }}><Field label="Scadenza"><input type="date" value={pkg.expiryDate || ''} onChange={e => updatePackage(pkg.id, { expiryDate: e.target.value })} /></Field><Field label="Compresse rimaste"><input type="number" min="0" step="0.25" value={pkg.quantity ?? ''} onChange={e => updatePackage(pkg.id, { quantity: e.target.value })} /></Field><Field label="Contenuto originale"><input type="number" min="0" step="1" value={pkg.packageSize ?? ''} onChange={e => updatePackage(pkg.id, { packageSize: e.target.value })} /></Field><Field label="Lotto"><input value={pkg.lot || ''} onChange={e => updatePackage(pkg.id, { lot: e.target.value })} /></Field></div></div>)}</div> : <EmptyState title="Nessuna confezione" text="Puoi tenere il medicinale in anagrafica anche senza scorta." action={<Button variant="soft" onClick={addPackage}>Aggiungi confezione</Button>} />}
        </Card>
      </div> : null}

      {editing?.kind === 'therapy' ? <div className="form-grid form-grid--2">
        <Field label="Nome terapia" className="field--wide"><input autoFocus value={editing.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Es. Terapia antibiotica" /></Field>
        <Field label="Prescritta a"><select value={editing.userId || authUser?.id || ''} onChange={e => setEditing({ ...editing, userId: Number(e.target.value) })}>{data.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></Field>
        <Field label="Prescritta da"><input value={editing.prescriber || ''} onChange={e => setEditing({ ...editing, prescriber: e.target.value })} placeholder="Medico / specialista" /></Field>
        <Field label="Inizio terapia"><input type="date" value={editing.therapyStartDate || ''} onChange={e => setEditing({ ...editing, therapyStartDate: e.target.value })} /></Field>
        <Field label="Fine terapia" hint="Lascia vuoto per una terapia continuativa."><input type="date" min={editing.therapyStartDate || undefined} value={editing.therapyEndDate || ''} onChange={e => setEditing({ ...editing, therapyEndDate: e.target.value })} /></Field>
        <Field label="Motivo / indicazione" className="field--wide"><input value={editing.purpose || ''} onChange={e => setEditing({ ...editing, purpose: e.target.value })} /></Field>
        <Card className="field--wide"><CardHeader title="Medicinali della terapia" subtitle="Puoi aggiungerne più di uno. Il fabbisogno viene confrontato con il magazzino condiviso." action={<Button size="sm" variant="soft" icon={<Plus size={15} />} onClick={addTherapyMedicine} disabled={!medicines.length}>Farmaco</Button>} />
          {(editing.therapyMedicines || []).length ? <div className="receipt-matches">{(editing.therapyMedicines || []).map((line: any, index: number) => {
            const medicine = medicines.find(product => product.id === Number(line.medicineId))
            const required = editing.therapyEndDate ? therapyLineRequiredTablets(editing.therapyStartDate || '', editing.therapyEndDate, line) : null
            const packageSize = Number(medicine?.defaultPackageSize || medicine?.packages?.find(pkg => Number(pkg.packageSize || 0) > 0)?.packageSize || 0)
            const boxes = required !== null && packageSize > 0 ? Math.ceil(Number(required || 0) / packageSize) : 0
            const summary = medicine ? medicineInventorySummary(medicine, planningTherapies as any) : null
            return <div className="receipt-match" key={line.id}><div className="receipt-match__head"><strong>Medicinale {index + 1}</strong><IconButton label="Rimuovi medicinale" onClick={() => removeTherapyMedicine(line.id)}><Trash2 size={16} /></IconButton></div><div className="form-grid form-grid--2" style={{ marginTop: 10 }}><Field label="Medicinale" className="field--wide"><select value={line.medicineId || 0} onChange={e => updateTherapyMedicine(line.id, { medicineId: Number(e.target.value) })}>{medicines.map(product => <option key={product.id} value={product.id}>{product.title}</option>)}</select></Field><Field label="Compresse per assunzione"><input type="number" min="0" step="0.25" value={line.tabletsPerDose ?? ''} onChange={e => updateTherapyMedicine(line.id, { tabletsPerDose: e.target.value })} /></Field><Field label="Assunzioni al giorno" hint="0,5 = una volta ogni due giorni."><input type="number" min="0" step="0.25" value={line.dosesPerDay ?? ''} onChange={e => updateTherapyMedicine(line.id, { dosesPerDay: e.target.value })} /></Field><Field label="Modalità d'uso" className="field--wide"><input value={line.usage || ''} onChange={e => updateTherapyMedicine(line.id, { usage: e.target.value })} /></Field></div>{medicine ? <div className={summary?.shortageDate ? 'callout callout--warning' : 'callout callout--success'} style={{ marginTop: 10 }}><strong>{medicine.title}</strong>: {therapyDailyUse(line)} compresse/giorno{required !== null ? ` · ${required} compresse${boxes ? ` (≈ ${boxes} confezioni)` : ''}` : ' · terapia continuativa'}.{summary?.shortageDate ? ` Scorta insufficiente dal ${formatDate(summary.shortageDate)}.` : ' Scorta compatibile con le terapie note.'}</div> : null}</div>
          })}</div> : <EmptyState title="Nessun medicinale collegato" text="Aggiungi almeno un farmaco dal magazzino." action={<Button variant="soft" onClick={addTherapyMedicine} disabled={!medicines.length}>Aggiungi farmaco</Button>} />}
        </Card>
        <Field label="Note sulla terapia" className="field--wide"><textarea rows={3} value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} /></Field>
      </div> : null}
    </Modal>
  </div>
}
