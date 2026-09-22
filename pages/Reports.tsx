import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Pencil,
  Plus,
  ReceiptText,
  Repeat2,
  ShoppingBasket,
  Store,
  Trash2,
  Upload,
  WalletCards,
  Zap
} from 'lucide-react'
import { useFamily } from '../store'
import { Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Modal, PageIntro, Segmented } from '../ui'
import { localDateISO, money } from '../utils'
import type { ExpenseCategory, ExpenseRecord, RecurringExpenseFrequency } from '../types'
import {
  bankSourceRef,
  bankMerchantSimilarity,
  inferExpenseCategory,
  parseBankAmount,
  parseBankDate,
  readBankFile,
  suggestBankMapping,
  type BankColumnMapping,
  type BankTable
} from '../bankImport'

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

const FREQUENCIES: Array<{ value: RecurringExpenseFrequency; label: string }> = [
  { value: 'weekly', label: 'Ogni settimana' },
  { value: 'monthly', label: 'Ogni mese' },
  { value: 'yearly', label: 'Ogni anno' }
]

function categoryLabel(value: ExpenseCategory) {
  return CATEGORIES.find(item => item.value === value)?.label || 'Altro'
}

function frequencyLabel(value: RecurringExpenseFrequency) {
  return FREQUENCIES.find(item => item.value === value)?.label || 'Ogni mese'
}

function sourceLabel(source: ExpenseRecord['source']) {
  if (source === 'receipt') return 'OCR'
  if (source === 'voice') return 'Voce'
  if (source === 'recurring') return 'Ricorrente'
  if (source === 'bank') return 'Banca'
  return 'Manuale'
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

function cleanMerchant(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 160)
}

type BankDuplicateStatus = 'none' | 'exact' | 'likely' | 'possible'

type BankPreviewRow = {
  id: string
  include: boolean
  date: string
  merchant: string
  total: number
  category: ExpenseCategory
  sourceRef: string
  legacySourceRef: string
  sourceKey: string
  duplicateStatus: BankDuplicateStatus
  duplicateReason?: string
  matchedExpense?: ExpenseRecord
  bankDouble: boolean
  bankDoubleReason?: string
  valid: boolean
}

