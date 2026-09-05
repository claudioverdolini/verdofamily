import React, { useState } from 'react'
import { CheckCircle2, Plus, RotateCcw, Trash2, WalletCards } from 'lucide-react'
import { useFamily } from '../store'
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Modal, PageIntro, Segmented } from '../ui'
import { localDateISO, money } from '../utils'

export default function ChoresPage() {
  const { data, authUser, addChore, toggleChore, deleteChore, payUser, undoTransaction } = useFamily()
  const [tab, setTab] = useState<'chores' | 'wallets'>('chores')
  const [editing, setEditing] = useState<any>(null)
  const [payment, setPayment] = useState<any>(null)
  const showBalances = authUser?.prefs?.showBalances !== false

  function openNew() {
    setEditing({ title: '', deadline: localDateISO(), userId: data.users[0]?.id || 1, amount: 1 })
  }

  function saveChore() {
    if (!editing?.title?.trim()) return
    addChore({ title: editing.title.trim(), deadline: editing.deadline, userId: Number(editing.userId), amount: Math.max(0, Number(editing.amount) || 0) })
    setEditing(null)
  }

  function submitPayment() {
    const amount = Number(payment?.amount) || 0
    if (!payment || amount <= 0) return
    if (payUser(payment.userId, amount, payment.note || 'Pagamento paghetta')) setPayment(null)
  }

  return <div className="page">
    <PageIntro eyebrow="Responsabilità" title="Compiti & paghette" description="Compiti chiari, accrediti automatici e pagamenti sempre reversibili." actions={<Button icon={<Plus size={18} />} onClick={openNew}>Nuovo compito</Button>} />
    <div className="page-tabs-wrap"><Segmented value={tab} onChange={setTab} options={[{ value: 'chores', label: `Compiti · ${data.chores.filter(c => !c.done).length}` }, { value: 'wallets', label: 'Paghette & movimenti' }]} /></div>

    {tab === 'chores' ? <div className="chores-grid">{data.users.map(user => {
      const chores = data.chores.filter(c => c.userId === user.id)
      return <Card key={user.id}><CardHeader title={<span className="user-heading"><Avatar user={user} size="sm" />{user.name}</span>} subtitle={`${chores.filter(c => !c.done).length} da fare`} />{chores.length ? <div className="check-list">{chores.sort((a, b) => Number(a.done) - Number(b.done) || a.deadline.localeCompare(b.deadline)).map(chore => <div key={chore.id} className={`check-item chore-item ${chore.done ? 'is-done' : ''}`}><button className="check-item__check" onClick={() => toggleChore(chore.id)}>{chore.done ? <CheckCircle2 size={16} /> : null}</button><button className="check-item__copy" onClick={() => toggleChore(chore.id)}><strong>{chore.title}</strong><span>{chore.deadline} · {money(chore.amount)}</span></button><IconButton label="Elimina" onClick={() => deleteChore(chore.id)}><Trash2 size={17} /></IconButton></div>)}</div> : <EmptyState icon={<CheckCircle2 size={28} />} title="Tutto fatto" text="Nessun compito assegnato." />}</Card>
    })}</div> : null}

    {tab === 'wallets' ? <div className="wallet-layout"><div className="wallet-grid">{data.users.map(user => <Card key={user.id} className="wallet-card"><div className="wallet-card__head"><Avatar user={user} size="lg" /><div><span>{user.name}</span><strong>{showBalances ? money(user.balance) : '••••'}</strong></div></div><Button variant="soft" onClick={() => setPayment({ userId: user.id, amount: user.balance, note: 'Pagamento paghetta' })} disabled={user.balance <= 0}>Registra pagamento</Button></Card>)}</div><Card><CardHeader title="Movimenti" subtitle="I pagamenti errati possono essere annullati." />{data.transactions.length ? <div className="transaction-list">{data.transactions.slice().sort((a, b) => b.id - a.id).map(tx => { const user = data.users.find(u => u.id === tx.userId); return <div key={tx.id} className={`transaction-row ${tx.reversed ? 'is-reversed' : ''}`}><Avatar user={user} size="xs" /><div><strong>{tx.note}</strong><span>{tx.date} · {user?.name}</span></div><Badge tone={tx.type === 'credit' ? 'success' : tx.type === 'payment' ? 'warning' : 'neutral'}>{tx.type === 'credit' ? '+' : '-'}{money(tx.amount)}</Badge>{tx.type === 'payment' && !tx.reversed ? <IconButton label="Annulla pagamento" onClick={() => undoTransaction(tx.id)}><RotateCcw size={17} /></IconButton> : tx.reversed ? <Badge>Annullato</Badge> : null}</div> })}</div> : <EmptyState icon={<WalletCards size={28} />} title="Nessun movimento" text="Qui appariranno accrediti e pagamenti." />}</Card></div> : null}

    <Modal open={!!editing} onClose={() => setEditing(null)} title="Nuovo compito" footer={<div className="modal-actions"><span /><div className="modal-actions__right"><Button variant="ghost" onClick={() => setEditing(null)}>Annulla</Button><Button onClick={saveChore}>Assegna</Button></div></div>}>{editing ? <div className="form-grid form-grid--2"><Field label="Compito" className="field--wide"><input autoFocus value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Es. Sistemare la camera" /></Field><Field label="Scadenza"><input type="date" value={editing.deadline} onChange={e => setEditing({ ...editing, deadline: e.target.value })} /></Field><Field label="Assegna a"><select value={editing.userId} onChange={e => setEditing({ ...editing, userId: Number(e.target.value) })}>{data.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field><Field label="Compenso"><input type="number" min="0" step="0.5" value={editing.amount} onChange={e => setEditing({ ...editing, amount: Number(e.target.value) })} /></Field></div> : null}</Modal>

    <Modal open={!!payment} onClose={() => setPayment(null)} title="Registra pagamento" subtitle={payment ? data.users.find(u => u.id === payment.userId)?.name : ''} footer={<div className="modal-actions"><span /><div className="modal-actions__right"><Button variant="ghost" onClick={() => setPayment(null)}>Annulla</Button><Button onClick={submitPayment}>Conferma pagamento</Button></div></div>}>{payment ? <div className="form-grid"><Field label="Importo"><input type="number" min="0" step="0.5" value={payment.amount} onChange={e => setPayment({ ...payment, amount: Number(e.target.value) })} /></Field><Field label="Nota"><input value={payment.note} onChange={e => setPayment({ ...payment, note: e.target.value })} /></Field></div> : null}</Modal>
  </div>
}
