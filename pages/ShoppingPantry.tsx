import React, { useMemo, useState } from 'react'
import { Camera, Check, ChevronRight, PackageOpen, Plus, ScanLine, Search, ShoppingBasket, Trash2 } from 'lucide-react'
import { useFamily } from '../store'
import { Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Modal, PageIntro, Segmented } from '../ui'
import { normalize, parseReceiptLines, similarity } from '../utils'

export default function ShoppingPantryPage() {
  const {
    data,
    addShoppingItem,
    toggleShoppingItem,
    deleteShoppingItem,
    moveTakenShoppingToPantry,
    upsertPantryItem,
    deletePantryItem,
    changePantryQty,
    addCategory,
    renameCategory,
    deleteCategory,
    importReceiptItems
  } = useFamily()

  const [tab, setTab] = useState<'shopping' | 'pantry' | 'scan'>('shopping')
  const [shopName, setShopName] = useState('')
  const [shopQty, setShopQty] = useState(1)
  const [shopUnit, setShopUnit] = useState('pz')
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('Tutte')
  const [editingPantry, setEditingPantry] = useState<any>(null)
  const [categoryModal, setCategoryModal] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [renaming, setRenaming] = useState<any>(null)

  const [ocrBusy, setOcrBusy] = useState(false)
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrError, setOcrError] = useState('')
  const [receiptText, setReceiptText] = useState('')
  const [receiptRows, setReceiptRows] = useState<any[]>([])
  const [removeFromShopping, setRemoveFromShopping] = useState(true)

  const pending = data.shopping.filter(x => !x.taken)
  const taken = data.shopping.filter(x => x.taken)

  const pantryFiltered = useMemo(() => {
    const q = normalize(query)
    return data.pantry.filter(item => {
      if (categoryFilter !== 'Tutte' && item.category !== categoryFilter) return false
      if (q && !normalize(item.name).includes(q)) return false
      return true
    }).sort((a, b) => `${a.category}${a.name}`.localeCompare(`${b.category}${b.name}`))
  }, [data.pantry, query, categoryFilter])

  function addQuickShopping() {
    const name = shopName.trim()
    if (!name) return
    addShoppingItem({ name, qty: Math.max(0, Number(shopQty) || 1), unit: shopUnit || 'pz' })
    setShopName('')
    setShopQty(1)
  }

  function openNewPantry() {
    setEditingPantry({ id: undefined, name: '', qty: 1, unit: 'pz', category: data.categories[0] || 'Generico', minQty: 0 })
  }

  function savePantry() {
    if (!editingPantry?.name?.trim()) return
    upsertPantryItem({ ...editingPantry, name: editingPantry.name.trim(), qty: Number(editingPantry.qty) || 0, minQty: Number(editingPantry.minQty) || 0 })
    setEditingPantry(null)
  }

  async function runOcr(file: File) {
    setOcrBusy(true)
    setOcrProgress(0)
    setOcrError('')
    try {
      const mod: any = await import('tesseract.js')
      const T = mod.default || mod
      const res = await T.recognize(file, 'ita', {
        logger: (msg: any) => {
          if (msg?.status === 'recognizing text' && typeof msg.progress === 'number') setOcrProgress(msg.progress)
        }
      })
      const text = res?.data?.text || ''
      if (!text.trim()) throw new Error('empty')
      setReceiptText(text)
      analyzeReceipt(text)
    } catch {
      setOcrError('Non sono riuscito a leggere bene la foto. Puoi incollare il testo dello scontrino nel riquadro e premere “Analizza”.')
    } finally {
      setOcrBusy(false)
    }
  }

  function catalogNames() {
    const names = new Map<string, string>()
    data.pantry.forEach(x => names.set(normalize(x.name), x.name))
    data.shopping.forEach(x => names.set(normalize(x.name), x.name))
    data.dishes.forEach(d => d.ingredients.forEach(x => names.set(normalize(x.name), x.name)))
    return [...names.values()]
  }

  function analyzeReceipt(text = receiptText) {
    const lines = parseReceiptLines(text)
    const catalog = catalogNames()
    const rows = lines.map((raw, index) => {
      const suggestions = catalog
        .map(name => ({ name, score: similarity(raw, name) }))
        .filter(x => x.score >= 0.18)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
      const top = suggestions[0]
      const confident = !!top && top.score >= 0.72
      return {
        id: `${Date.now()}-${index}`,
        raw,
        include: true,
        mode: confident ? 'existing' : 'new',
        name: confident ? top.name : raw,
        qty: 1,
        unit: 'pz',
        category: 'Generico',
        suggestions
      }
    })
    setReceiptRows(rows)
  }

  function importReceipt() {
    const selected = receiptRows.filter(x => x.include && x.name.trim()).map(x => ({
      name: x.name.trim(),
      qty: Math.max(0, Number(x.qty) || 1),
      unit: x.unit || 'pz',
      category: x.category || 'Generico'
    }))
    if (!selected.length) return
    importReceiptItems(selected, removeFromShopping)
    setReceiptRows([])
    setReceiptText('')
    setTab('pantry')
  }

  return (
    <div className="page">
      <PageIntro
        eyebrow="Casa"
        title="Spesa & Dispensa"
        description="Lista spesa, inventario e scontrini in un unico flusso: compri, confermi, aggiorni la dispensa."
        actions={<Button icon={<Plus size={18} />} onClick={() => tab === 'pantry' ? openNewPantry() : setTab('shopping')}>{tab === 'pantry' ? 'Nuovo prodotto' : 'Aggiungi prodotto'}</Button>}
      />

      <div className="page-tabs-wrap">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'shopping', label: `Lista spesa · ${pending.length}` },
            { value: 'pantry', label: `Dispensa · ${data.pantry.length}` },
            { value: 'scan', label: 'Scansiona scontrino' }
          ]}
        />
      </div>

      {tab === 'shopping' ? (
        <div className="shopping-layout">
          <Card className="shopping-compose">
            <CardHeader title="Aggiunta rapida" subtitle="Scrivi, quantità, invio. Fine." />
            <div className="quick-input-row">
              <input
                autoComplete="off"
                value={shopName}
                onChange={e => setShopName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addQuickShopping() }}
                placeholder="Cosa manca?"
              />
              <input type="number" min="0" step="1" value={shopQty} onChange={e => setShopQty(Number(e.target.value))} aria-label="Quantità" />
              <select value={shopUnit} onChange={e => setShopUnit(e.target.value)} aria-label="Unità">
                <option value="pz">pz</option><option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option>
              </select>
              <IconButton label="Aggiungi" onClick={addQuickShopping}><Plus size={20} /></IconButton>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Da comprare"
              subtitle={pending.length ? `${pending.length} ${pending.length === 1 ? 'prodotto' : 'prodotti'} ancora da prendere` : 'Lista completata'}
              action={taken.length ? <Button variant="soft" size="sm" icon={<PackageOpen size={16} />} onClick={moveTakenShoppingToPantry}>Metti {taken.length} in dispensa</Button> : null}
            />
            {data.shopping.length ? (
              <div className="check-list">
                {data.shopping.map(item => (
                  <div key={item.id} className={`check-item ${item.taken ? 'is-done' : ''}`}>
                    <button className="check-item__check" onClick={() => toggleShoppingItem(item.id)} aria-label={item.taken ? 'Segna da comprare' : 'Segna acquistato'}>
                      {item.taken ? <Check size={16} /> : null}
                    </button>
                    <button className="check-item__copy" onClick={() => toggleShoppingItem(item.id)}>
                      <strong>{item.name}</strong><span>{item.qty} {item.unit}</span>
                    </button>
                    <IconButton label="Elimina" onClick={() => deleteShoppingItem(item.id)}><Trash2 size={17} /></IconButton>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={<ShoppingBasket size={30} />} title="Lista vuota" text="Aggiungi ciò che manca oppure importa uno scontrino dopo la spesa." />
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'pantry' ? (
        <div className="pantry-layout">
          <div className="pantry-toolbar">
            <div className="search-box"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Cerca in dispensa…" /></div>
            <div className="chip-scroll">
              {['Tutte', ...data.categories].map(cat => <button key={cat} className={`chip ${categoryFilter === cat ? 'is-active' : ''}`} onClick={() => setCategoryFilter(cat)}>{cat}</button>)}
            </div>
            <Button variant="ghost" onClick={() => setCategoryModal(true)}>Categorie</Button>
          </div>

          {pantryFiltered.length ? (
            <div className="pantry-grid">
              {pantryFiltered.map(item => {
                const low = Number(item.minQty || 0) > 0 && Number(item.qty || 0) <= Number(item.minQty || 0)
                return (
                  <Card key={item.id} className="pantry-item-card" onClick={() => setEditingPantry({ ...item })}>
                    <div className="pantry-item-card__top"><Badge>{item.category}</Badge>{low ? <Badge tone="danger">Da ricomprare</Badge> : null}</div>
                    <strong>{item.name}</strong>
                    <div className="pantry-item-card__qty"><span>{item.qty}</span><small>{item.unit}</small></div>
                    <div className="pantry-item-card__actions" onClick={e => e.stopPropagation()}>
                      <button onClick={() => changePantryQty(item.id, -1)}>−</button>
                      <button onClick={() => changePantryQty(item.id, 1)}>+</button>
                      <IconButton label="Modifica" onClick={() => setEditingPantry({ ...item })}><ChevronRight size={18} /></IconButton>
                    </div>
                  </Card>
                )
              })}
            </div>
          ) : (
            <Card><EmptyState icon={<PackageOpen size={30} />} title="Nessun prodotto" text="Aggiungi il primo articolo oppure importa gli acquisti da uno scontrino." action={<Button onClick={openNewPantry}>Aggiungi prodotto</Button>} /></Card>
          )}
        </div>
      ) : null}

      {tab === 'scan' ? (
        <div className="scan-layout">
          <Card>
            <CardHeader title="1. Leggi lo scontrino" subtitle="Fotocamera su iPhone/Android oppure testo incollato." />
            <label className="receipt-drop">
              <input type="file" accept="image/*" capture="environment" onChange={e => { const file = e.target.files?.[0]; if (file) runOcr(file) }} />
              <Camera size={32} />
              <strong>Scatta o carica una foto</strong>
              <span>Meglio se dritta, nitida e ben illuminata.</span>
            </label>
            {ocrBusy ? <div className="progress-row"><div className="progress-track"><span style={{ width: `${Math.round(ocrProgress * 100)}%` }} /></div><strong>{Math.round(ocrProgress * 100)}%</strong></div> : null}
            {ocrError ? <div className="callout callout--warning">{ocrError}</div> : null}
            <Field label="Testo riconosciuto" hint="Puoi correggerlo prima dell'analisi.">
              <textarea rows={8} value={receiptText} onChange={e => setReceiptText(e.target.value)} placeholder="Incolla qui il testo dello scontrino…" />
            </Field>
            <Button icon={<ScanLine size={18} />} disabled={!receiptText.trim()} onClick={() => analyzeReceipt()}>Analizza prodotti</Button>
          </Card>

          <Card>
            <CardHeader title="2. Verifica associazioni" subtitle="Quando il match non è sicuro, scegli un prodotto esistente oppure creane uno nuovo." />
            {receiptRows.length ? (
              <div className="receipt-matches">
                {receiptRows.map(row => (
                  <div key={row.id} className="receipt-match">
                    <div className="receipt-match__head">
                      <label><input type="checkbox" checked={row.include} onChange={e => setReceiptRows(prev => prev.map(x => x.id === row.id ? { ...x, include: e.target.checked } : x))} /><span>{row.raw}</span></label>
                      {row.mode === 'existing' ? <Badge tone="success">Associato</Badge> : <Badge tone="warning">Da verificare</Badge>}
                    </div>
                    {row.include ? (
                      <div className="receipt-match__grid">
                        <Field label="Associazione">
                          <select value={row.mode} onChange={e => setReceiptRows(prev => prev.map(x => x.id === row.id ? { ...x, mode: e.target.value } : x))}>
                            <option value="existing">Prodotto esistente</option>
                            <option value="new">Crea nuovo prodotto</option>
                          </select>
                        </Field>
                        {row.mode === 'existing' ? (
                          <Field label="Prodotto">
                            <select value={row.name} onChange={e => setReceiptRows(prev => prev.map(x => x.id === row.id ? { ...x, name: e.target.value } : x))}>
                              {row.suggestions.length ? row.suggestions.map((s: any) => <option key={s.name} value={s.name}>{s.name} · {Math.round(s.score * 100)}%</option>) : <option value={row.name}>{row.name}</option>}
                              {catalogNames().filter(n => !row.suggestions.some((s: any) => s.name === n)).map(name => <option key={name} value={name}>{name}</option>)}
                            </select>
                          </Field>
                        ) : (
                          <Field label="Nome nuovo prodotto"><input value={row.name} onChange={e => setReceiptRows(prev => prev.map(x => x.id === row.id ? { ...x, name: e.target.value } : x))} /></Field>
                        )}
                        <Field label="Quantità"><input type="number" min="0" value={row.qty} onChange={e => setReceiptRows(prev => prev.map(x => x.id === row.id ? { ...x, qty: Number(e.target.value) } : x))} /></Field>
                        <Field label="Unità"><select value={row.unit} onChange={e => setReceiptRows(prev => prev.map(x => x.id === row.id ? { ...x, unit: e.target.value } : x))}><option value="pz">pz</option><option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option></select></Field>
                        {row.mode === 'new' ? <Field label="Categoria"><select value={row.category} onChange={e => setReceiptRows(prev => prev.map(x => x.id === row.id ? { ...x, category: e.target.value } : x))}>{data.categories.map(cat => <option key={cat}>{cat}</option>)}</select></Field> : null}
                      </div>
                    ) : null}
                  </div>
                ))}
                <label className="toggle-row"><input type="checkbox" checked={removeFromShopping} onChange={e => setRemoveFromShopping(e.target.checked)} /><span>Se il prodotto era nella lista spesa, rimuovilo automaticamente</span></label>
                <Button icon={<PackageOpen size={18} />} onClick={importReceipt}>Importa in dispensa</Button>
              </div>
            ) : (
              <EmptyState icon={<ScanLine size={30} />} title="In attesa dello scontrino" text="Dopo l'analisi compariranno qui i prodotti da confermare." />
            )}
          </Card>
        </div>
      ) : null}

      <Modal
        open={!!editingPantry}
        onClose={() => setEditingPantry(null)}
        title={editingPantry?.id ? 'Modifica prodotto' : 'Nuovo prodotto in dispensa'}
        footer={<div className="modal-actions"><div>{editingPantry?.id ? <Button variant="danger" icon={<Trash2 size={17} />} onClick={() => { deletePantryItem(editingPantry.id); setEditingPantry(null) }}>Elimina</Button> : null}</div><div className="modal-actions__right"><Button variant="ghost" onClick={() => setEditingPantry(null)}>Annulla</Button><Button onClick={savePantry}>Salva</Button></div></div>}
      >
        {editingPantry ? <div className="form-grid form-grid--2">
          <Field label="Prodotto" className="field--wide"><input autoFocus value={editingPantry.name} onChange={e => setEditingPantry({ ...editingPantry, name: e.target.value })} /></Field>
          <Field label="Quantità"><input type="number" min="0" value={editingPantry.qty} onChange={e => setEditingPantry({ ...editingPantry, qty: Number(e.target.value) })} /></Field>
          <Field label="Unità"><select value={editingPantry.unit} onChange={e => setEditingPantry({ ...editingPantry, unit: e.target.value })}><option value="pz">pz</option><option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option></select></Field>
          <Field label="Categoria"><select value={editingPantry.category} onChange={e => setEditingPantry({ ...editingPantry, category: e.target.value })}>{data.categories.map(cat => <option key={cat}>{cat}</option>)}</select></Field>
          <Field label="Soglia minima" hint="0 = nessun avviso"><input type="number" min="0" value={editingPantry.minQty || 0} onChange={e => setEditingPantry({ ...editingPantry, minQty: Number(e.target.value) })} /></Field>
        </div> : null}
      </Modal>

      <Modal open={categoryModal} onClose={() => setCategoryModal(false)} title="Categorie dispensa" subtitle="Rinomina o elimina senza perdere i prodotti.">
        <div className="category-editor">
          <div className="quick-input-row quick-input-row--category"><input value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="Nuova categoria" /><Button onClick={() => { if (addCategory(newCategory)) setNewCategory('') }}>Aggiungi</Button></div>
          <div className="category-list">
            {data.categories.map(cat => <div key={cat} className="category-row"><span>{cat}</span><div>{cat !== 'Generico' ? <><button onClick={() => setRenaming({ old: cat, value: cat })}>Rinomina</button><button className="danger-link" onClick={() => deleteCategory(cat)}>Elimina</button></> : <Badge>Predefinita</Badge>}</div></div>)}
          </div>
          {renaming ? <div className="rename-box"><Field label={`Rinomina “${renaming.old}”`}><input value={renaming.value} onChange={e => setRenaming({ ...renaming, value: e.target.value })} /></Field><div className="modal-actions__right"><Button variant="ghost" onClick={() => setRenaming(null)}>Annulla</Button><Button onClick={() => { if (renameCategory(renaming.old, renaming.value)) setRenaming(null) }}>Salva</Button></div></div> : null}
        </div>
      </Modal>
    </div>
  )
}
