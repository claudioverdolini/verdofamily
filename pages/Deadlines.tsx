import React, { useMemo, useState } from 'react'
import { Check, Package, Pencil, Pill, Plus, Stethoscope, Trash2 } from 'lucide-react'
import { useFamily } from '../store'
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Modal, PageIntro, Segmented } from '../ui'
import { localDateISO, medicineInventorySummary, parseISODate, therapyDailyUse, therapyLineRequiredTablets } from '../utils'

type DeadlineSection = 'general' | 'inventory' | 'therapy'

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
  if (item.done) return { label: 'Archiviata', tone: 'success' }
  const start = item.therapyStartDate || ''
  const end = item.therapyEndDate || ''
  const today = localDateISO()
  if (!start) return { label: 'Da definire', tone: 'warning' }
  if (end && end < start) return { label: 'Date da verificare', tone: 'danger' }
  if (today < start) return { label: 'Programmata', tone: 'neutral' }
  if (end && today > end) return { label: 'Terminata', tone: 'success' }
  if (end && today === end) return { label: 'Ultimo giorno', tone: 'warning' }
  return { label: 'In corso', tone: 'violet' }
}

function stockStatus(summary: ReturnType<typeof medicineInventorySummary>, done: boolean) {
  if (done) return { label: 'Archiviato', tone: 'success' }
  if (summary.packageCount > 0 && summary.totalStock <= 0) return { label: 'Esaurito', tone: 'danger' }
  if (summary.shortageDate || summary.shortageKnown > 0) return { label: 'Scorta insufficiente', tone: 'warning' }
  if (summary.expiredPackageCount > 0) return { label: 'Scaduti presenti', tone: 'danger' }
  if (summary.expiringSoonPackageCount > 0) return { label: 'Scadenza vicina', tone: 'warning' }
  if (!summary.packageCount) return { label: 'Nessuna confezione', tone: 'neutral' }
  return { label: 'Scorta OK', tone: 'success' }
}

function nextNestedId(list: Array<{ id?: number }>) {
  return list.length ? Math.max(...list.map(item => Number(item.id || 0))) + 1 : 1
}

