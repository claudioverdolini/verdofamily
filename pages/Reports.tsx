import React, { useMemo, useState } from 'react'
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  ReceiptText,
  ShoppingBasket,
  Store,
  Trash2,
  WalletCards
} from 'lucide-react'
import { useFamily } from '../store'
import { Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Modal, PageIntro, Segmented } from '../ui'
import { localDateISO, money } from '../utils'
import type { ExpenseCategory, ExpenseRecord } from '../types'

const CATEGORIES: Array<{ value: ExpenseCategory; label: string }> = [
  { value: 'groceries', label: 'Spesa alimentare' },
  { value: 'home', label: 'Casa' },
  { value: 'transport', label: 'Auto e trasporti' },
  { value: 'health', label: 'Salute' },
  { value: 'school', label: 'Scuola' },
  { value: 'bills', label: 'Bollette e utenze' },
  { value: 'leisure', label: 'Tempo libero' },
  { value: 'clothing', label: 'Abbigliamento' },
  { value: 'other', label: 'Altro' }
]

function categoryLabel(value: ExpenseCategory) {
  return CATEGORIES.find(item => item.value === value)?.label || 'Altro'
}

function monthKey(date = localDateISO()) {
  return date.slice(0, 7)
}

function moveMonth(value: string, delta: number) {
  const [year, month] = value.split('-').map(Number)
  const date = new Date(year, month - 1 + delta, 1, 12)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(value: string) {
  return new Date(`${value}-01T12:00:00`).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
}

export default function ReportsPage() {
  const { data, authUser, upsertExpense, deleteExpense, setActivePage } = useFamily()
  const [period, setPeriod] = useState<'month' | 'year'>('month')
  const [cursor, setCursor] = useState(monthKey())
  const [editing, setEditing] = useState<any>(null)

  const selectedYear = Number(cursor.slice(0, 4))
  const expenses = useMemo(() => (data.expenses || []).slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)), [data.expenses])
  const filtered = useMemo(() => expenses.filter(item => period === 'month'
    ? item.date.startsWith(cursor)
    : item.date.startsWith(String(selectedYear))
  ), [expenses, period, cursor, selectedYear])

  const stats = useMemo(() => {
    const total = filtered.reduce((sum, item) => sum + Number(item.total || 0), 0)
    const grocery = filtered.filter(item => item.category === 'groceries').reduce((sum, item) => sum + Number(item.total || 0), 0)
    return {
      total,
      count: filtered.length,
      average: filtered.length ? total / filtered.length : 0,
      grocery
    }
  }, [filtered])

  const categoryRows = useMemo(() => {
    const totals = new Map<ExpenseCategory, number>()
    filtered.forEach(item => totals.set(item.category, (totals.get(item.category) || 0) + Number(item.total || 0)))
    return [...totals.entries()]
      .map(([category, total]) => ({ category, total, pct: stats.total ? total / stats.total * 100 : 0 }))
      .sort((a, b) => b.total - a.total)
  }, [filtered, stats.total])

  const merchantRows = useMemo(() => {
    const totals = new Map<string, { total: number; count: number }>()
    filtered.forEach(item => {
      const key = item.merchant || 'Spesa'
      const current = totals.get(key) || { total: 0, count: 0 }
      totals.set(key, { total: current.total + Number(item.total || 0), count: current.count + 1 })
    })
    return [...totals.entries()]
      .map(([merchant, value]) => ({ merchant, ...value }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8)
  }, [filtered])

  const trend = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, index) => moveMonth(monthKey(), index - 5))
    const rows = months.map(month => ({
      month,
      total: expenses.filter(item => item.date.startsWith(month)).reduce((sum, item) => sum + Number(item.total || 0), 0)
    }))
    const max = Math.max(1, ...rows.map(item => item.total))
    return rows.map(item => ({ ...item, pct: item.total / max * 100 }))
  }, [expenses])

  function openNew() {
    if (authUser?.role === 'bimbo') return
    setEditing({
      date: localDateISO(),
      merchant: '',
      total: '',
      category: 'other' as ExpenseCategory,
      notes: '',
      source: 'manual',
      items: []
    })
  }

  function openEdit(item: ExpenseRecord) {
    if (authUser?.role === 'bimbo') return
    setEditing({ ...item })
  }

  function save() {
    if (!editing || !editing.merchant?.trim() || Number(editing.total) <= 0) return
    upsertExpense({
      id: editing.id,
      date: editing.date || localDateISO(),
      merchant: editing.merchant.trim(),
      total: Number(editing.total),
      category: editing.category || 'other',
      source: editing.source === 'receipt' ? 'receipt' : 'manual',
      sourceRef: editing.sourceRef,
      createdAt: editing.createdAt,
      createdByUserId: editing.createdByUserId,
      notes: editing.notes || '',
      items: Array.isArray(editing.items) ? editing.items : []
    })
    setEditing(null)
  }

  const canEdit = authUser?.role !== 'bimbo'
  const periodTitle = period === 'month'
    ? monthLabel(cursor)
    : String(selectedYear)

  return <div className="page page--reports">
    <PageIntro
      eyebrow="Analisi famiglia"
      title="Report"
      description="Spese, scontrini e andamento dei consumi raccolti in un unico riepilogo."
      actions={canEdit ? <Button icon={<Plus size={18} />} onClick={openNew}>Nuova spesa</Button> : null}
    />

    <div className="report-toolbar">
      <Segmented value={period} onChange={setPeriod} options={[{ value: 'month', label: 'Mese' }, { value: 'year', label: 'Anno' }]} />
      <div className="report-period-nav">
        <IconButton label="Periodo precedente" onClick={() => setCursor(period === 'month' ? moveMonth(cursor, -1) : `${selectedYear - 1}-01`)}><ChevronLeft size={19} /></IconButton>
        <strong>{periodTitle}</strong>
        <IconButton label="Periodo successivo" onClick={() => setCursor(period === 'month' ? moveMonth(cursor, 1) : `${selectedYear + 1}-01`)}><ChevronRight size={19} /></IconButton>
      </div>
    </div>

    <div className="report-stats">
      <Card className="report-stat report-stat--primary"><WalletCards size={20} /><span><small>Spesa totale</small><strong>{money(stats.total)}</strong></span></Card>
      <Card className="report-stat"><ReceiptText size={20} /><span><small>Movimenti</small><strong>{stats.count}</strong></span></Card>
      <Card className="report-stat"><BarChart3 size={20} /><span><small>Media per spesa</small><strong>{money(stats.average)}</strong></span></Card>
      <Card className="report-stat"><ShoppingBasket size={20} /><span><small>Alimentari</small><strong>{money(stats.grocery)}</strong></span></Card>
    </div>

    <div className="report-grid">
      <Card>
        <CardHeader title="Per categoria" subtitle="Dove si concentra la spesa nel periodo selezionato" />
        {categoryRows.length ? <div className="report-breakdown">
          {categoryRows.map(row => <div key={row.category} className="report-breakdown__row">
            <div><strong>{categoryLabel(row.category)}</strong><span>{money(row.total)} · {Math.round(row.pct)}%</span></div>
            <div className="report-bar"><span style={{ width: `${Math.max(3, row.pct)}%` }} /></div>
          </div>)}
        </div> : <EmptyState title="Nessuna spesa nel periodo" text="Gli scontrini importati e le spese manuali compariranno qui." />}
      </Card>

      <Card>
        <CardHeader title="Negozi / fornitori" subtitle="Classifica per importo nel periodo" />
        {merchantRows.length ? <div className="report-merchant-list">
          {merchantRows.map((row, index) => <div key={row.merchant}>
            <span className="report-rank">{index + 1}</span>
            <div><strong>{row.merchant}</strong><small>{row.count} {row.count === 1 ? 'spesa' : 'spese'}</small></div>
            <b>{money(row.total)}</b>
          </div>)}
        </div> : <EmptyState icon={<Store size={28} />} title="Nessun negozio" text="Appariranno appena registri una spesa." />}
      </Card>
    </div>

    <Card className="report-trend-card">
      <CardHeader title="Ultimi 6 mesi" subtitle="Andamento della spesa registrata" />
      <div className="report-trend">
        {trend.map(row => <div key={row.month}>
          <div className="report-trend__bar"><span style={{ height: `${Math.max(row.total ? 8 : 2, row.pct)}%` }} /></div>
          <strong>{money(row.total)}</strong>
          <small>{monthLabel(row.month).split(' ')[0].slice(0, 3)}</small>
        </div>)}
      </div>
    </Card>

    <Card>
      <CardHeader
        title="Movimenti"
        subtitle={filtered.length ? `${filtered.length} registrati nel periodo` : 'Nessun movimento'}
        action={<Button size="sm" variant="soft" onClick={() => setActivePage('shopping')}>Importa scontrino</Button>}
      />
      {filtered.length ? <div className="expense-list">
        {filtered.map(item => <div key={item.id} className="expense-row">
          <div className="expense-row__date"><strong>{item.date.slice(8, 10)}</strong><span>{item.date.slice(5, 7)}</span></div>
          <div className="expense-row__copy">
            <strong>{item.merchant}</strong>
            <span>{categoryLabel(item.category)} · {item.source === 'receipt' ? 'Da scontrino' : 'Manuale'}{item.items.length ? ` · ${item.items.length} articoli` : ''}</span>
            {item.notes ? <small>{item.notes}</small> : null}
          </div>
          <div className="expense-row__amount"><strong>{money(item.total)}</strong>{item.source === 'receipt' ? <Badge tone="success">OCR</Badge> : <Badge>Manuale</Badge>}</div>
          {canEdit ? <div className="expense-row__actions">
            <IconButton label="Modifica" onClick={() => openEdit(item)}><Pencil size={16} /></IconButton>
            <IconButton label="Elimina" onClick={() => void deleteExpense(item.id)}><Trash2 size={16} /></IconButton>
          </div> : null}
        </div>)}
      </div> : <EmptyState icon={<ReceiptText size={30} />} title="Ancora nessuna spesa" text="Carica uno scontrino dalla sezione Spesa oppure registra una spesa manuale." action={canEdit ? <Button onClick={openNew}>Registra spesa</Button> : undefined} />}
    </Card>

    <Modal
      open={!!editing}
      onClose={() => setEditing(null)}
      title={editing?.id ? 'Modifica spesa' : 'Nuova spesa'}
      subtitle={editing?.source === 'receipt' ? 'Questa voce è stata generata da uno scontrino.' : 'Inserimento manuale'}
      footer={<div className="modal-actions"><span /><div className="modal-actions__right"><Button variant="ghost" onClick={() => setEditing(null)}>Annulla</Button><Button onClick={save} disabled={!editing?.merchant?.trim() || Number(editing?.total) <= 0}>Salva</Button></div></div>}
    >
      {editing ? <div className="form-grid form-grid--2">
        <Field label="Data"><input type="date" value={editing.date || ''} onChange={e => setEditing({ ...editing, date: e.target.value })} /></Field>
        <Field label="Importo"><input type="number" min="0" step="0.01" value={editing.total} onChange={e => setEditing({ ...editing, total: e.target.value })} /></Field>
        <Field label="Negozio / fornitore" className="field--wide"><input autoFocus value={editing.merchant || ''} onChange={e => setEditing({ ...editing, merchant: e.target.value })} placeholder="Es. Conad, farmacia, Enel…" /></Field>
        <Field label="Categoria"><select value={editing.category || 'other'} onChange={e => setEditing({ ...editing, category: e.target.value as ExpenseCategory })}>{CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
        <Field label="Origine"><input value={editing.source === 'receipt' ? 'Scontrino / OCR' : 'Inserimento manuale'} disabled /></Field>
        <Field label="Note" className="field--wide"><textarea rows={3} value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} placeholder="Facoltative" /></Field>
        {editing.items?.length ? <div className="expense-item-preview field--wide">
          <strong>Articoli rilevati</strong>
          {editing.items.slice(0, 12).map((item: any) => <div key={item.id}><span>{item.name}{item.qty ? ` · ${item.qty} ${item.unit}` : ''}</span><b>{item.totalPrice !== undefined ? money(item.totalPrice) : '—'}</b></div>)}
          {editing.items.length > 12 ? <small>+ altri {editing.items.length - 12} articoli</small> : null}
        </div> : null}
      </div> : null}
    </Modal>
  </div>
}
