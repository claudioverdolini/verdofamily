import React, { useState } from 'react'
import { CheckCircle2, Clock3, Pencil, Plus, Repeat2, RotateCcw, Trash2, WalletCards, XCircle } from 'lucide-react'
import { useFamily } from '../store'
import MultiAssigneePicker from '../components/MultiAssigneePicker'
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

function choreStatus(chore: any): 'open' | 'pending' | 'approved' {
  if (chore.done) return 'approved'
  return chore.completionStatus === 'pending' ? 'pending' : 'open'
}

export default function ChoresPage() {
  const {
    data,
    authUser,
    addChore,
    toggleChore,
    approveChore,
    rejectChore,
    deleteChore,
    upsertRecurringChore,
    toggleRecurringChore,
    deleteRecurringChore,
    payUser,
    undoTransaction
  } = useFamily()

  const isChild = authUser?.role === 'bimbo'
  const [tab, setTab] = useState<'chores' | 'recurring' | 'wallets'>('chores')
  const [editing, setEditing] = useState<any>(null)
  const [recurringEditing, setRecurringEditing] = useState<any>(null)
  const [payment, setPayment] = useState<any>(null)
  const showBalances = authUser?.prefs?.showBalances !== false

  const visibleUsers = isChild && authUser
    ? data.users.filter(user => user.id === authUser.id)
    : data.users
  const walletUsers = visibleUsers
  const pendingApprovalCount = data.chores.filter(chore => !chore.done && chore.completionStatus === 'pending').length

  function openNew() {
    if (isChild) return
    const defaultUserId = data.users.find(user => user.role === 'bimbo')?.id || data.users[0]?.id || 1
    setEditing({ title: '', deadline: localDateISO(), userId: defaultUserId, userIds: [defaultUserId], amount: 1 })
  }

  function openRecurring(item?: any) {
    if (isChild) return
    const defaultUserId = data.users.find(user => user.role === 'bimbo')?.id || data.users[0]?.id || 1
    setRecurringEditing(item
      ? {
          ...item,
          userIds: Array.from(new Set(
            (Array.isArray(item.userIds) && item.userIds.length ? item.userIds : [item.userId])
              .map(Number)
              .filter((id: number) => id > 0)
          )),
          weekdays: [...(item.weekdays || [])]
        }
      : {
          title: '',
          userId: defaultUserId,
          userIds: [defaultUserId],
          amount: 1,
          weekdays: [1, 2, 3, 4, 5, 6, 7],
          active: true,
          startDate: localDateISO(),
          endDate: ''
        })
  }

  function saveChore() {
    if (!editing?.title?.trim() || isChild) return
    const userIds = Array.from(new Set(
      (Array.isArray(editing.userIds) && editing.userIds.length ? editing.userIds : [editing.userId])
        .map(Number)
        .filter((id: number) => id > 0)
    ))
    if (!userIds.length) return
    for (const userId of userIds) {
      addChore({
        title: editing.title.trim(),
        deadline: editing.deadline,
        userId,
        amount: Math.max(0, Number(editing.amount) || 0)
      })
    }
    setEditing(null)
  }

  function saveRecurring() {
    const userIds = Array.from(new Set(
      (Array.isArray(recurringEditing?.userIds) ? recurringEditing.userIds : [])
        .map(Number)
        .filter((id: number) => id > 0)
    ))
    if (isChild || !recurringEditing?.title?.trim() || !recurringEditing?.weekdays?.length || !userIds.length) return
    upsertRecurringChore({
      id: recurringEditing.id,
      title: recurringEditing.title.trim(),
      userId: userIds[0],
      userIds,
      amount: Math.max(0, Number(recurringEditing.amount) || 0),
      weekdays: recurringEditing.weekdays.map(Number),
      active: recurringEditing.active !== false,
      startDate: recurringEditing.startDate || localDateISO(),
      endDate: recurringEditing.endDate || undefined
    })
    setRecurringEditing(null)
  }

  function toggleRecurringAssignee(userId: number) {
    if (!recurringEditing || isChild) return
    const current = Array.isArray(recurringEditing.userIds) ? recurringEditing.userIds.map(Number) : []
    const userIds = current.includes(userId)
      ? current.filter((id: number) => id !== userId)
      : [...current, userId]
    setRecurringEditing({
      ...recurringEditing,
      userIds,
      userId: userIds[0] || 0
    })
  }

  function toggleRecurringDay(day: number) {
    if (!recurringEditing || isChild) return
    const days = recurringEditing.weekdays || []
    setRecurringEditing({
      ...recurringEditing,
      weekdays: days.includes(day) ? days.filter((item: number) => item !== day) : [...days, day].sort()
    })
  }

  function submitPayment() {
    if (isChild) return
    const amount = Number(payment?.amount) || 0
    if (!payment || amount <= 0) return
    if (payUser(payment.userId, amount, payment.note || 'Pagamento paghetta')) setPayment(null)
  }

  const introAction = isChild
    ? null
    : tab === 'recurring'
      ? <Button icon={<Repeat2 size={18} />} onClick={() => openRecurring()}>Nuovo ricorrente</Button>
      : tab === 'chores'
        ? <Button icon={<Plus size={18} />} onClick={openNew}>Nuovo compito</Button>
        : null

  const tabs = isChild
    ? [
        { value: 'chores', label: `Da fare · ${data.chores.filter(c => c.userId === authUser?.id && !c.done).length}` },
        { value: 'wallets', label: 'Paghetta' }
      ]
    : [
        { value: 'chores', label: `Da fare · ${data.chores.filter(c => !c.done).length}` },
        { value: 'recurring', label: `Ricorrenti · ${data.recurringChores.filter(c => c.active).length}` },
        { value: 'wallets', label: 'Paghette' }
      ]

  return <div className="page">
    <PageIntro
      eyebrow="Responsabilità"
      title="Compiti & paghette"
      description={isChild
        ? 'Segna i tuoi compiti come fatti. La paghetta viene accreditata dopo la conferma di un genitore.'
        : 'I ragazzi segnalano i compiti completati; un adulto li verifica e approva prima dell’accredito.'}
      actions={introAction}
    />

    {!isChild && pendingApprovalCount > 0 ? <div className="approval-banner">
      <Clock3 size={18} />
      <div>
        <strong>{pendingApprovalCount} {pendingApprovalCount === 1 ? 'compito aspetta' : 'compiti aspettano'} la tua conferma</strong>
        <span>La paghetta non è ancora stata accreditata.</span>
      </div>
    </div> : null}

    <div className="page-tabs-wrap page-tabs-wrap--chores">
      <Segmented
        value={isChild && tab === 'recurring' ? 'chores' : tab}
        onChange={setTab}
        options={tabs}
      />
    </div>

    {(tab === 'chores' || (isChild && tab === 'recurring')) ? <div className="chores-grid">{visibleUsers.map(user => {
      const chores = data.chores.filter(c => c.userId === user.id)
      const openCount = chores.filter(c => !c.done && c.completionStatus !== 'pending').length
      const waitingCount = chores.filter(c => !c.done && c.completionStatus === 'pending').length
      const subtitle = isChild
        ? `${openCount} da fare${waitingCount ? ` · ${waitingCount} in attesa` : ''}`
        : `${openCount} da fare${waitingCount ? ` · ${waitingCount} da confermare` : ''}`

      return <Card key={user.id}>
        <CardHeader
          title={<span className="user-heading"><Avatar user={user} size="sm" />{user.name}</span>}
          subtitle={subtitle}
        />
        {chores.length ? <div className="check-list">
          {chores
            .slice()
            .sort((a, b) => {
              const order = { pending: 0, open: 1, approved: 2 }
              const byStatus = order[choreStatus(a)] - order[choreStatus(b)]
              return byStatus || a.deadline.localeCompare(b.deadline)
            })
            .map(chore => {
              const status = choreStatus(chore)
              const isPending = status === 'pending'
              const isApproved = status === 'approved'
              const canChildToggle = isChild && chore.userId === authUser?.id && !isApproved
              const childActionText = isPending ? 'Tocca per annullare la richiesta' : 'Tocca quando hai finito'

              return <div key={chore.id} className={`check-item chore-item chore-item--${status} ${isApproved ? 'is-done' : ''}`}>
                <button
                  className="check-item__check"
                  onClick={() => {
                    if (isChild) {
                      if (canChildToggle) toggleChore(chore.id)
                    } else if (!isPending) {
                      toggleChore(chore.id)
                    }
                  }}
                  disabled={isChild ? !canChildToggle : isPending}
                  title={isChild ? childActionText : isPending ? 'Usa Conferma o Rifiuta' : isApproved ? 'Riapri compito' : 'Segna e approva'}
                >
                  {isApproved ? <CheckCircle2 size={16} /> : isPending ? <Clock3 size={15} /> : null}
                </button>

                <button
                  className="check-item__copy"
                  onClick={() => {
                    if (isChild && canChildToggle) toggleChore(chore.id)
                  }}
                  disabled={!isChild || !canChildToggle}
                >
                  <strong>{chore.title}</strong>
                  <span>
                    {chore.deadline} · {money(chore.amount)}
                    {chore.recurringChoreId ? ' · Ricorrente' : ''}
                  </span>
                  <small className={`chore-status chore-status--${status}`}>
                    {isPending
                      ? (isChild ? '✓ Segnalato come fatto · attende un genitore' : 'Da verificare e confermare')
                      : isApproved
                        ? '✓ Approvato · paghetta accreditata'
                        : (isChild ? 'Da fare · segnalo io quando ho finito' : 'Da fare')}
                  </small>
                </button>

                {!isChild && isPending ? <div className="chore-approval-actions">
                  <Button size="sm" variant="soft" onClick={() => approveChore(chore.id)}>Conferma</Button>
                  <IconButton label="Rifiuta e riapri" onClick={() => rejectChore(chore.id)}><XCircle size={17} /></IconButton>
                </div> : null}

                {!isChild && !isPending ? <IconButton label="Elimina" onClick={() => deleteChore(chore.id)}><Trash2 size={17} /></IconButton> : null}
              </div>
            })}
        </div> : <EmptyState
          icon={<CheckCircle2 size={28} />}
          title="Tutto fatto"
          text={isChild ? 'Non hai compiti assegnati.' : 'Nessun compito assegnato.'}
        />}
      </Card>
    })}</div> : null}

    {!isChild && tab === 'recurring' ? <Card className="recurring-master-card">
      <CardHeader
        title="Compiti ricorrenti"
        subtitle={`${data.recurringChores.filter(item => item.active).length} attivi · ogni attività può essere assegnata a più persone`}
        action={<Button variant="soft" icon={<Repeat2 size={17} />} onClick={() => openRecurring()}>Nuovo</Button>}
      />
      {data.recurringChores.length ? <div className="recurring-list">
        {data.recurringChores.map(item => {
          const userIds = Array.from(new Set(
            (Array.isArray(item.userIds) && item.userIds.length ? item.userIds : [item.userId])
              .map(Number)
              .filter((id: number) => id > 0)
          ))
          const assignees = userIds.map((id: number) => data.users.find(user => user.id === id)).filter(Boolean)
          return <div key={item.id} className={`recurring-row recurring-row--multi ${item.active ? '' : 'is-disabled'}`}>
            <label className="recurring-switch" title={item.active ? 'Disattiva' : 'Attiva'}>
              <input type="checkbox" checked={item.active} onChange={() => toggleRecurringChore(item.id)} />
            </label>
            <button className="recurring-row__copy" onClick={() => openRecurring(item)}>
              <strong>{item.title}</strong>
              <span>{recurringLabel(item.weekdays)} · {money(item.amount)} per persona</span>
              <span className="recurring-row__people">
                <span className="recurring-row__avatars">{assignees.slice(0, 4).map((user: any) => <Avatar key={user.id} user={user} size="xs" />)}</span>
                <small>{assignees.map((user: any) => user.name).join(', ') || 'Nessun assegnatario'}</small>
              </span>
              {(item.startDate || item.endDate) ? <small>
                Dal {item.startDate || '—'}{item.endDate ? ` al ${item.endDate}` : ''}
              </small> : null}
            </button>
            <Badge tone={item.active ? 'success' : 'neutral'}>{item.active ? 'Attivo' : 'Pausa'}</Badge>
            <IconButton label="Modifica" onClick={() => openRecurring(item)}><Pencil size={16} /></IconButton>
            <IconButton label="Elimina ricorrenza" onClick={() => deleteRecurringChore(item.id)}><Trash2 size={16} /></IconButton>
          </div>
        })}
      </div> : <EmptyState
        icon={<Repeat2 size={28} />}
        title="Nessun compito ricorrente"
        text="Crea attività abituali come apparecchiare, rifare il letto o sistemare la camera e assegnale a una o più persone."
        action={<Button variant="soft" onClick={() => openRecurring()}>Crea il primo</Button>}
      />}
    </Card> : null}

    {tab === 'wallets' ? <div className="wallet-layout">
      <div className="wallet-grid">{walletUsers.map(user => <Card key={user.id} className="wallet-card">
        <div className="wallet-card__head">
          <Avatar user={user} size="lg" />
          <div>
            <span>{user.name}</span>
            <strong>{showBalances ? money(user.balance) : '••••'}</strong>
            {isChild ? <small>Disponibile dopo l’approvazione dei compiti</small> : null}
          </div>
        </div>
        {!isChild ? <Button
          variant="soft"
          onClick={() => setPayment({ userId: user.id, amount: user.balance, note: 'Pagamento paghetta' })}
          disabled={user.balance <= 0}
        >
          Registra pagamento
        </Button> : null}
      </Card>)}</div>

      <Card>
        <CardHeader
          title={isChild ? 'I miei movimenti' : 'Movimenti'}
          subtitle={isChild ? 'Accrediti approvati e pagamenti registrati.' : 'I pagamenti errati possono essere annullati.'}
        />
        {data.transactions.filter(tx => !isChild || tx.userId === authUser?.id).length ? <div className="transaction-list">
          {data.transactions
            .filter(tx => !isChild || tx.userId === authUser?.id)
            .slice()
            .sort((a, b) => b.id - a.id)
            .map(tx => {
              const user = data.users.find(u => u.id === tx.userId)
              return <div key={tx.id} className={`transaction-row ${tx.reversed ? 'is-reversed' : ''}`}>
                <Avatar user={user} size="xs" />
                <div><strong>{tx.note}</strong><span>{tx.date} · {user?.name}</span></div>
                <Badge tone={tx.type === 'credit' ? 'success' : tx.type === 'payment' ? 'warning' : 'neutral'}>
                  {tx.type === 'credit' ? '+' : '-'}{money(tx.amount)}
                </Badge>
                {!isChild && tx.type === 'payment' && !tx.reversed
                  ? <IconButton label="Annulla pagamento" onClick={() => undoTransaction(tx.id)}><RotateCcw size={17} /></IconButton>
                  : tx.reversed ? <Badge>Annullato</Badge> : null}
              </div>
            })}
        </div> : <EmptyState icon={<WalletCards size={28} />} title="Nessun movimento" text="Qui appariranno accrediti e pagamenti." />}
      </Card>
    </div> : null}

    {!isChild ? <Modal
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
        <Field label="Assegna a" className="field--wide" hint="Puoi selezionare una o più persone. Ogni assegnatario avrà completamento e paghetta separati.">
          <MultiAssigneePicker
            users={data.users}
            selectedIds={editing.userIds || [editing.userId].filter(Boolean)}
            onChange={userIds => setEditing({ ...editing, userIds, userId: userIds[0] || 0 })}
          />
        </Field>
        <Field label="Compenso">
          <input type="number" min="0" step="0.1" value={editing.amount} onChange={e => setEditing({ ...editing, amount: Number(e.target.value) })} />
        </Field>
      </div> : null}
    </Modal> : null}

    {!isChild ? <Modal
      open={!!recurringEditing}
      onClose={() => setRecurringEditing(null)}
      title={recurringEditing?.id ? 'Modifica compito ricorrente' : 'Nuovo compito ricorrente'}
      subtitle="L’importo viene accreditato solo dopo la conferma di un adulto."
      className="modal--recurring-chore"
      footer={<div className="modal-actions"><span /><div className="modal-actions__right">
        <Button variant="ghost" onClick={() => setRecurringEditing(null)}>Annulla</Button>
        <Button onClick={saveRecurring} disabled={!recurringEditing?.weekdays?.length || !recurringEditing?.userIds?.length}>Salva</Button>
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
        <Field label="Assegna a" className="field--wide" hint="Puoi selezionare una o più persone. Ognuno avrà il proprio completamento e accredito.">
          <div className="recurring-assignee-picker">
            {data.users.map(user => {
              const selected = recurringEditing.userIds?.includes(user.id)
              return <button
                type="button"
                key={user.id}
                className={selected ? 'is-selected' : ''}
                onClick={() => toggleRecurringAssignee(user.id)}
              >
                <Avatar user={user} size="sm" />
                <span><strong>{user.name}</strong><small>{user.role === 'bimbo' ? 'Bambino' : user.role === 'admin' ? 'Admin' : 'Adulto'}</small></span>
                <span className="recurring-assignee-picker__check">{selected ? <CheckCircle2 size={18} /> : null}</span>
              </button>
            })}
          </div>
          <div className="recurring-assignee-shortcuts">
            <button type="button" onClick={() => {
              const ids = data.users.filter(user => user.role === 'bimbo').map(user => user.id)
              setRecurringEditing({ ...recurringEditing, userIds: ids, userId: ids[0] || 0 })
            }}>Tutti i bambini</button>
            <button type="button" onClick={() => {
              const ids = data.users.map(user => user.id)
              setRecurringEditing({ ...recurringEditing, userIds: ids, userId: ids[0] || 0 })
            }}>Tutta la famiglia</button>
          </div>
        </Field>
        <Field label="Paghetta dopo approvazione">
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
    </Modal> : null}

    {!isChild ? <Modal
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
    </Modal> : null}
  </div>
}