export default function DeadlinesPage() {
  const { data, authUser, upsertDeadline, toggleDeadline, deleteDeadline } = useFamily()
  const [editing, setEditing] = useState<any>(null)
  const [section, setSection] = useState<DeadlineSection>('general')

  const generalDeadlines = useMemo(
    () => data.deadlines.filter(item => item.kind !== 'medicine' && item.kind !== 'therapy').slice().sort((a, b) => Number(a.done) - Number(b.done) || a.date.localeCompare(b.date)),
    [data.deadlines]
  )
  const medicines = useMemo(
    () => data.deadlines.filter(item => item.kind === 'medicine').slice().sort((a, b) => Number(a.done) - Number(b.done) || a.title.localeCompare(b.title)),
    [data.deadlines]
  )
  const therapies = useMemo(
    () => data.deadlines.filter(item => item.kind === 'therapy').slice().sort((a, b) => Number(a.done) - Number(b.done) || (a.therapyStartDate || a.date).localeCompare(b.therapyStartDate || b.date)),
    [data.deadlines]
  )

  function blankPackage(existing: any[] = []) {
    return { id: nextNestedId(existing), expiryDate: '', quantity: '', packageSize: '', lot: '', addedAt: localDateISO() }
  }

  function blankTherapyMedicine(existing: any[] = []) {
    const used = new Set(existing.map(line => Number(line.medicineId || 0)))
    const firstAvailable = medicines.find(medicine => !used.has(medicine.id)) || medicines[0]
    return { id: nextNestedId(existing), medicineId: firstAvailable?.id || 0, tabletsPerDose: 1, dosesPerDay: 1, usage: '' }
  }

  function openNew(kind: DeadlineSection = section) {
    if (kind === 'general') {
      setEditing({ id: undefined, title: '', date: localDateISO(), userId: authUser?.id || data.users[0]?.id || 1, done: false, kind: 'general' })
      return
    }
    if (kind === 'inventory') {
      setEditing({
        id: undefined,
        title: '',
        date: localDateISO(),
        userId: 0,
        done: false,
        kind: 'medicine',
        activeIngredient: '',
        purpose: '',
        notes: '',
        defaultPackageSize: '',
        packages: [blankPackage()]
      })
      return
    }
    setEditing({
      id: undefined,
      title: '',
      date: localDateISO(),
      userId: authUser?.id || data.users[0]?.id || 1,
      done: false,
      kind: 'therapy',
      prescriber: '',
      purpose: '',
      notes: '',
      therapyStartDate: localDateISO(),
      therapyEndDate: '',
      therapyMedicines: medicines.length ? [blankTherapyMedicine()] : []
    })
  }

  function editItem(item: any) {
    const copy = JSON.parse(JSON.stringify(item))
    if (copy.kind === 'medicine') copy.packages ||= []
    if (copy.kind === 'therapy') copy.therapyMedicines ||= []
    setEditing(copy)
  }

  function save() {
    if (!editing) return

    if (editing.kind === 'general') {
      if (!editing.title?.trim() || !editing.date) return
      upsertDeadline({ ...editing, title: editing.title.trim(), userId: Number(editing.userId), kind: 'general' })
      setEditing(null)
      return
    }

    if (editing.kind === 'medicine') {
      if (!editing.title?.trim()) return
      const packages = (editing.packages || [])
        .filter((pkg: any) => pkg.expiryDate || pkg.lot?.trim() || Number(pkg.quantity || 0) > 0)
        .map((pkg: any, index: number) => ({
          id: Number(pkg.id) || index + 1,
          expiryDate: pkg.expiryDate || '',
          quantity: nonNegativeNumber(pkg.quantity),
          packageSize: positiveNumber(pkg.packageSize),
          lot: pkg.lot?.trim() || '',
          addedAt: pkg.addedAt || localDateISO()
        }))
      const nearestExpiry = packages.map((pkg: any) => pkg.expiryDate).filter(Boolean).sort()[0] || localDateISO()
      upsertDeadline({
        ...editing,
        title: editing.title.trim(),
        date: nearestExpiry,
        userId: 0,
        kind: 'medicine',
        activeIngredient: editing.activeIngredient?.trim() || '',
        purpose: editing.purpose?.trim() || '',
        notes: editing.notes?.trim() || '',
        defaultPackageSize: positiveNumber(editing.defaultPackageSize),
        packages,
        therapyStartDate: undefined,
        therapyEndDate: undefined,
        therapyMedicines: undefined,
        prescriber: undefined,
        usage: undefined
      })
      setEditing(null)
      return
    }

    if (editing.kind === 'therapy') {
      if (!editing.therapyStartDate) {
        alert('Indica almeno la data di inizio della terapia.')
        return
      }
      if (editing.therapyEndDate && editing.therapyEndDate < editing.therapyStartDate) {
        alert('La data di fine terapia non può essere precedente alla data di inizio.')
        return
      }
      const therapyMedicines = (editing.therapyMedicines || [])
        .filter((line: any) => Number(line.medicineId || 0) > 0)
        .map((line: any, index: number) => ({
          id: Number(line.id) || index + 1,
          medicineId: Number(line.medicineId),
          tabletsPerDose: Number(positiveNumber(line.tabletsPerDose) || 1),
          dosesPerDay: Number(positiveNumber(line.dosesPerDay) || 1),
          usage: line.usage?.trim() || ''
        }))
      if (!therapyMedicines.length) {
        alert('Aggiungi almeno un medicinale alla terapia.')
        return
      }
      const patient = data.users.find(user => user.id === Number(editing.userId))
      const title = editing.title?.trim() || `Terapia ${patient?.name || ''}`.trim()
      upsertDeadline({
        ...editing,
        title,
        date: editing.therapyEndDate || editing.therapyStartDate,
        userId: Number(editing.userId || authUser?.id || data.users[0]?.id || 1),
        kind: 'therapy',
        prescriber: editing.prescriber?.trim() || '',
        purpose: editing.purpose?.trim() || '',
        notes: editing.notes?.trim() || '',
        therapyStartDate: editing.therapyStartDate,
        therapyEndDate: editing.therapyEndDate || '',
        therapyMedicines
      })
      setEditing(null)
    }
  }

  function deleteEditing() {
    if (!editing?.id) return
    if (editing.kind === 'medicine') {
      const linked = therapies.filter(therapy => (therapy.therapyMedicines || []).some(line => Number(line.medicineId) === Number(editing.id)))
      if (linked.length) {
        alert(`Questo medicinale è collegato a ${linked.length} ${linked.length === 1 ? 'terapia' : 'terapie'}. Rimuovilo prima dalle terapie oppure archivialo.`)
        return
      }
    }
    deleteDeadline(editing.id)
    setEditing(null)
  }

  function addPackage() {
    const current = editing?.packages || []
    setEditing({ ...editing, packages: [...current, blankPackage(current)] })
  }

  function updatePackage(id: number, patch: any) {
    setEditing({ ...editing, packages: (editing.packages || []).map((pkg: any) => Number(pkg.id) === Number(id) ? { ...pkg, ...patch } : pkg) })
  }

  function removePackage(id: number) {
    setEditing({ ...editing, packages: (editing.packages || []).filter((pkg: any) => Number(pkg.id) !== Number(id)) })
  }

  function addTherapyMedicine() {
    const current = editing?.therapyMedicines || []
    if (!medicines.length) return
    setEditing({ ...editing, therapyMedicines: [...current, blankTherapyMedicine(current)] })
  }

  function updateTherapyMedicine(id: number, patch: any) {
    setEditing({ ...editing, therapyMedicines: (editing.therapyMedicines || []).map((line: any) => Number(line.id) === Number(id) ? { ...line, ...patch } : line) })
  }

  function removeTherapyMedicine(id: number) {
    setEditing({ ...editing, therapyMedicines: (editing.therapyMedicines || []).filter((line: any) => Number(line.id) !== Number(id)) })
  }

  const planningTherapies = editing?.kind === 'therapy'
    ? editing.id
      ? therapies.map(therapy => therapy.id === editing.id ? editing : therapy)
      : [...therapies, { ...editing, id: -1 }]
    : therapies

  const pageAction = section === 'general'
    ? <Button icon={<Plus size={18} />} onClick={() => openNew('general')}>Nuova scadenza</Button>
    : section === 'inventory'
      ? <Button icon={<Package size={18} />} onClick={() => openNew('inventory')}>Aggiungi medicinale</Button>
      : <Button icon={<Stethoscope size={18} />} onClick={() => openNew('therapy')} disabled={!medicines.length}>Nuova terapia</Button>

  return <div className="page">
    <PageIntro
      eyebrow="Promemoria"
      title="Scadenze"
      description="Scadenze generali, magazzino medicinali e terapie restano separate ma lavorano insieme nei calcoli."
      actions={pageAction}
    />

    <div className="page-tabs-wrap">
      <Segmented
        value={section}
        onChange={setSection}
        options={[
          { value: 'general', label: 'Scadenze generali' },
          { value: 'inventory', label: 'Magazzino medicine' },
          { value: 'therapy', label: 'Terapie' }
        ]}
      />
    </div>

    {section === 'general' ? <Card>
      {generalDeadlines.length ? <div className="deadline-list">{generalDeadlines.map(item => {
        const user = data.users.find(user => user.id === item.userId)
        return <div key={item.id} className={`deadline-row ${item.done ? 'is-done' : ''}`}>
          <button className="check-item__check" onClick={() => toggleDeadline(item.id)}>{item.done ? <Check size={16} /> : null}</button>
          <div className="deadline-date"><strong>{item.date.slice(8, 10)}</strong><span>{item.date.slice(5, 7)}</span></div>
          <div className="deadline-copy"><strong>{item.title}</strong><span><Avatar user={user} size="xs" /> {user?.name}</span></div>
          {item.done ? <Badge tone="success">Completata</Badge> : <Badge tone="warning">Da fare</Badge>}
          <IconButton label="Modifica" onClick={() => editItem(item)}><Pencil size={17} /></IconButton>
          <IconButton label="Elimina" onClick={() => deleteDeadline(item.id)}><Trash2 size={17} /></IconButton>
        </div>
      })}</div> : <EmptyState title="Nessuna scadenza" text="Aggiungi la prima data importante." action={<Button onClick={() => openNew('general')}>Aggiungi scadenza</Button>} />}
    </Card> : null}

    {section === 'inventory' ? <Card>
      <CardHeader title="Magazzino medicinali" subtitle="Ogni medicinale può avere più confezioni, anche con scadenze diverse. Le scorte sono condivise automaticamente tra tutte le terapie che lo usano." />
      <div className="callout" style={{ marginBottom: 14 }}><strong>Scelta ottimizzata:</strong> le confezioni non vengono assegnate a una singola cura. VerdoFamily considera il magazzino comune del medicinale e somma il consumo di tutte le terapie contemporanee, usando prima le confezioni che scadono prima.</div>
      {medicines.length ? <div className="deadline-list">{medicines.map(item => {
        const summary = medicineInventorySummary(item, therapies)
        const status = stockStatus(summary, item.done)
        const details = [
          `${summary.packageCount} ${summary.packageCount === 1 ? 'confezione' : 'confezioni'}`,
          `${summary.totalStock} compresse disponibili`,
          summary.therapyCount ? `${summary.therapyCount} ${summary.therapyCount === 1 ? 'terapia collegata' : 'terapie collegate'}` : 'nessuna terapia collegata',
          summary.activeDailyUse ? `consumo attuale ${summary.activeDailyUse}/giorno` : '',
          summary.coverageUntil ? `copertura stimata fino al ${formatDate(summary.coverageUntil)}` : '',
          summary.shortageKnown ? `mancano almeno ${summary.shortageKnown} compresse${summary.packagesToBuy ? ` (≈ ${summary.packagesToBuy} conf.)` : ''}` : '',
          summary.expiredPackageCount ? `${summary.expiredPackageCount} confez. scadute` : ''
        ].filter(Boolean).join(' · ')
        const expiry = summary.earliestExpiry
        return <div key={item.id} className={`deadline-row ${item.done ? 'is-done' : ''}`}>
          <button className="check-item__check" onClick={() => toggleDeadline(item.id)}>{item.done ? <Check size={16} /> : null}</button>
          <div className="deadline-date"><strong>{expiry ? expiry.slice(8, 10) : '—'}</strong><span>{expiry ? expiry.slice(5, 7) : 'SCAD'}</span></div>
          <div className="deadline-copy"><strong>{item.title}</strong><span>{details}</span></div>
          <Badge tone={status.tone}>{status.label}</Badge>
          <IconButton label="Modifica" onClick={() => editItem(item)}><Pencil size={17} /></IconButton>
          <IconButton label="Elimina" onClick={() => { const linked = therapies.some(therapy => (therapy.therapyMedicines || []).some(line => Number(line.medicineId) === item.id)); if (linked) alert('Il medicinale è collegato a una terapia. Rimuovilo prima dalla terapia o archivialo.'); else deleteDeadline(item.id) }}><Trash2 size={17} /></IconButton>
        </div>
      })}</div> : <EmptyState icon={<Package size={26} />} title="Magazzino vuoto" text="Inserisci un medicinale e le confezioni che hai in casa." action={<Button onClick={() => openNew('inventory')}>Aggiungi medicinale</Button>} />}
    </Card> : null}

    {section === 'therapy' ? <Card>
      <CardHeader title="Terapie prescritte" subtitle="Una terapia può contenere più medicinali e può richiedere più confezioni dello stesso farmaco." />
      <div className="callout" style={{ marginBottom: 14 }}><strong>Calcolo condiviso:</strong> se due terapie usano lo stesso medicinale nello stesso periodo, i consumi vengono sommati. In questo modo una stessa confezione può alimentare più terapie e, quando serve, il sistema stima quante confezioni aggiuntive acquistare.</div>
      {!medicines.length ? <EmptyState icon={<Pill size={26} />} title="Prima crea il magazzino" text="Aggiungi almeno un medicinale nel Magazzino medicine; poi potrai collegarlo a una o più terapie." action={<Button onClick={() => setSection('inventory')}>Vai al magazzino</Button>} /> : therapies.length ? <div className="deadline-list">{therapies.map(item => {
        const user = data.users.find(person => person.id === item.userId)
        const phase = therapyPhase(item)
        const lineDetails = (item.therapyMedicines || []).map(line => {
          const medicine = medicines.find(product => product.id === Number(line.medicineId))
          if (!medicine) return 'Medicinale non trovato'
          const required = item.therapyEndDate ? therapyLineRequiredTablets(item.therapyStartDate || '', item.therapyEndDate, line) : null
          const packSize = Number(medicine.defaultPackageSize || medicine.packages?.find(pkg => Number(pkg.packageSize || 0) > 0)?.packageSize || 0)
          const boxes = required !== null && packSize > 0 ? Math.ceil(Number(required || 0) / packSize) : 0
          const globalSummary = medicineInventorySummary(medicine, therapies)
          const stockWarning = globalSummary.shortageDate ? ` ⚠ scorta insufficiente dal ${formatDate(globalSummary.shortageDate)}` : ''
          return `${medicine.title}: ${line.tabletsPerDose} × ${line.dosesPerDay}/g${required !== null ? ` · ${required} cps${boxes ? ` ≈ ${boxes} conf.` : ''}` : ' · continuativa'}${stockWarning}`
        }).join(' | ')
        const details = [
          user?.name ? `Per ${user.name}` : '',
          item.prescriber ? `Dr. ${item.prescriber}` : '',
          `${formatDate(item.therapyStartDate)} → ${item.therapyEndDate ? formatDate(item.therapyEndDate) : 'continuativa'}`,
          lineDetails
        ].filter(Boolean).join(' · ')
        return <div key={item.id} className={`deadline-row ${item.done ? 'is-done' : ''}`}>
          <button className="check-item__check" onClick={() => toggleDeadline(item.id)}>{item.done ? <Check size={16} /> : null}</button>
          <div className="deadline-date"><strong>{(item.therapyStartDate || item.date).slice(8, 10)}</strong><span>{(item.therapyStartDate || item.date).slice(5, 7)}</span></div>
          <div className="deadline-copy"><strong>{item.title}</strong><span>{details}</span></div>
          <Badge tone={phase.tone}>{phase.label}</Badge>
          <IconButton label="Modifica" onClick={() => editItem(item)}><Pencil size={17} /></IconButton>
          <IconButton label="Elimina" onClick={() => deleteDeadline(item.id)}><Trash2 size={17} /></IconButton>
        </div>
      })}</div> : <EmptyState icon={<Stethoscope size={26} />} title="Nessuna terapia" text="Registra una prescrizione e collega uno o più medicinali dal magazzino." action={<Button onClick={() => openNew('therapy')}>Nuova terapia</Button>} />}
    </Card> : null}

    <Modal
      open={!!editing}
      onClose={() => setEditing(null)}
      title={editing?.kind === 'medicine' ? (editing?.id ? 'Modifica medicinale' : 'Nuovo medicinale') : editing?.kind === 'therapy' ? (editing?.id ? 'Modifica terapia' : 'Nuova terapia') : (editing?.id ? 'Modifica scadenza' : 'Nuova scadenza')}
      subtitle={editing?.kind === 'medicine' ? 'Anagrafica del farmaco e confezioni fisicamente disponibili.' : editing?.kind === 'therapy' ? 'Prescrizione separata dal magazzino: puoi collegare uno o più medicinali.' : undefined}
      size={editing?.kind === 'general' ? 'md' : 'lg'}
      footer={<div className="modal-actions"><div>{editing?.id ? <Button variant="danger" onClick={deleteEditing}>Elimina</Button> : null}</div><div className="modal-actions__right"><Button variant="ghost" onClick={() => setEditing(null)}>Annulla</Button><Button onClick={save}>Salva</Button></div></div>}
    >
      {editing?.kind === 'general' ? <div className="form-grid form-grid--2">
        <Field label="Titolo" className="field--wide"><input autoFocus value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} /></Field>
        <Field label="Data"><input type="date" value={editing.date} onChange={e => setEditing({ ...editing, date: e.target.value })} /></Field>
        <Field label="Per chi"><select value={editing.userId} onChange={e => setEditing({ ...editing, userId: Number(e.target.value) })}>{data.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></Field>
      </div> : null}

      {editing?.kind === 'medicine' ? <div className="form-grid form-grid--2">
        <Field label="Nome medicinale" className="field--wide"><input autoFocus value={editing.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Es. Tachipirina 500 mg" /></Field>
        <Field label="Principio attivo"><input value={editing.activeIngredient || ''} onChange={e => setEditing({ ...editing, activeIngredient: e.target.value })} placeholder="Facoltativo" /></Field>
        <Field label="Compresse per confezione" hint="Serve per stimare quante scatole acquistare."><input type="number" min="0" step="1" value={editing.defaultPackageSize ?? ''} onChange={e => setEditing({ ...editing, defaultPackageSize: e.target.value })} placeholder="Es. 30" /></Field>
        <Field label="A cosa serve" className="field--wide"><input value={editing.purpose || ''} onChange={e => setEditing({ ...editing, purpose: e.target.value })} placeholder="Es. dolore, pressione, allergia…" /></Field>
        <Field label="Note" className="field--wide"><textarea rows={2} value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} /></Field>

        <Card className="field--wide">
          <CardHeader title="Confezioni in magazzino" subtitle="Ogni riga rappresenta una confezione fisica. Quantità = compresse effettivamente rimaste oggi." action={<Button size="sm" variant="soft" icon={<Plus size={15} />} onClick={addPackage}>Confezione</Button>} />
          {(editing.packages || []).length ? <div className="receipt-matches">{(editing.packages || []).map((pkg: any, index: number) => <div className="receipt-match" key={pkg.id}>
            <div className="receipt-match__head"><strong>Confezione {index + 1}</strong><IconButton label="Rimuovi confezione" onClick={() => removePackage(pkg.id)}><Trash2 size={16} /></IconButton></div>
            <div className="form-grid form-grid--2" style={{ marginTop: 10 }}>
              <Field label="Scadenza"><input type="date" value={pkg.expiryDate || ''} onChange={e => updatePackage(pkg.id, { expiryDate: e.target.value })} /></Field>
              <Field label="Compresse rimaste"><input type="number" min="0" step="0.25" value={pkg.quantity ?? ''} onChange={e => updatePackage(pkg.id, { quantity: e.target.value })} placeholder="Es. 18" /></Field>
              <Field label="Contenuto originale" hint="Facoltativo, se diverso dal valore standard."><input type="number" min="0" step="1" value={pkg.packageSize ?? ''} onChange={e => updatePackage(pkg.id, { packageSize: e.target.value })} placeholder="Es. 30" /></Field>
              <Field label="Lotto"><input value={pkg.lot || ''} onChange={e => updatePackage(pkg.id, { lot: e.target.value })} placeholder="Facoltativo" /></Field>
            </div>
          </div>)}</div> : <EmptyState title="Nessuna confezione" text="Puoi tenere il medicinale in anagrafica anche senza scorta, oppure aggiungere una confezione." action={<Button variant="soft" onClick={addPackage}>Aggiungi confezione</Button>} />}
        </Card>

        {editing.id ? (() => {
          const draftSummary = medicineInventorySummary({ ...editing, id: Number(editing.id), packages: editing.packages || [] }, therapies)
          return <div className={draftSummary.shortageDate ? 'callout callout--warning field--wide' : 'callout callout--success field--wide'}>
            <strong>Scorta condivisa: {draftSummary.totalStock} compresse.</strong> {draftSummary.therapyCount ? `${draftSummary.therapyCount} terapie collegate.` : 'Nessuna terapia collegata.'}
            {draftSummary.shortageDate ? <> Copertura stimata insufficiente dal {formatDate(draftSummary.shortageDate)}.{draftSummary.shortageKnown ? ` Mancano almeno ${draftSummary.shortageKnown} compresse${draftSummary.packagesToBuy ? `, circa ${draftSummary.packagesToBuy} confezioni.` : '.'}` : ''}</> : null}
          </div>
        })() : null}
      </div> : null}

      {editing?.kind === 'therapy' ? <div className="form-grid form-grid--2">
        <Field label="Nome terapia" className="field--wide" hint="Facoltativo: se vuoto useremo il nome della persona."><input autoFocus value={editing.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Es. Terapia antibiotica" /></Field>
        <Field label="Prescritta a"><select value={editing.userId || authUser?.id || ''} onChange={e => setEditing({ ...editing, userId: Number(e.target.value) })}>{data.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></Field>
        <Field label="Prescritta da"><input value={editing.prescriber || ''} onChange={e => setEditing({ ...editing, prescriber: e.target.value })} placeholder="Medico / specialista" /></Field>
        <Field label="Inizio terapia"><input type="date" value={editing.therapyStartDate || ''} onChange={e => setEditing({ ...editing, therapyStartDate: e.target.value })} /></Field>
        <Field label="Fine terapia" hint="Lascia vuoto per una terapia continuativa."><input type="date" min={editing.therapyStartDate || undefined} value={editing.therapyEndDate || ''} onChange={e => setEditing({ ...editing, therapyEndDate: e.target.value })} /></Field>
        <Field label="Motivo / indicazione" className="field--wide"><input value={editing.purpose || ''} onChange={e => setEditing({ ...editing, purpose: e.target.value })} placeholder="Facoltativo" /></Field>

        <Card className="field--wide">
          <CardHeader title="Medicinali della terapia" subtitle="Puoi aggiungerne più di uno. Il fabbisogno viene confrontato con il magazzino condiviso." action={<Button size="sm" variant="soft" icon={<Plus size={15} />} onClick={addTherapyMedicine} disabled={!medicines.length}>Farmaco</Button>} />
          {(editing.therapyMedicines || []).length ? <div className="receipt-matches">{(editing.therapyMedicines || []).map((line: any, index: number) => {
            const medicine = medicines.find(product => product.id === Number(line.medicineId))
            const required = editing.therapyEndDate ? therapyLineRequiredTablets(editing.therapyStartDate || '', editing.therapyEndDate, line) : null
            const packageSize = Number(medicine?.defaultPackageSize || medicine?.packages?.find(pkg => Number(pkg.packageSize || 0) > 0)?.packageSize || 0)
            const boxes = required !== null && packageSize > 0 ? Math.ceil(Number(required || 0) / packageSize) : 0
            const summary = medicine ? medicineInventorySummary(medicine, planningTherapies as any) : null
            return <div className="receipt-match" key={line.id}>
              <div className="receipt-match__head"><strong>Medicinale {index + 1}</strong><IconButton label="Rimuovi medicinale" onClick={() => removeTherapyMedicine(line.id)}><Trash2 size={16} /></IconButton></div>
              <div className="form-grid form-grid--2" style={{ marginTop: 10 }}>
                <Field label="Medicinale" className="field--wide"><select value={line.medicineId || 0} onChange={e => updateTherapyMedicine(line.id, { medicineId: Number(e.target.value) })}>{medicines.map(product => <option key={product.id} value={product.id}>{product.title}</option>)}</select></Field>
                <Field label="Compresse per assunzione"><input type="number" min="0" step="0.25" value={line.tabletsPerDose ?? ''} onChange={e => updateTherapyMedicine(line.id, { tabletsPerDose: e.target.value })} /></Field>
                <Field label="Assunzioni al giorno" hint="0,5 = una volta ogni due giorni."><input type="number" min="0" step="0.25" value={line.dosesPerDay ?? ''} onChange={e => updateTherapyMedicine(line.id, { dosesPerDay: e.target.value })} /></Field>
                <Field label="Modalità d'uso" className="field--wide"><input value={line.usage || ''} onChange={e => updateTherapyMedicine(line.id, { usage: e.target.value })} placeholder="Es. dopo cena, a stomaco pieno…" /></Field>
              </div>
              {medicine ? <div className={summary?.shortageDate ? 'callout callout--warning' : 'callout callout--success'} style={{ marginTop: 10 }}>
                <strong>{medicine.title}</strong>: {therapyDailyUse(line)} compresse/giorno{required !== null ? ` · ${required} compresse per questa terapia${boxes ? ` (≈ ${boxes} confezioni)` : ''}` : ' · terapia continuativa'}.
                {summary?.shortageDate ? <> Scorta condivisa insufficiente dal {formatDate(summary.shortageDate)}.{summary.shortageKnown ? ` Mancano almeno ${summary.shortageKnown} compresse${summary.packagesToBuy ? ` (≈ ${summary.packagesToBuy} confezioni da integrare)` : ''}.` : ''}</> : <> Scorta condivisa compatibile con le terapie pianificate note.</>}
              </div> : null}
            </div>
          })}</div> : <EmptyState title="Nessun medicinale collegato" text="Aggiungi almeno un farmaco dal magazzino per calcolare fabbisogno e copertura." action={<Button variant="soft" onClick={addTherapyMedicine} disabled={!medicines.length}>Aggiungi farmaco</Button>} />}
        </Card>

        <Field label="Note sulla terapia" className="field--wide"><textarea rows={3} value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} /></Field>
      </div> : null}
    </Modal>
  </div>
}
