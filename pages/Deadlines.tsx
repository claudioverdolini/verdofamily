import React, { useState } from 'react'
import { Check, Pencil, Pill, Plus, Trash2 } from 'lucide-react'
import { useFamily } from '../store'
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Modal, PageIntro, Segmented } from '../ui'
import { localDateISO, medicineDepletionDate, medicineTherapyCoverage, parseISODate } from '../utils'

type DeadlineSection = 'general' | 'medicine'

function medicineStatus(date: string, done: boolean) {
  if (done) return { label: 'Archiviato', tone: 'success' }
  const today = parseISODate(localDateISO())
  const target = parseISODate(date)
  const days = Math.round((target.getTime() - today.getTime()) / 86400000)
  if (days < 0) return { label: 'Scaduto', tone: 'danger' }
  if (days === 0) return { label: 'Scade oggi', tone: 'danger' }
  if (days <= 30) return { label: `Scade tra ${days} gg`, tone: 'warning' }
  return { label: `Scade tra ${days} gg`, tone: 'neutral' }
}

function formatMedicineDate(value?: string) {
  if (!value) return ''
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

function medicineConsumptionStart(therapyStartDate?: string, stockStartDate?: string) {
  if (therapyStartDate && (!stockStartDate || therapyStartDate > stockStartDate)) return therapyStartDate
  return stockStartDate || therapyStartDate || ''
}

function therapyPhase(startDate?: string, endDate?: string) {
  if (!startDate && !endDate) return ''
  if (startDate && endDate && endDate < startDate) return 'Date terapia da verificare'
  const today = localDateISO()
  if (startDate && today < startDate) return `Inizio terapia: ${formatMedicineDate(startDate)}`
  if (endDate && today > endDate) return `Terapia terminata il ${formatMedicineDate(endDate)}`
  if (endDate && today === endDate) return 'Ultimo giorno di terapia'
  if (startDate && (!endDate || today >= startDate)) return 'Terapia in corso'
  return ''
}

export default function DeadlinesPage() {
  const { data, authUser, upsertDeadline, toggleDeadline, deleteDeadline } = useFamily()
  const [editing, setEditing] = useState<any>(null)
  const [section, setSection] = useState<DeadlineSection>('general')

  function openNew(kind: DeadlineSection = section) {
    setEditing({
      id: undefined,
      title: '',
      date: localDateISO(),
      userId: kind === 'medicine' ? 0 : (authUser?.id || data.users[0]?.id || 1),
      done: false,
      kind,
      activeIngredient: '',
      purpose: '',
      usage: '',
      prescriber: '',
      notes: '',
      therapyStartDate: '',
      therapyEndDate: '',
      stockStartDate: localDateISO(),
      tabletCount: '',
      tabletsPerDose: 1,
      dosesPerDay: 1
    })
  }

  function save() {
    if (!editing?.title?.trim() || !editing?.date) return
    if (editing.kind === 'medicine' && editing.therapyStartDate && editing.therapyEndDate && editing.therapyEndDate < editing.therapyStartDate) {
      alert('La data di fine terapia non può essere precedente alla data di inizio.')
      return
    }
    upsertDeadline({
      ...editing,
      title: editing.title.trim(),
      userId: Number(editing.userId || 0),
      kind: editing.kind || 'general',
      activeIngredient: editing.activeIngredient?.trim() || '',
      purpose: editing.purpose?.trim() || '',
      usage: editing.usage?.trim() || '',
      prescriber: editing.prescriber?.trim() || '',
      notes: editing.notes?.trim() || '',
      therapyStartDate: editing.kind === 'medicine' ? (editing.therapyStartDate || '') : undefined,
      therapyEndDate: editing.kind === 'medicine' ? (editing.therapyEndDate || '') : undefined,
      stockStartDate: editing.kind === 'medicine' ? (editing.stockStartDate || '') : undefined,
      tabletCount: editing.kind === 'medicine' ? positiveNumber(editing.tabletCount) : undefined,
      tabletsPerDose: editing.kind === 'medicine' ? positiveNumber(editing.tabletsPerDose) : undefined,
      dosesPerDay: editing.kind === 'medicine' ? positiveNumber(editing.dosesPerDay) : undefined
    })
    setEditing(null)
  }

  const list = data.deadlines
    .filter(item => section === 'medicine' ? item.kind === 'medicine' : item.kind !== 'medicine')
    .slice()
    .sort((a, b) => Number(a.done) - Number(b.done) || a.date.localeCompare(b.date))

  const editingConsumptionStart = editing?.kind === 'medicine'
    ? medicineConsumptionStart(editing.therapyStartDate || '', editing.stockStartDate || '')
    : ''

  const editingDepletionDate = editing?.kind === 'medicine'
    ? medicineDepletionDate(
        editingConsumptionStart,
        Number(editing.tabletCount || 0),
        Number(editing.tabletsPerDose || 0),
        Number(editing.dosesPerDay || 0)
      )
    : ''

  const editingCoverage = editing?.kind === 'medicine'
    ? medicineTherapyCoverage(
        editing.therapyStartDate || '',
        editing.therapyEndDate || '',
        editing.stockStartDate || '',
        Number(editing.tabletCount || 0),
        Number(editing.tabletsPerDose || 0),
        Number(editing.dosesPerDay || 0)
      )
    : null

  const editingTherapyInvalid = !!(
    editing?.kind === 'medicine' &&
    editing.therapyStartDate &&
    editing.therapyEndDate &&
    editing.therapyEndDate < editing.therapyStartDate
  )

  const pageAction = section === 'medicine'
    ? <Button icon={<Pill size={18} />} onClick={() => openNew('medicine')}>Aggiungi medicinale</Button>
    : <Button icon={<Plus size={18} />} onClick={() => openNew('general')}>Nuova scadenza</Button>

  return <div className="page">
    <PageIntro
      eyebrow="Promemoria"
      title="Scadenze"
      description="Documenti, pagamenti, rinnovi, medicinali e terapie: tutte le date importanti in un unico posto."
      actions={pageAction}
    />

    <div className="page-tabs-wrap">
      <Segmented
        value={section}
        onChange={setSection}
        options={[
          { value: 'general', label: 'Scadenze generali' },
          { value: 'medicine', label: 'Medicinali' }
        ]}
      />
    </div>

    <Card>
      {section === 'medicine' ? <CardHeader title="Medicinali e terapie" subtitle="Monitora scadenza, durata della cura, dosaggio e copertura delle scorte." /> : null}

      {list.length ? <div className="deadline-list">{list.map(item => {
        const user = data.users.find(u => u.id === item.userId)
        const status = section === 'medicine' ? medicineStatus(item.date, item.done) : null
        const consumptionStart = medicineConsumptionStart(item.therapyStartDate, item.stockStartDate)
        const coverage = item.kind === 'medicine'
          ? medicineTherapyCoverage(
              item.therapyStartDate || '',
              item.therapyEndDate || '',
              item.stockStartDate || '',
              Number(item.tabletCount || 0),
              Number(item.tabletsPerDose || 0),
              Number(item.dosesPerDay || 0)
            )
          : null
        const depletionDate = coverage?.depletionDate || (item.kind === 'medicine'
          ? medicineDepletionDate(consumptionStart, Number(item.tabletCount || 0), Number(item.tabletsPerDose || 0), Number(item.dosesPerDay || 0))
          : '')
        const stockInfo = item.tabletCount && item.tabletsPerDose && item.dosesPerDay
          ? `${item.tabletCount} compresse · ${item.tabletsPerDose} per assunzione · ${item.dosesPerDay} ass./giorno`
          : ''
        const therapyInfo = item.therapyStartDate || item.therapyEndDate
          ? `Terapia: ${item.therapyStartDate ? formatMedicineDate(item.therapyStartDate) : '?'} → ${item.therapyEndDate ? formatMedicineDate(item.therapyEndDate) : '?'}`
          : ''
        const phase = therapyPhase(item.therapyStartDate, item.therapyEndDate)
        const coverageInfo = coverage
          ? coverage.sufficient === true
            ? `Scorta sufficiente${coverage.surplus ? ` · restano ${coverage.surplus} compresse` : ' · quantità esatta'}`
            : coverage.sufficient === false
              ? `Scorta insufficiente · mancano ${coverage.shortage} compresse`
              : `Per la terapia servono ${coverage.requiredTablets} compresse`
          : ''
        const medicineInfo = [
          user?.name ? `Prescritto a ${user.name}` : '',
          item.purpose ? `Serve per: ${item.purpose}` : '',
          therapyInfo,
          phase,
          stockInfo,
          coverage ? `Necessarie: ${coverage.requiredTablets} compresse` : '',
          coverageInfo,
          depletionDate ? `Copertura stimata fino al ${formatMedicineDate(depletionDate)}` : '',
          item.usage ? `Uso: ${item.usage}` : ''
        ].filter(Boolean).join(' · ')

        return <div key={item.id} className={`deadline-row ${item.done ? 'is-done' : ''}`}>
          <button className="check-item__check" onClick={() => toggleDeadline(item.id)}>{item.done ? <Check size={16} /> : null}</button>
          <div className="deadline-date"><strong>{item.date.slice(8, 10)}</strong><span>{item.date.slice(5, 7)}</span></div>
          <div className="deadline-copy">
            <strong>{item.title}</strong>
            {section === 'medicine'
              ? <span>{medicineInfo || 'Nessun dettaglio aggiuntivo'}</span>
              : <span><Avatar user={user} size="xs" /> {user?.name}</span>}
          </div>
          {section === 'medicine'
            ? <Badge tone={status?.tone}>{status?.label}</Badge>
            : item.done ? <Badge tone="success">Completata</Badge> : <Badge tone="warning">Da fare</Badge>}
          <IconButton label="Modifica" onClick={() => setEditing({ ...item, kind: item.kind || 'general' })}><Pencil size={17} /></IconButton>
          <IconButton label="Elimina" onClick={() => deleteDeadline(item.id)}><Trash2 size={17} /></IconButton>
        </div>
      })}</div> : <EmptyState
        icon={section === 'medicine' ? <Pill size={24} /> : undefined}
        title={section === 'medicine' ? 'Nessun medicinale monitorato' : 'Nessuna scadenza'}
        text={section === 'medicine' ? 'Aggiungi un medicinale per tenere sotto controllo scadenza, terapia e disponibilità.' : 'Aggiungi la prima data importante.'}
        action={<Button onClick={() => openNew(section)}>{section === 'medicine' ? 'Aggiungi medicinale' : 'Aggiungi scadenza'}</Button>}
      />}
    </Card>

    <Modal
      open={!!editing}
      onClose={() => setEditing(null)}
      title={editing?.kind === 'medicine' ? (editing?.id ? 'Modifica medicinale' : 'Nuovo medicinale') : (editing?.id ? 'Modifica scadenza' : 'Nuova scadenza')}
      subtitle={editing?.kind === 'medicine' ? 'Nome e data di scadenza identificano il medicinale; terapia, dosaggio e altri dettagli restano facoltativi.' : undefined}
      size={editing?.kind === 'medicine' ? 'lg' : 'md'}
      footer={<div className="modal-actions"><div>{editing?.id ? <Button variant="danger" onClick={() => { deleteDeadline(editing.id); setEditing(null) }}>Elimina</Button> : null}</div><div className="modal-actions__right"><Button variant="ghost" onClick={() => setEditing(null)}>Annulla</Button><Button onClick={save}>Salva</Button></div></div>}
    >
      {editing ? editing.kind === 'medicine' ? <div className="form-grid form-grid--2">
        <Field label="Nome medicinale" className="field--wide"><input autoFocus value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Es. Tachipirina 500 mg" /></Field>
        <Field label="Data di scadenza"><input type="date" value={editing.date} onChange={e => setEditing({ ...editing, date: e.target.value })} /></Field>
        <Field label="Prescritto a"><select value={editing.userId || 0} onChange={e => setEditing({ ...editing, userId: Number(e.target.value) })}><option value={0}>Non specificato</option>{data.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label="Principio attivo"><input value={editing.activeIngredient || ''} onChange={e => setEditing({ ...editing, activeIngredient: e.target.value })} placeholder="Facoltativo" /></Field>
        <Field label="Prescritto da"><input value={editing.prescriber || ''} onChange={e => setEditing({ ...editing, prescriber: e.target.value })} placeholder="Medico / specialista" /></Field>
        <Field label="A cosa serve" className="field--wide"><input value={editing.purpose || ''} onChange={e => setEditing({ ...editing, purpose: e.target.value })} placeholder="Es. dolore, pressione, allergia…" /></Field>

        <Card className="field--wide">
          <CardHeader title="Terapia prescritta" subtitle="Indica l'inizio e la fine della cura: VerdoFamily le mette in relazione con dosaggio e scorta." />
          <div className="form-grid form-grid--2">
            <Field label="Inizio terapia"><input type="date" value={editing.therapyStartDate || ''} onChange={e => setEditing({ ...editing, therapyStartDate: e.target.value })} /></Field>
            <Field label="Fine terapia prescritta"><input type="date" value={editing.therapyEndDate || ''} min={editing.therapyStartDate || undefined} onChange={e => setEditing({ ...editing, therapyEndDate: e.target.value })} /></Field>
          </div>
          {editingTherapyInvalid ? <div className="callout callout--warning" style={{ marginTop: 12 }}><strong>Date non valide.</strong> La fine della terapia deve essere uguale o successiva all'inizio.</div> : editingCoverage ? <div className={editingCoverage.sufficient === false ? 'callout callout--warning' : 'callout callout--success'} style={{ marginTop: 12 }}>
            <strong>Terapia di {editingCoverage.therapyDays} giorni · {editingCoverage.requiredTablets} compresse necessarie{editingCoverage.remainingDays !== editingCoverage.therapyDays ? ' dalla data di conteggio della scorta' : ''}.</strong>
            {editingCoverage.sufficient === true ? <><br />Scorta sufficiente fino al termine della cura{editingCoverage.surplus ? `: resteranno circa ${editingCoverage.surplus} compresse.` : ': quantità esatta.'}</> : null}
            {editingCoverage.sufficient === false ? <><br />Scorta insufficiente: mancano circa {editingCoverage.shortage} compresse. Con la scorta inserita la copertura stimata arriva al {formatMedicineDate(editingCoverage.depletionDate)}.</> : null}
            {editingCoverage.sufficient === null ? <><br />Inserisci anche il numero di compresse disponibili per verificare se bastano fino alla fine della cura.</> : null}
          </div> : editing.therapyStartDate && editing.therapyEndDate ? <div className="callout" style={{ marginTop: 12 }}>Inserisci il dosaggio nella sezione sottostante per calcolare quante compresse servono durante tutta la terapia.</div> : <div className="callout" style={{ marginTop: 12 }}>Puoi lasciare vuote queste date se il medicinale non fa parte di una terapia definita.</div>}
        </Card>

        <Card className="field--wide">
          <CardHeader title="Scorta e consumo" subtitle="Quantità e frequenza permettono di stimare l'esaurimento e verificare la copertura della terapia." />
          <div className="form-grid form-grid--2">
            <Field label="Data inizio conteggio" hint="Il giorno da cui questa quantità è effettivamente disponibile. Se la terapia inizia dopo, il conteggio partirà dall'inizio terapia."><input type="date" value={editing.stockStartDate || ''} onChange={e => setEditing({ ...editing, stockStartDate: e.target.value })} /></Field>
            <Field label="Compresse disponibili"><input type="number" min="0" step="1" value={editing.tabletCount ?? ''} onChange={e => setEditing({ ...editing, tabletCount: e.target.value })} placeholder="Es. 30" /></Field>
            <Field label="Compresse per assunzione"><input type="number" min="0" step="0.25" value={editing.tabletsPerDose ?? ''} onChange={e => setEditing({ ...editing, tabletsPerDose: e.target.value })} placeholder="Es. 1" /></Field>
            <Field label="Assunzioni al giorno" hint="Es. 2 = mattina e sera; 0,5 = una volta ogni 2 giorni."><input type="number" min="0" step="0.25" value={editing.dosesPerDay ?? ''} onChange={e => setEditing({ ...editing, dosesPerDay: e.target.value })} placeholder="Es. 1" /></Field>
          </div>
          {editingDepletionDate ? <div className="callout callout--success" style={{ marginTop: 12 }}><strong>Copertura stimata fino al {formatMedicineDate(editingDepletionDate)}</strong><br />Il calcolo parte dal {formatMedicineDate(editingConsumptionStart)} e usa quantità e frequenza indicate.</div> : <div className="callout" style={{ marginTop: 12 }}>Inserisci quantità, compresse per assunzione e frequenza per ottenere la data di esaurimento stimata.</div>}
        </Card>

        <Field label="Modalità d'uso / dosaggio" className="field--wide"><textarea rows={3} value={editing.usage || ''} onChange={e => setEditing({ ...editing, usage: e.target.value })} placeholder="Es. 1 compressa dopo cena, solo al bisogno…" /></Field>
        <Field label="Note" className="field--wide"><textarea rows={3} value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} placeholder="Altre informazioni utili" /></Field>
      </div> : <div className="form-grid form-grid--2">
        <Field label="Titolo" className="field--wide"><input autoFocus value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} /></Field>
        <Field label="Data"><input type="date" value={editing.date} onChange={e => setEditing({ ...editing, date: e.target.value })} /></Field>
        <Field label="Per chi"><select value={editing.userId} onChange={e => setEditing({ ...editing, userId: Number(e.target.value) })}>{data.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
      </div> : null}
    </Modal>
  </div>
}