export default function ReportsPage() {
  const {
    data,
    authUser,
    upsertExpense,
    importExpenses,
    deleteExpense,
    upsertRecurringExpense,
    deleteRecurringExpense,
    materializeRecurringExpenses,
    setActivePage
  } = useFamily()
  const [section, setSection] = useState<'overview' | 'recurring' | 'bank'>('overview')
  const [period, setPeriod] = useState<'month' | 'year'>('month')
  const [cursor, setCursor] = useState(monthKey())
  const [editing, setEditing] = useState<any>(null)
  const [recurringEditing, setRecurringEditing] = useState<any>(null)
  const [quick, setQuick] = useState({ merchant: '', total: '', category: 'other' as ExpenseCategory })
  const [quickMessage, setQuickMessage] = useState('')
  const [bankTable, setBankTable] = useState<BankTable | null>(null)
  const [bankMapping, setBankMapping] = useState<BankColumnMapping>({ date: '', description: '', amount: '', debit: '', credit: '', reference: '' })
  const [bankRows, setBankRows] = useState<BankPreviewRow[]>([])
  const [bankMessage, setBankMessage] = useState('')
  const [bankBusy, setBankBusy] = useState(false)
  const [bankFilter, setBankFilter] = useState<'all' | 'new' | 'review' | 'double'>('all')

  const canEdit = authUser?.role !== 'bimbo'

  function daysBetween(left: string, right: string) {
    const a = new Date(`${left}T12:00:00`).getTime()
    const b = new Date(`${right}T12:00:00`).getTime()
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 999
    return Math.abs(Math.round((a - b) / 86400000))
  }

  function duplicateAssessment(date: string, merchant: string, total: number, sourceRef: string, legacySourceRef: string) {
    const existing = data.expenses || []
    const exact = existing.find(item => item.sourceRef === sourceRef || item.sourceRef === legacySourceRef)
    if (exact) return { status: 'exact' as BankDuplicateStatus, reason: 'Questo movimento bancario risulta già importato.', match: exact }

    let best: { score: number; status: BankDuplicateStatus; reason: string; match: ExpenseRecord } | null = null
    for (const item of existing) {
      if (Math.abs(Number(item.total || 0) - total) > .01) continue
      const days = daysBetween(date, item.date)
      if (days > 3) continue
      const similarity = bankMerchantSimilarity(merchant, item.merchant)
      let status: BankDuplicateStatus = 'none'
      let score = 0
      let reason = ''

      if ((days <= 1 && similarity >= .82) || (days <= 2 && similarity >= .94)) {
        status = 'likely'
        score = 90 + similarity * 9 - days
        reason = `Stesso importo e descrizione molto simile a una spesa già registrata ${days ? `a distanza di ${days} gg` : 'nello stesso giorno'}.`
      } else if ((days === 0 && similarity >= .45) || (days <= 3 && similarity >= .72)) {
        status = 'possible'
        score = 70 + similarity * 10 - days
        reason = `Stesso importo e possibile corrispondenza con una spesa già registrata${days ? ` a distanza di ${days} gg` : ''}.`
      }

      if (status !== 'none' && (!best || score > best.score)) best = { score, status, reason, match: item }
    }

    return best
      ? { status: best.status, reason: best.reason, match: best.match }
      : { status: 'none' as BankDuplicateStatus, reason: '', match: undefined }
  }

  useEffect(() => {
    if (canEdit) materializeRecurringExpenses()
  }, [canEdit, data.recurringExpenses])

  const selectedYear = Number(cursor.slice(0, 4))
  const expenses = useMemo(() => (data.expenses || []).slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)), [data.expenses])
  const filtered = useMemo(() => expenses.filter(item => period === 'month'
    ? item.date.startsWith(cursor)
    : item.date.startsWith(String(selectedYear))
  ), [expenses, period, cursor, selectedYear])

  const stats = useMemo(() => {
    const total = filtered.reduce((sum, item) => sum + Number(item.total || 0), 0)
    const grocery = filtered.filter(item => item.category === 'groceries').reduce((sum, item) => sum + Number(item.total || 0), 0)
    return { total, count: filtered.length, average: filtered.length ? total / filtered.length : 0, grocery }
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
    if (!canEdit) return
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
    if (!canEdit) return
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
      source: editing.source || 'manual',
      sourceRef: editing.sourceRef,
      createdAt: editing.createdAt,
      createdByUserId: editing.createdByUserId,
      notes: editing.notes || '',
      items: Array.isArray(editing.items) ? editing.items : []
    })
    setEditing(null)
  }

  function saveQuickExpense() {
    const total = Number(String(quick.total).replace(',', '.'))
    const merchant = cleanMerchant(quick.merchant)
    if (!merchant || !Number.isFinite(total) || total <= 0) return
    upsertExpense({
      date: localDateISO(),
      merchant,
      total,
      category: quick.category,
      source: 'manual',
      notes: 'Inserimento rapido',
      items: []
    })
    setQuick({ merchant: '', total: '', category: 'other' })
    setQuickMessage(`Registrati ${money(total)} per ${merchant}.`)
    window.setTimeout(() => setQuickMessage(''), 3500)
  }

  function openRecurring(item?: any) {
    if (!canEdit) return
    setRecurringEditing(item ? { ...item } : {
      merchant: '',
      amount: '',
      category: 'bills',
      frequency: 'monthly',
      startDate: localDateISO(),
      endDate: '',
      active: true,
      notes: ''
    })
  }

  function saveRecurring() {
    if (!recurringEditing?.merchant?.trim() || Number(recurringEditing.amount) <= 0 || !recurringEditing.startDate) return
    upsertRecurringExpense({
      id: recurringEditing.id,
      merchant: recurringEditing.merchant.trim(),
      amount: Number(recurringEditing.amount),
      category: recurringEditing.category || 'other',
      frequency: recurringEditing.frequency || 'monthly',
      startDate: recurringEditing.startDate,
      endDate: recurringEditing.endDate || undefined,
      active: recurringEditing.active !== false,
      notes: recurringEditing.notes || '',
      createdAt: recurringEditing.createdAt,
      createdByUserId: recurringEditing.createdByUserId
    })
    setRecurringEditing(null)
    window.setTimeout(() => materializeRecurringExpenses(), 0)
  }

  function indexOfHeader(header: string) {
    return bankTable ? bankTable.headers.indexOf(header) : -1
  }

  function buildBankPreview(table: BankTable, mapping: BankColumnMapping) {
    if (!mapping.date || !mapping.description || (!mapping.amount && !mapping.debit)) {
      setBankRows([])
      return
    }
    const dateIndex = table.headers.indexOf(mapping.date)
    const descriptionIndex = table.headers.indexOf(mapping.description)
    const amountIndex = mapping.amount ? table.headers.indexOf(mapping.amount) : -1
    const debitIndex = mapping.debit ? table.headers.indexOf(mapping.debit) : -1
    const creditIndex = mapping.credit ? table.headers.indexOf(mapping.credit) : -1
    const referenceIndex = mapping.reference ? table.headers.indexOf(mapping.reference) : -1

    const rawAmounts = table.rows.slice(0, 250).map(row => amountIndex >= 0 ? parseBankAmount(row[amountIndex]) : undefined).filter((value): value is number => value !== undefined)
    const negativeAmountMode = amountIndex >= 0 && rawAmounts.some(value => value < 0)
    const occurrenceBySignature = new Map<string, number>()

    const rows: BankPreviewRow[] = table.rows.slice(0, 1500).map((row, index) => {
      const date = parseBankDate(row[dateIndex])
      const merchant = cleanMerchant(row[descriptionIndex]) || 'Movimento bancario'
      let rawAmount: number | undefined
      if (debitIndex >= 0) rawAmount = parseBankAmount(row[debitIndex])
      else rawAmount = amountIndex >= 0 ? parseBankAmount(row[amountIndex]) : undefined
      const credit = creditIndex >= 0 ? parseBankAmount(row[creditIndex]) : undefined

      let isExpense = false
      let total = 0
      if (debitIndex >= 0) {
        total = Math.abs(Number(rawAmount || 0))
        isExpense = total > 0
      } else if (rawAmount !== undefined) {
        total = Math.abs(rawAmount)
        isExpense = negativeAmountMode ? rawAmount < 0 : rawAmount > 0
        if (credit !== undefined && credit > 0) isExpense = false
      }

      const valid = !!date && !!merchant && total > 0
      const rawReference = referenceIndex >= 0 ? cleanMerchant(row[referenceIndex]) : ''
      const signatureBase = rawReference || row.map(value => String(value || '').trim()).join('|')
      const occurrence = (occurrenceBySignature.get(signatureBase) || 0) + 1
      occurrenceBySignature.set(signatureBase, occurrence)
      const sourceKey = `${signatureBase}|occ:${occurrence}`
      const sourceRef = valid ? bankSourceRef(date, merchant, total, sourceKey) : `invalid-${index}`
      const legacySourceRef = valid ? bankSourceRef(date, merchant, total) : `invalid-legacy-${index}`
      const assessment = valid ? duplicateAssessment(date, merchant, total, sourceRef, legacySourceRef) : { status: 'none' as BankDuplicateStatus, reason: '', match: undefined }

      return {
        id: `bank-${index}`,
        include: valid && isExpense && assessment.status === 'none',
        date,
        merchant,
        total,
        category: inferExpenseCategory(merchant),
        sourceRef,
        legacySourceRef,
        sourceKey,
        duplicateStatus: assessment.status,
        duplicateReason: assessment.reason,
        matchedExpense: assessment.match,
        bankDouble: false,
        valid: valid && isExpense
      }
    }).filter(row => row.valid)

    const indexesByAmount = new Map<string, number[]>()
    rows.forEach((row, index) => {
      const key = row.total.toFixed(2)
      const candidates = indexesByAmount.get(key) || []
      for (const previousIndex of candidates) {
        const previous = rows[previousIndex]
        const days = daysBetween(row.date, previous.date)
        const similarity = bankMerchantSimilarity(row.merchant, previous.merchant)
        if (days <= 1 && similarity >= .82) {
          const reason = `Nel file bancario c’è un altro addebito di ${money(row.total)} con descrizione simile ${days ? 'a un giorno di distanza' : 'nello stesso giorno'}.`
          row.bankDouble = true
          row.bankDoubleReason = reason
          previous.bankDouble = true
          previous.bankDoubleReason = reason
        }
      }
      candidates.push(index)
      indexesByAmount.set(key, candidates)
    })

    setBankRows(rows)
    setBankFilter('all')
  }

  function updateBankMapping(patch: Partial<BankColumnMapping>) {
    if (!bankTable) return
    const next = { ...bankMapping, ...patch }
    if (patch.amount) next.debit = ''
    if (patch.debit) next.amount = ''
    setBankMapping(next)
    buildBankPreview(bankTable, next)
  }

  async function selectBankFile(file: File) {
    setBankBusy(true)
    setBankMessage('')
    setBankRows([])
    try {
      const table = await readBankFile(file)
      const mapping = suggestBankMapping(table.headers)
      setBankTable(table)
      setBankMapping(mapping)
      buildBankPreview(table, mapping)
      setBankMessage(`${table.rows.length} righe lette da ${file.name}. Verifica le colonne e i movimenti prima di importare.`)
    } catch (error: any) {
      setBankTable(null)
      setBankMessage(error?.message || 'Non riesco a leggere questo file.')
    } finally {
      setBankBusy(false)
    }
  }

  function importBankRows() {
    const selected = bankRows.filter(row => row.include && row.valid && row.duplicateStatus !== 'exact')
    if (!selected.length) return
    const reviewCount = selected.filter(row => row.duplicateStatus === 'likely' || row.duplicateStatus === 'possible').length
    if (reviewCount && !window.confirm(`${reviewCount} movimenti selezionati risultano simili a spese già registrate. Vuoi importarli comunque?`)) return
    const result = importExpenses(selected.map(row => ({
      date: row.date,
      merchant: row.merchant,
      total: row.total,
      category: row.category,
      source: 'bank' as const,
      sourceRef: row.sourceRef,
      notes: [
        bankTable ? `Importato da ${bankTable.fileName}` : 'Importato da estratto conto',
        row.bankDouble ? 'Possibile doppio addebito rilevato nel file bancario' : ''
      ].filter(Boolean).join(' · '),
      items: []
    })))
    setBankMessage(`Importate ${result.imported} spese${result.duplicates ? `; ${result.duplicates} movimenti già importati ignorati` : ''}.`)
    setBankRows(prev => prev.map(row => selected.some(item => item.id === row.id) ? { ...row, include: false, duplicateStatus: 'exact', duplicateReason: 'Movimento appena importato.' } : row))
  }

  const bankSummary = useMemo(() => ({
    new: bankRows.filter(row => row.duplicateStatus === 'none').length,
    exact: bankRows.filter(row => row.duplicateStatus === 'exact').length,
    review: bankRows.filter(row => row.duplicateStatus === 'likely' || row.duplicateStatus === 'possible').length,
    double: bankRows.filter(row => row.bankDouble).length
  }), [bankRows])

  const visibleBankRows = useMemo(() => bankRows.filter(row => {
    if (bankFilter === 'new') return row.duplicateStatus === 'none'
    if (bankFilter === 'review') return row.duplicateStatus === 'likely' || row.duplicateStatus === 'possible' || row.duplicateStatus === 'exact'
    if (bankFilter === 'double') return row.bankDouble
    return true
  }), [bankRows, bankFilter])

  const periodTitle = period === 'month' ? monthLabel(cursor) : String(selectedYear)

  return <div className="page page--reports">
    <PageIntro
      eyebrow="Analisi famiglia"
      title="Report"
      description="Spese, scontrini, ricorrenze e movimenti bancari raccolti in un unico riepilogo."
      actions={canEdit && section === 'overview' ? <Button icon={<Plus size={18} />} onClick={openNew}>Nuova spesa</Button> : null}
    />

    <div className="report-section-tabs">
      <Segmented value={section} onChange={setSection} options={[
        { value: 'overview', label: 'Panoramica' },
        { value: 'recurring', label: 'Ricorrenti' },
        { value: 'bank', label: 'Importa banca' }
      ]} />
    </div>

    {section === 'overview' ? <>
      {canEdit ? <Card className="report-quick-card">
        <div className="report-quick-card__head"><Zap size={19} /><div><strong>Spesa rapida</strong><span>Per le piccole spese senza scontrino. Puoi anche dirlo a Verdo con la voce.</span></div></div>
        <div className="report-quick-form">
          <Field label="Importo €"><input inputMode="decimal" value={quick.total} onChange={e => setQuick({ ...quick, total: e.target.value })} placeholder="0,00" /></Field>
          <Field label="Dove / causale"><input value={quick.merchant} onChange={e => setQuick({ ...quick, merchant: e.target.value, category: quick.category === 'other' ? inferExpenseCategory(e.target.value) : quick.category })} onKeyDown={e => { if (e.key === 'Enter') saveQuickExpense() }} placeholder="Es. benzina Q8" /></Field>
          <Field label="Categoria"><select value={quick.category} onChange={e => setQuick({ ...quick, category: e.target.value as ExpenseCategory })}>{CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
          <Button icon={<Plus size={17} />} onClick={saveQuickExpense} disabled={!quick.merchant.trim() || Number(String(quick.total).replace(',', '.')) <= 0}>Registra</Button>
        </div>
        {quickMessage ? <div className="report-quick-success"><CheckCircle2 size={15} />{quickMessage}</div> : null}
      </Card> : null}

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
          </div> : <EmptyState title="Nessuna spesa nel periodo" text="Scontrini, banca e spese manuali compariranno qui." />}
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
              <span>{categoryLabel(item.category)} · {sourceLabel(item.source)}{item.items.length ? ` · ${item.items.length} articoli` : ''}</span>
              {item.notes ? <small>{item.notes}</small> : null}
            </div>
            <div className="expense-row__amount"><strong>{money(item.total)}</strong><Badge tone={item.source === 'receipt' || item.source === 'bank' ? 'success' : undefined}>{sourceLabel(item.source)}</Badge></div>
            {canEdit ? <div className="expense-row__actions">
              <IconButton label="Modifica" onClick={() => openEdit(item)}><Pencil size={16} /></IconButton>
              <IconButton label="Elimina" onClick={() => void deleteExpense(item.id)}><Trash2 size={16} /></IconButton>
            </div> : null}
          </div>)}
        </div> : <EmptyState icon={<ReceiptText size={30} />} title="Ancora nessuna spesa" text="Carica uno scontrino, importa la banca o registra una spesa rapida." action={canEdit ? <Button onClick={openNew}>Registra spesa</Button> : undefined} />}
      </Card>
    </> : null}

    {section === 'recurring' ? <Card>
      <CardHeader
        title="Spese ricorrenti"
        subtitle="Registra una volta bollette, abbonamenti e costi fissi: VerdoFamily genera automaticamente le occorrenze dovute."
        action={canEdit ? <Button size="sm" icon={<Plus size={16} />} onClick={() => openRecurring()}>Nuova ricorrenza</Button> : null}
      />
      {(data.recurringExpenses || []).length ? <div className="recurring-expense-list">
        {data.recurringExpenses.map(item => <div key={item.id} className="recurring-expense-row">
          <span className="recurring-expense-row__icon"><Repeat2 size={18} /></span>
          <div>
            <strong>{item.merchant}</strong>
            <span>{frequencyLabel(item.frequency)} · dal {item.startDate.split('-').reverse().join('/')}{item.endDate ? ` al ${item.endDate.split('-').reverse().join('/')}` : ''}</span>
            <small>{categoryLabel(item.category)}{item.notes ? ` · ${item.notes}` : ''}</small>
          </div>
          <div className="recurring-expense-row__amount"><strong>{money(item.amount)}</strong><Badge tone={item.active ? 'success' : 'warning'}>{item.active ? 'Attiva' : 'Pausa'}</Badge></div>
          {canEdit ? <div className="expense-row__actions">
            <IconButton label="Modifica" onClick={() => openRecurring(item)}><Pencil size={16} /></IconButton>
            <IconButton label="Elimina" onClick={() => void deleteRecurringExpense(item.id)}><Trash2 size={16} /></IconButton>
          </div> : null}
        </div>)}
      </div> : <EmptyState icon={<Repeat2 size={30} />} title="Nessuna spesa ricorrente" text="Aggiungi affitto, abbonamenti, assicurazioni, bollette fisse o altre uscite periodiche." action={canEdit ? <Button onClick={() => openRecurring()}>Crea la prima</Button> : undefined} />}
    </Card> : null}

    {section === 'bank' ? <div className="report-bank-layout">
      <Card>
        <CardHeader title="Importa estratto conto" subtitle="CSV o Excel (.xlsx). Il file viene letto sul dispositivo e non viene caricato su servizi esterni." />
        <label className="bank-file-drop">
          <input type="file" accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={e => { const file = e.target.files?.[0]; if (file) void selectBankFile(file); e.currentTarget.value = '' }} />
          <FileSpreadsheet size={28} />
          <strong>{bankBusy ? 'Sto leggendo il file…' : 'Scegli CSV o Excel'}</strong>
          <span>VerdoFamily proverà a riconoscere automaticamente data, descrizione e importo.</span>
        </label>
        {bankMessage ? <div className="bank-import-message">{bankMessage}</div> : null}

        {bankTable ? <div className="bank-mapping">
          <div className="bank-mapping__head"><strong>Abbina le colonne</strong><span>Correggi solo se il riconoscimento automatico non è giusto.</span></div>
          <div className="form-grid form-grid--2">
            <Field label="Data"><select value={bankMapping.date} onChange={e => updateBankMapping({ date: e.target.value })}><option value="">Seleziona…</option>{bankTable.headers.map(h => <option key={h}>{h}</option>)}</select></Field>
            <Field label="Descrizione / causale"><select value={bankMapping.description} onChange={e => updateBankMapping({ description: e.target.value })}><option value="">Seleziona…</option>{bankTable.headers.map(h => <option key={h}>{h}</option>)}</select></Field>
            <Field label="Importo unico" hint="Usalo se il file ha una sola colonna importo."><select value={bankMapping.amount} onChange={e => updateBankMapping({ amount: e.target.value })}><option value="">Nessuna</option>{bankTable.headers.map(h => <option key={h}>{h}</option>)}</select></Field>
            <Field label="Oppure colonna addebiti" hint="Per file con addebiti e accrediti separati."><select value={bankMapping.debit} onChange={e => updateBankMapping({ debit: e.target.value })}><option value="">Nessuna</option>{bankTable.headers.map(h => <option key={h}>{h}</option>)}</select></Field>
            <Field label="Colonna accrediti" hint="Facoltativa: serve a escludere le entrate."><select value={bankMapping.credit} onChange={e => updateBankMapping({ credit: e.target.value })}><option value="">Nessuna</option>{bankTable.headers.map(h => <option key={h}>{h}</option>)}</select></Field>
            <Field label="ID / riferimento operazione" hint="Se presente, rende ancora più preciso il riconoscimento dei movimenti già importati."><select value={bankMapping.reference} onChange={e => updateBankMapping({ reference: e.target.value })}><option value="">Nessuno</option>{bankTable.headers.map(h => <option key={h}>{h}</option>)}</select></Field>
          </div>
        </div> : null}
      </Card>

      {bankTable ? <Card>
        <CardHeader
          title="Anteprima e controllo doppioni"
          subtitle={bankRows.length ? `${bankRows.filter(row => row.include).length} selezionati · ${bankSummary.exact} già importati · ${bankSummary.review} da verificare` : 'Completa l’abbinamento delle colonne'}
          action={bankRows.some(row => row.include) ? <Button size="sm" icon={<Upload size={16} />} onClick={importBankRows}>Importa selezionati</Button> : null}
        />
        {bankRows.length ? <>
          <div className="bank-analysis-grid">
            <button type="button" className={bankFilter === 'new' ? 'is-active' : ''} onClick={() => setBankFilter(bankFilter === 'new' ? 'all' : 'new')}><span>Nuovi</span><strong>{bankSummary.new}</strong><small>non trovati nei Report</small></button>
            <button type="button" className={bankFilter === 'review' ? 'is-active' : ''} onClick={() => setBankFilter(bankFilter === 'review' ? 'all' : 'review')}><span>Da verificare</span><strong>{bankSummary.review}</strong><small>somigliano a spese esistenti</small></button>
            <button type="button" className={bankFilter === 'double' ? 'is-active' : ''} onClick={() => setBankFilter(bankFilter === 'double' ? 'all' : 'double')}><span>Possibili doppi pagamenti</span><strong>{bankSummary.double}</strong><small>due addebiti simili in banca</small></button>
            <button type="button" className={bankFilter === 'all' ? 'is-active' : ''} onClick={() => setBankFilter('all')}><span>Già importati</span><strong>{bankSummary.exact}</strong><small>esclusi automaticamente</small></button>
          </div>

          <div className="bank-duplicate-legend">
            <span><i className="is-archive" /> Già nei Report = non viene reimportato</span>
            <span><i className="is-review" /> Simile a una spesa esistente = controlla tu</span>
            <span><i className="is-double" /> Doppio in banca = può essere un vero doppio pagamento e resta importabile</span>
          </div>

          <div className="bank-preview-list">
            {visibleBankRows.slice(0, 500).map(row => <div key={row.id} className={`bank-preview-row ${row.duplicateStatus === 'exact' ? 'is-duplicate' : ''} ${row.duplicateStatus === 'likely' || row.duplicateStatus === 'possible' ? 'is-review' : ''} ${row.bankDouble ? 'is-bank-double' : ''}`}>
              <input type="checkbox" checked={row.include} disabled={row.duplicateStatus === 'exact'} onChange={e => setBankRows(prev => prev.map(item => item.id === row.id ? { ...item, include: e.target.checked } : item))} />
              <input type="date" value={row.date} onChange={e => setBankRows(prev => prev.map(item => item.id === row.id ? { ...item, date: e.target.value, sourceRef: bankSourceRef(e.target.value, item.merchant, item.total, item.sourceKey), legacySourceRef: bankSourceRef(e.target.value, item.merchant, item.total) } : item))} />
              <div className="bank-preview-row__merchant">
                <strong>{row.merchant}</strong>
                {row.duplicateStatus === 'exact' ? <span className="bank-match bank-match--archive"><CheckCircle2 size={13} />Già importato</span> : null}
                {row.duplicateStatus === 'likely' || row.duplicateStatus === 'possible' ? <span className="bank-match bank-match--review"><AlertTriangle size={13} />{row.duplicateStatus === 'likely' ? 'Probabile doppione nei Report' : 'Possibile doppione nei Report'}{row.matchedExpense ? ` · ${row.matchedExpense.merchant} · ${row.matchedExpense.date.split('-').reverse().join('/')} · ${sourceLabel(row.matchedExpense.source)}` : ''}</span> : null}
                {row.bankDouble ? <span className="bank-match bank-match--double"><AlertTriangle size={13} />Possibile doppio pagamento bancario</span> : null}
                {row.duplicateReason ? <small>{row.duplicateReason}</small> : row.bankDoubleReason ? <small>{row.bankDoubleReason}</small> : null}
              </div>
              <strong className="bank-preview-row__amount">{money(row.total)}</strong>
              <select value={row.category} onChange={e => setBankRows(prev => prev.map(item => item.id === row.id ? { ...item, category: e.target.value as ExpenseCategory } : item))}>{CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
            </div>)}
            {visibleBankRows.length > 500 ? <div className="bank-preview-more">Mostro le prime 500 righe del filtro corrente. Le altre verranno comunque considerate dall’importazione.</div> : null}
          </div>
        </> : <EmptyState icon={<FileSpreadsheet size={30} />} title="Mappa le colonne" text="Servono almeno Data, Descrizione e Importo oppure Addebiti." />}
      </Card> : null}
    </div> : null}

    <Modal
      open={!!editing}
      onClose={() => setEditing(null)}
      title={editing?.id ? 'Modifica spesa' : 'Nuova spesa'}
      subtitle={editing?.source === 'receipt' ? 'Generata da uno scontrino.' : editing?.source === 'bank' ? 'Importata dalla banca.' : 'Inserimento manuale'}
      footer={<div className="modal-actions"><span /><div className="modal-actions__right"><Button variant="ghost" onClick={() => setEditing(null)}>Annulla</Button><Button onClick={save} disabled={!editing?.merchant?.trim() || Number(editing?.total) <= 0}>Salva</Button></div></div>}
    >
      {editing ? <div className="form-grid form-grid--2">
        <Field label="Data"><input type="date" value={editing.date || ''} onChange={e => setEditing({ ...editing, date: e.target.value })} /></Field>
        <Field label="Importo"><input type="number" min="0" step="0.01" value={editing.total} onChange={e => setEditing({ ...editing, total: e.target.value })} /></Field>
        <Field label="Negozio / fornitore" className="field--wide"><input autoFocus value={editing.merchant || ''} onChange={e => setEditing({ ...editing, merchant: e.target.value })} placeholder="Es. Conad, farmacia, Enel…" /></Field>
        <Field label="Categoria"><select value={editing.category || 'other'} onChange={e => setEditing({ ...editing, category: e.target.value as ExpenseCategory })}>{CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
        <Field label="Origine"><input value={sourceLabel(editing.source || 'manual')} disabled /></Field>
        <Field label="Note" className="field--wide"><textarea rows={3} value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} placeholder="Facoltative" /></Field>
        {editing.items?.length ? <div className="expense-item-preview field--wide">
          <strong>Articoli rilevati</strong>
          {editing.items.slice(0, 12).map((item: any) => <div key={item.id}><span>{item.name}{item.qty ? ` · ${item.qty} ${item.unit}` : ''}</span><b>{item.totalPrice !== undefined ? money(item.totalPrice) : '—'}</b></div>)}
          {editing.items.length > 12 ? <small>+ altri {editing.items.length - 12} articoli</small> : null}
        </div> : null}
      </div> : null}
    </Modal>

    <Modal
      open={!!recurringEditing}
      onClose={() => setRecurringEditing(null)}
      title={recurringEditing?.id ? 'Modifica spesa ricorrente' : 'Nuova spesa ricorrente'}
      subtitle="Le occorrenze dovute vengono aggiunte automaticamente ai Report senza creare duplicati."
      footer={<div className="modal-actions"><span /><div className="modal-actions__right"><Button variant="ghost" onClick={() => setRecurringEditing(null)}>Annulla</Button><Button onClick={saveRecurring} disabled={!recurringEditing?.merchant?.trim() || Number(recurringEditing?.amount) <= 0}>Salva</Button></div></div>}
    >
      {recurringEditing ? <div className="form-grid form-grid--2">
        <Field label="Voce / fornitore" className="field--wide"><input autoFocus value={recurringEditing.merchant || ''} onChange={e => setRecurringEditing({ ...recurringEditing, merchant: e.target.value, category: recurringEditing.category === 'other' ? inferExpenseCategory(e.target.value) : recurringEditing.category })} placeholder="Es. Netflix, affitto, assicurazione…" /></Field>
        <Field label="Importo €"><input type="number" min="0" step="0.01" value={recurringEditing.amount} onChange={e => setRecurringEditing({ ...recurringEditing, amount: e.target.value })} /></Field>
        <Field label="Frequenza"><select value={recurringEditing.frequency} onChange={e => setRecurringEditing({ ...recurringEditing, frequency: e.target.value })}>{FREQUENCIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
        <Field label="Dal"><input type="date" value={recurringEditing.startDate} onChange={e => setRecurringEditing({ ...recurringEditing, startDate: e.target.value })} /></Field>
        <Field label="Fino al" hint="Facoltativo"><input type="date" min={recurringEditing.startDate} value={recurringEditing.endDate || ''} onChange={e => setRecurringEditing({ ...recurringEditing, endDate: e.target.value })} /></Field>
        <Field label="Categoria"><select value={recurringEditing.category} onChange={e => setRecurringEditing({ ...recurringEditing, category: e.target.value })}>{CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
        <Field label="Stato"><select value={recurringEditing.active === false ? 'paused' : 'active'} onChange={e => setRecurringEditing({ ...recurringEditing, active: e.target.value === 'active' })}><option value="active">Attiva</option><option value="paused">In pausa</option></select></Field>
        <Field label="Note" className="field--wide"><textarea rows={3} value={recurringEditing.notes || ''} onChange={e => setRecurringEditing({ ...recurringEditing, notes: e.target.value })} /></Field>
      </div> : null}
    </Modal>
  </div>
}
