import React, { useState } from 'react'
import { CheckCircle2, Pencil, Plus, Repeat2, RotateCcw, Trash2, WalletCards } from 'lucide-react'
import { useFamily } from '../store'
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Modal, PageIntro, Segmented } from '../ui'
import { localDateISO, money } from '../utils'

const WEEKDAYS = [
  { id: 1, label: 'Lun' },
  { id: 2, label: 'Mar' },
  { id: 3, label: 'Mer' },
  { id: 4, label: 'Gio' },
  { id: 5, label: 'Ven' },
  { id: 6, label: 'Sab' },
  { id: 7, label: 'Dom' }
]

function recurringLabel(days: number[]) {
  const sorted = [...(days || [])].map(Number).sort()
  if (sorted.length === 7) return 'Ogni giorno'
  if (sorted.join(',') === '1,2,3,4,5') return 'Lun–Ven'
  if (sorted.join(',') === '6,7') return 'Weekend'
  return WEEKDAYS.filter(day => sorted.includes(day.id)).map(day => day.label).join(', ')
}

export default function ChoresPage() {
  const {
    data,
    authUser,
    addChore,
    toggleChore,
    deleteChore,
    upsertRecurringChore,
    toggleRecurringChore,
    deleteRecurringChore,
    payUser,
    undoTransaction
  } = useFamily()
  const [tab, setTab] = useState<'chores' | 'recurring' | 'wallets'>('chores')
  const [editing, setEditing] = useState<any>(null)
  const [recurringEditing, setRecurringEditing] = useState<any>(null)
  const [payment, setPayment] = useState<any>(null)
  const showBalances = authUser?.prefs?.showBalances !== false

  function openNew() {
    setEditing({ title: '', deadline: localDateISO(), userId: data.users[0]?.id || 1, amount: 1 })
  }

  function openRecurring(item?: any) {
    setRecurringEditing(item
      ? { ...item, weekdays: [...(item.weekdays || [])] }
      : {
          title: '',
          userId: data.users[0]?.id || 1,
          amount: 1,
          weekdays: [1, 2, 3, 4, 5, 6, 7],
          active: true,
          startDate: localDateISO(),
          endDate: ''
        })
  }

  function saveChore() {
    if (!editing?.title?.trim()) return
    addChore({
      title: editing.title.trim(),
      deadline: editing.deadline,
      userId: Number(editing.userId),
      amount: Math.max(0, Number(editing.amount) || 0)
    })
    setEditing(null)
  }

  function saveRecurring() {
    if (!recurringEditing?.title?.trim() || !recurringEditing?.weekdays?.length) return
    upsertRecurringChore({
      id: recurringEditing.id,
      title: recurringEditing.title.trim(),
      userId: Number(recurringEditing.userId),
      amount: Math.max(0, Number(recurringEditing.amount) || 0),
      weekdays: recurringEditing.weekdays.map(Number),
      active: recurringEditing.active !== false,
      startDate: recurringEditing.startDate || localDateISO(),
      endDate: recurringEditing.endDate || undefined
    })
    setRecurringEditing(null)
  }

  function toggleRecurringDay(day: number) {
    if (!recurringEditing) return
    const days = recurringEditing.weekdays || []
    setRecurringEditing({
      ...recurringEditing,
      weekdays: days.includes(day) ? days.filter((item: number) => item !== day) : [...days, day].sort()
    })
  }

  function submitPayment() {
    const amount = Number(payment?.amount) || 0
    if (!payment || amount <= 0) return
    if (payUser(payment.userId, amount, payment.note || 'Pagamento paghetta')) setPayment(null)
  }

  const introAction = tab === 'recurring'
    ? <Button icon={<Repeat2 size={18} />} onClick={() => openRecurring()}>Nuovo ricorrente</Button>
    : <Button icon={<Plus size={18} />} onClick={openNew}>Nuovo compito</Button>

  return <div className="page">
    <PageIntro
      eyebrow="Responsabilità"
      title="Compiti & paghette"
      description="Compiti singoli o ricorrenti, accrediti automatici e pagamenti sempre reversibili."
      actions={introAction}
    />

    <div className="page-tabs-wrap">
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'chores', label: `Compiti · ${data.chores.filter(c => !c.done).length}` },
          { value: 'recurring', label: `Ricorrenti · ${data.recurringChores.filter(c => c.active).length}` },
          { value: 'wallets', label: 'Paghette & movimenti' }
        ]}
      />
    </div>

    {tab === 'chores' ? <div className="chores-grid">{data.users.map(user => {
      const chores = data.chores.filter(c => c.userId === user.id)
      return <Card key={user.id}>
        <CardHeader
          title={<span className="user-heading"><Avatar user={user} size="sm" />{user.name}</span>}
          subtitle={`${chores.filter(c => !c.done).length} da fare`}
        />
        {chores.length ? <div className="check-list">
          {chores
            .slice()
            .sort((a, b) => Number(a.done) - Number(b.done) || a.deadline.localeCompare(b.deadline))
            .map(chore => <div key={chore.id} className={`check-item chore-item ${chore.done ? 'is-done' : ''}`}>
              <button className="check-item__check" onClick={() => toggleChore(chore.id)}>
                {chore.done ? <CheckCircle2 size={16} /> : null}
              </button>
              <button className="check-item__copy" onClick={() => toggleChore(chore.id)}>
                <strong>{chore.title}</strong>
                <span>{chore.deadline} · {money(chore.amount)}{chore.recurringChoreId ? ' · Ricorrente' : ''}</span>
              </button>
              <IconButton label="Elimina" onClick={() => deleteChore(chore.id)}><Trash2 size={17} /></IconButton>
            </div>)}
        </div> : <EmptyState icon={<CheckCircle2 size={28} />} title="Tutto fatto" text="Nessun compito assegnato." />}
      </Card>
    })}</div> : null}

    {tab === 'recurring' ? <div className="recurring-grid">
      {data.users.map(user => {
        const recurring = data.recurringChores.filter(item => item.userId === user.id)
        return <Card key={user.id}>
          <CardHeader
            title={<span className="user-heading"><Avatar user={user} size="sm" />{user.name}</span>}
            subtitle={`${recurring.filter(item => item.active).length} attivi`}
          />
          {recurring.length ? <div className="recurring-list">
            {recurring.map(item => <div key={item.id} className={`recurring-row ${item.active ? '' : 'is-disabled'}`}>
              <label className="recurring-switch" title={item.active ? 'Disattiva' : 'Attiva'}>
                <input type="checkbox" checked={item.active} onChange={() => toggleRecurringChore(item.id)} />
              </label>
              <button className="recurring-row__copy" onClick={() => openRecurring(item)}>
                <strong>{item.title}</strong>
                <span>{recurringLabel(item.weekdays)} · {money(item.amount)} per completamento</span>
                {(item.startDate || item.endDate) ? <small>
                  Dal {item.startDate || '—'}{item.endDate ? ` al ${item.endDate}` : ''}
                </small> : null}
              </button>
              <Badge tone={item.active ? 'success' : 'neutral'}>{item.active ? 'Attivo' : 'Pausa'}</Badge>
              <IconButton label="Modifica" onClick={() => openRecurring(item)}><Pencil size={16} /></IconButton>
              <IconButton label="Elimina ricorrenza" onClick={() => deleteRecurringChore(item.id)}><Trash2 size={16} /></IconButton>
            </div>)}
          </div> : <EmptyState
            icon={<Repeat2 size={28} />}
            title="Nessun compito ricorrente"
            text="Crea attività abituali come apparecchiare, rifare il letto o sistemare la camera e assegna una paghetta fissa."
            action={<Button variant="soft" onClick={() => openRecurring()}>Crea il primo</Button>}
          />}
        </Card>
      })}
    </div> : null}

    {tab === 'wallets' ? <div className="wallet-layout">
      <div className="wallet-grid">{data.users.map(user => <Card key={user.id} className="wallet-card">
        <div className="wallet-card__head">
          <Avatar user={user} size="lg" />
          <div><span>{user.name}</span><strong>{showBalances ? money(user.balance) : '••••'}</strong></div>
        </div>
        <Button
          variant="soft"
          onClick={() => setPayment({ userId: user.id, amount: user.balance, note: 'Pagamento paghetta' })}
          disabled={user.balance <= 0}
        >
          Registra pagamento
        </Button>
      </Card>)}</div>

      <Card>
        <CardHeader title="Movimenti" subtitle="I pagamenti errati possono essere annullati." />
        {data.transactions.length ? <div className="transaction-list">
          {data.transactions.slice().sort((a, b) => b.id - a.id).map(tx => {
            const user = data.users.find(u => u.id === tx.userId)
            return <div key={tx.id} className={`transaction-row ${tx.reversed ? 'is-reversed' : ''}`}>
              <Avatar user={user} size="xs" />
              <div><strong>{tx.note}</strong><span>{tx.date} · {user?.name}</span></div>
              <Badge tone={tx.type === 'credit' ? 'success' : tx.type === 'payment' ? 'warning' : 'neutral'}>
                {tx.type === 'credit' ? '+' : '-'}{money(tx.amount)}
              </Badge>
              {tx.type === 'payment' && !tx.reversed
                ? <IconButton label="Annulla pagamento" onClick={() => undoTransaction(tx.id)}><RotateCcw size={17} /></IconButton>
                : tx.reversed ? <Badge>Annullato</Badge> : null}
            </div>
          })}
        </div> : <EmptyState icon={<WalletCards size={28} />} title="Nessun movimento" text="Qui appariranno accrediti e pagamenti." />}
      </Card>
    </div> : null}

    <Modal
      open={!!editing}
      onClose={() => setEditing(null)}
      title="Nuovo compito"
      footer={<div className="modal-actions"><span /><div className="modal-actions__right">
        <Button variant="ghost" onClick={() => setEditing(null)}>Annulla</Button>
        <Button onClick={saveChore}>Assegna</Button>
      </div></div>}
    >
      {editing ? <div className="form-grid form-grid--2">
        <Field label="Compito" className="field--wide">
          <input autoFocus value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Es. Sistemare la camera" />
        </Field>
        <Field label="Scadenza">
          <input type="date" value={editing.deadline} onChange={e => setEditing({ ...editing, deadline: e.target.value })} />
        </Field>
        <Field label="Assegna a">
          <select value={editing.userId} onChange={e => setEditing({ ...editing, userId: Number(e.target.value) })}>
            {data.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Compenso">
          <input type="number" min="0" step="0.1" value={editing.amount} onChange={e => setEditing({ ...editing, amount: Number(e.target.value) })} />
        </Field>
      </div> : null}
    </Modal>

    <Modal
      open={!!recurringEditing}
      onClose={() => setRecurringEditing(null)}
      title={recurringEditing?.id ? 'Modifica compito ricorrente' : 'Nuovo compito ricorrente'}
      subtitle="La cifra viene accreditata ogni volta che il compito del giorno viene completato."
      footer={<div className="modal-actions"><span /><div className="modal-actions__right">
        <Button variant="ghost" onClick={() => setRecurringEditing(null)}>Annulla</Button>
        <Button onClick={saveRecurring} disabled={!recurringEditing?.weekdays?.length}>Salva</Button>
      </div></div>}
    >
      {recurringEditing ? <div className="form-grid form-grid--2">
        <Field label="Compito" className="field--wide">
          <input
            autoFocus
            value={recurringEditing.title}
            onChange={e => setRecurringEditing({ ...recurringEditing, title: e.target.value })}
            placeholder="Es. Apparecchiare"
          />
        </Field>
        <Field label="Assegna a">
          <select value={recurringEditing.userId} onChange={e => setRecurringEditing({ ...recurringEditing, userId: Number(e.target.value) })}>
            {data.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Paghetta per completamento">
          <input
            type="number"
            min="0"
            step="0.1"
            value={recurringEditing.amount}
            onChange={e => setRecurringEditing({ ...recurringEditing, amount: Number(e.target.value) })}
          />
        </Field>
        <Field label="Dal">
          <input type="date" value={recurringEditing.startDate || ''} onChange={e => setRecurringEditing({ ...recurringEditing, startDate: e.target.value })} />
        </Field>
        <Field label="Fino al" hint="Facoltativo">
          <input type="date" min={recurringEditing.startDate || undefined} value={recurringEditing.endDate || ''} onChange={e => setRecurringEditing({ ...recurringEditing, endDate: e.target.value })} />
        </Field>
        <Field label="Giorni" className="field--wide" hint="Seleziona uno o più giorni della settimana">
          <div className="weekday-picker">
            {WEEKDAYS.map(day => <button
              type="button"
              key={day.id}
              className={recurringEditing.weekdays?.includes(day.id) ? 'is-active' : ''}
              onClick={() => toggleRecurringDay(day.id)}
            >
              {day.label}
            </button>)}
          </div>
          <div className="recurring-presets">
            <button type="button" onClick={() => setRecurringEditing({ ...recurringEditing, weekdays: [1, 2, 3, 4, 5, 6, 7] })}>Tutti i giorni</button>
            <button type="button" onClick={() => setRecurringEditing({ ...recurringEditing, weekdays: [1, 2, 3, 4, 5] })}>Lun–Ven</button>
            <button type="button" onClick={() => setRecurringEditing({ ...recurringEditing, weekdays: [6, 7] })}>Weekend</button>
          </div>
        </Field>
        <label className="toggle-row field--wide">
          <input
            type="checkbox"
            checked={recurringEditing.active !== false}
            onChange={e => setRecurringEditing({ ...recurringEditing, active: e.target.checked })}
          />
          Attivo: genera automaticamente il compito nei giorni selezionati
        </label>
      </div> : null}
    </Modal>

    <Modal
      open={!!payment}
      onClose={() => setPayment(null)}
      title="Registra pagamento"
      subtitle={payment ? data.users.find(u => u.id === payment.userId)?.name : ''}
      footer={<div className="modal-actions"><span /><div className="modal-actions__right">
        <Button variant="ghost" onClick={() => setPayment(null)}>Annulla</Button>
        <Button onClick={submitPayment}>Conferma pagamento</Button>
      </div></div>}
    >
      {payment ? <div className="form-grid">
        <Field label="Importo"><input type="number" min="0" step="0.1" value={payment.amount} onChange={e => setPayment({ ...payment, amount: Number(e.target.value) })} /></Field>
        <Field label="Nota"><input value={payment.note} onChange={e => setPayment({ ...payment, note: e.target.value })} /></Field>
      </div> : null}
    </Modal>
  </div>
}
