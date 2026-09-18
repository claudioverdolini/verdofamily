import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Camera, Check, ChevronRight, PackageOpen, Plus, Refrigerator, ScanLine, Search, ShoppingBasket, Snowflake, Sparkles, Trash2, Upload } from 'lucide-react'
import { useFamily } from '../store'
import { Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Modal, PageIntro, Segmented } from '../ui'
import { localDateISO, normalize, pantryAverageDailyUse, pantryDaysRemaining, pantryExpiryDays, pantryNeedsRestock, parseReceiptLines, similarity } from '../utils'
import type { PantryLocation } from '../types'
import { supabase } from '../supabaseClient'

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
    importReceiptItems,
    cloudAuthenticated,
    familyId
  } = useFamily()

  const [tab, setTab] = useState<'shopping' | 'pantry' | 'insights' | 'scan'>('shopping')
  const [shopName, setShopName] = useState('')
  const [shopQty, setShopQty] = useState(1)
  const [shopUnit, setShopUnit] = useState('pz')
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('Tutte')
  const [locationFilter, setLocationFilter] = useState<'all' | PantryLocation>('all')
  const [inventoryDestination, setInventoryDestination] = useState<PantryLocation>('pantry')
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

  const [scanMode, setScanMode] = useState<'receipt' | 'pantry-photo'>('receipt')
  const [visionStatus, setVisionStatus] = useState<{ configured: boolean; model?: string | null } | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [photoPreview, setPhotoPreview] = useState('')
  const [photoPayload, setPhotoPayload] = useState<{ imageData: string; mimeType: string } | null>(null)
  const [photoRows, setPhotoRows] = useState<any[]>([])

  useEffect(() => {
    if (scanMode !== 'pantry-photo' || !cloudAuthenticated || !familyId || !supabase) return
    void refreshVisionStatus()
  }, [scanMode, cloudAuthenticated, familyId])

  async function callPantryVision(action: string, extra: Record<string, any> = {}) {
    if (!supabase || !familyId) throw new Error('Cloud non disponibile.')
    const { data: result, error } = await supabase.functions.invoke('pantry-photo-recognition', { body: { action, familyId, ...extra } })
    if (error) {
      let detail = ''
      try {
        const payload = await (error as any)?.context?.json?.()
        detail = String(payload?.error || payload?.message || '')
      } catch {}
      throw new Error(detail || error.message || 'Riconoscimento fotografico non disponibile.')
    }
    if (result?.error) throw new Error(result.error)
    return result
  }

  async function refreshVisionStatus() {
    try {
      const result = await callPantryVision('status')
      setVisionStatus({ configured: !!result?.configured, model: result?.model || null })
    } catch {
      setVisionStatus({ configured: false })
    }
  }

  function readFileAsDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('Impossibile leggere la foto.'))
      reader.readAsDataURL(file)
    })
  }

  async function preparePantryPhoto(file: File) {
    if (!file.type.startsWith('image/')) throw new Error('Seleziona una foto valida.')
    const original = await readFileAsDataUrl(file)
    const supportedRaw = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(file.type.toLowerCase())

    // Keep small files untouched; for normal phone photos resize to reduce latency/data usage.
    if (file.size <= 2_800_000 && supportedRaw) {
      return { preview: original, imageData: original.split(',')[1] || '', mimeType: file.type.toLowerCase() }
    }

    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('decode'))
        img.src = original
      })
      const maxSide = 1600
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height))
      const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale))
      const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas')
      ctx.drawImage(image, 0, 0, width, height)
      const compressed = canvas.toDataURL('image/jpeg', .82)
      return { preview: compressed, imageData: compressed.split(',')[1] || '', mimeType: 'image/jpeg' }
    } catch {
      if (!supportedRaw || file.size > 8_500_000) throw new Error('La foto è troppo grande o in un formato non supportato. Prova con JPG/PNG oppure riduci la dimensione.')
      return { preview: original, imageData: original.split(',')[1] || '', mimeType: file.type.toLowerCase() }
    }
  }

  async function selectPantryPhoto(file: File) {
    setPhotoError('')
    setPhotoRows([])
    try {
      const prepared = await preparePantryPhoto(file)
      setPhotoPreview(prepared.preview)
      setPhotoPayload({ imageData: prepared.imageData, mimeType: prepared.mimeType })
    } catch (error: any) {
      setPhotoPreview('')
      setPhotoPayload(null)
      setPhotoError(error?.message || 'Non riesco a preparare questa foto.')
    }
  }

  function clearPantryPhoto() {
    setPhotoBusy(false)
    setPhotoError('')
    setPhotoRows([])
    setPhotoPreview('')
    setPhotoPayload(null)
  }

  async function analyzePantryPhoto() {
    if (!photoPayload) return
    setPhotoBusy(true)
    setPhotoError('')
    try {
      const result = await callPantryVision('analyze', photoPayload)
      const catalog = catalogNames()
      const rows = (result?.items || []).map((item: any, index: number) => {
        const exact = item.matchName && catalog.some(name => normalize(name) === normalize(item.matchName))
          ? catalog.find(name => normalize(name) === normalize(item.matchName))
          : ''
        const searchText = `${item.detectedName || ''} ${item.observedText || ''}`.trim()
        const suggestions = catalog
          .map(name => ({ name, score: similarity(searchText, name) }))
          .filter(x => x.score >= .16)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
        const top = suggestions[0]
        const confidentExisting = !!exact || (!!top && top.score >= .78)
        const chosenName = exact || (confidentExisting ? top.name : String(item.detectedName || '').trim())
        const category = data.categories.includes(item.category) ? item.category : 'Generico'
        return {
          id: `photo-${Date.now()}-${index}`,
          raw: String(item.detectedName || '').trim(),
          observedText: String(item.observedText || '').trim(),
          notes: String(item.notes || '').trim(),
          confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
          include: true,
          mode: confidentExisting ? 'existing' : 'new',
          name: chosenName,
          qty: Math.max(1, Number(item.qty) || 1),
          unit: item.unit || 'pz',
          category,
          suggestions
        }
      }).filter((row: any) => row.raw)
      setPhotoRows(rows)
      if (!rows.length) setPhotoError('Non ho riconosciuto prodotti con sufficiente affidabilità. Prova una foto più vicina e ben illuminata.')
    } catch (error: any) {
      const raw = error?.message || 'errore sconosciuto'
      setPhotoError(raw.includes('vision_not_configured') ? 'Il riconoscimento fotografico deve ancora essere attivato nelle impostazioni cloud.' : `Analisi non riuscita: ${raw}`)
    } finally {
      setPhotoBusy(false)
    }
  }

  function importPhotoRecognition() {
    const selected = photoRows.filter(x => x.include && x.name.trim()).map(x => ({
      name: x.name.trim(),
      qty: Math.max(1, Number(x.qty) || 1),
      unit: x.unit || 'pz',
      category: x.category || 'Generico',
      location: inventoryDestination,
      expiryDate: x.expiryDate || undefined
    }))
    if (!selected.length) return
    importReceiptItems(selected, removeFromShopping, inventoryDestination)
    setPhotoRows([])
    setPhotoPreview('')
    setPhotoPayload(null)
    setTab('pantry')
  }

  const pending = data.shopping.filter(x => !x.taken)
  const taken = data.shopping.filter(x => x.taken)

  const pantryFiltered = useMemo(() => {
    const q = normalize(query)
    return data.pantry.filter(item => {
      if (categoryFilter !== 'Tutte' && item.category !== categoryFilter) return false
      if (locationFilter !== 'all' && (item.location || 'pantry') !== locationFilter) return false
      if (q && !normalize(item.name).includes(q)) return false
      return true
    }).sort((a, b) => `${a.location || 'pantry'}${a.category}${a.name}`.localeCompare(`${b.location || 'pantry'}${b.category}${b.name}`))
  }, [data.pantry, query, categoryFilter, locationFilter])

  const inventoryStatus = useMemo(() => data.pantry.map(item => {
    const averageDailyUse = pantryAverageDailyUse(item.id, data.pantryMovements)
    const daysRemaining = pantryDaysRemaining(item, data.pantryMovements)
    const expiryDays = pantryExpiryDays(item)
    const needsRestock = pantryNeedsRestock(item, data.pantryMovements)
    return { item, averageDailyUse, daysRemaining, expiryDays, needsRestock }
  }), [data.pantry, data.pantryMovements])

  const restockSuggestions = inventoryStatus
    .filter(entry => entry.needsRestock)
    .sort((a, b) => (a.daysRemaining ?? 9999) - (b.daysRemaining ?? 9999))

  const expiringSoon = inventoryStatus
    .filter(entry => entry.expiryDays !== null && entry.expiryDays <= 7)
    .sort((a, b) => Number(a.expiryDays) - Number(b.expiryDays))

  const locations = {
    pantry: data.pantry.filter(item => (item.location || 'pantry') === 'pantry').length,
    fridge: data.pantry.filter(item => item.location === 'fridge').length,
    freezer: data.pantry.filter(item => item.location === 'freezer').length
  }

  function addQuickShopping() {
    const name = shopName.trim()
    if (!name) return
    addShoppingItem({ name, qty: Math.max(0, Number(shopQty) || 1), unit: shopUnit || 'pz' })
    setShopName('')
    setShopQty(1)
  }

  function openNewPantry() {
    setEditingPantry({ id: undefined, name: '', qty: 1, unit: 'pz', category: data.categories[0] || 'Generico', minQty: 0, location: locationFilter === 'all' ? 'pantry' : locationFilter, expiryDate: '', autoRestock: true })
  }

  function savePantry() {
    if (!editingPantry?.name?.trim()) return
    upsertPantryItem({ ...editingPantry, name: editingPantry.name.trim(), qty: Number(editingPantry.qty) || 0, minQty: Number(editingPantry.minQty) || 0, location: editingPantry.location || 'pantry', expiryDate: editingPantry.expiryDate || undefined, autoRestock: editingPantry.autoRestock !== false })
    setEditingPantry(null)
  }

  function locationLabel(location?: PantryLocation) {
    if (location === 'fridge') return 'Frigo'
    if (location === 'freezer') return 'Freezer'
    return 'Dispensa'
  }

  function suggestedBuyQty(item: any, daysRemaining: number | null) {
    const minGap = Math.max(0, Number(item.minQty || 0) - Number(item.qty || 0))
    const average = pantryAverageDailyUse(item.id, data.pantryMovements)
    const weekGap = average > 0 ? Math.max(0, Math.ceil((average * 7) - Number(item.qty || 0))) : 0
    return Math.max(1, minGap, weekGap)
  }

  function addRestockSuggestion(item: any, daysRemaining: number | null) {
    const exists = data.shopping.some(row => !row.taken && normalize(row.name) === normalize(item.name))
    if (exists) return
    addShoppingItem({
      name: item.name,
      qty: suggestedBuyQty(item, daysRemaining),
      unit: item.unit || 'pz',
      category: item.category || 'Generico'
    })
  }

  function looksLikeReceiptText(text: string) {
    const clean = text.replace(/\s+/g, ' ').toUpperCase()
    const priceHits = (clean.match(/\b\d{1,4}[,.]\d{2}\b/g) || []).length
    const receiptTerms = ['TOTALE', 'SUBTOTALE', 'IMPORTO', 'SCONTRINO', 'RESTO', 'CASSA', 'P.IVA', 'IVA ', 'Q.TA', 'QTA', 'EURO']
    const keywordHits = receiptTerms.reduce((sum, term) => sum + (clean.includes(term) ? 1 : 0), 0)
    const usefulLines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length >= 3).length
    return priceHits >= 3 || keywordHits >= 2 || (keywordHits >= 1 && priceHits >= 1 && usefulLines >= 5)
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

      // Product/scenery photos can produce pages of meaningless OCR. Never expose
      // that dump to the user: move the same photo to visual product recognition.
      if (!looksLikeReceiptText(text)) {
        setReceiptText('')
        setReceiptRows([])
        setScanMode('pantry-photo')
        await selectPantryPhoto(file)
        setPhotoError('Questa immagine non sembra uno scontrino. L’ho preparata per il riconoscimento dei prodotti: premi “Riconosci prodotti”.')
        return
      }

      setReceiptText(text)
      analyzeReceipt(text)
    } catch {
      setOcrError('Non sono riuscito a leggere bene lo scontrino. Prova una foto più nitida oppure usa “Foto dispensa” per riconoscere direttamente i prodotti.')
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
            { value: 'scan', label: 'Acquisisci' }
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
        <div>
          <div className="scan-mode-switch">
            <Segmented value={scanMode} onChange={setScanMode} options={[{ value: 'receipt', label: '🧾 Leggi scontrino' }, { value: 'pantry-photo', label: '📷 Riconosci prodotti' }]} />
            <span>{scanMode === 'receipt' ? 'Usa questa modalità solo per una foto dello scontrino.' : 'Usa questa modalità per prodotti, scaffali, frigorifero o dispensa.'}</span>
          </div>

          {scanMode === 'receipt' ? <div className="scan-layout">
          <Card>
            <CardHeader title="1. Leggi lo scontrino" subtitle="Fotocamera su iPhone/Android oppure testo incollato." />
            <div className="image-source-grid">
              <label className="image-source-option">
                <input type="file" accept="image/*" capture="environment" onChange={e => { const file = e.target.files?.[0]; if (file) runOcr(file); e.currentTarget.value = '' }} />
                <Camera size={28} />
                <strong>Scatta foto</strong>
                <span>Apri direttamente la fotocamera.</span>
              </label>
              <label className="image-source-option">
                <input type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; if (file) runOcr(file); e.currentTarget.value = '' }} />
                <Upload size={28} />
                <strong>Scegli foto esistente</strong>
                <span>Apri galleria, Foto o File del dispositivo.</span>
              </label>
            </div>
            <div className="image-source-hint">Meglio se la foto è dritta, nitida e ben illuminata.</div>
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
        </div> : null}

          {scanMode === 'pantry-photo' ? <div className="scan-layout pantry-photo-scan">
            <Card>
              <CardHeader title="1. Fotografa la dispensa" subtitle="Puoi fotografare uno scaffale, il frigorifero o un gruppo di prodotti." />
              {!cloudAuthenticated || !familyId ? <div className="callout">Accedi al cloud VerdoFamily per usare il riconoscimento fotografico.</div> : visionStatus && !visionStatus.configured ? <div className="callout callout--warning"><strong>Riconoscimento AI da attivare</strong><br />Il modulo è installato, ma manca la chiave Gemini nel backend.</div> : null}
              {photoPreview ? <div className="pantry-photo-preview"><img src={photoPreview} alt="Foto dispensa da analizzare" /><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><span>Foto pronta per il riconoscimento</span><Button variant="danger" size="sm" icon={<Trash2 size={16} />} onClick={clearPantryPhoto}>Rimuovi foto</Button></div></div> : null}
              <div className="image-source-grid image-source-grid--pantry">
                <label className="image-source-option">
                  <input type="file" accept="image/*" capture="environment" onChange={e => { const file = e.target.files?.[0]; if (file) void selectPantryPhoto(file); e.currentTarget.value = '' }} />
                  <Camera size={30} />
                  <strong>{photoPreview ? 'Scatta un’altra foto' : 'Scatta foto'}</strong>
                  <span>Usa la fotocamera del tablet o telefono.</span>
                </label>
                <label className="image-source-option">
                  <input type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; if (file) void selectPantryPhoto(file); e.currentTarget.value = '' }} />
                  <Upload size={30} />
                  <strong>{photoPreview ? 'Scegli un’altra foto' : 'Scegli foto esistente'}</strong>
                  <span>Apri galleria, Foto o File del dispositivo.</span>
                </label>
              </div>
              <div className="image-source-hint">Per risultati migliori: foto frontale, luce uniforme e prodotti non troppo sovrapposti.</div>
              <div className="callout">🔒 La foto viene usata solo per il riconoscimento e non viene salvata nella dispensa o negli allegati.</div>
              {photoError ? <div className="callout callout--warning">{photoError}</div> : null}
              <Button icon={<ScanLine size={18} />} disabled={!photoPayload || photoBusy || visionStatus?.configured === false} onClick={analyzePantryPhoto}>{photoBusy ? 'Riconoscimento in corso…' : 'Riconosci prodotti'}</Button>
            </Card>

            <Card>
              <CardHeader title="2. Controlla e carica" subtitle="Nessuna quantità viene modificata senza la tua conferma." />
              {photoBusy ? <div className="vision-loading"><ScanLine size={28} /><strong>Sto guardando la foto…</strong><span>Leggo confezioni, etichette e quantità visibili.</span></div> : photoRows.length ? <div className="receipt-matches">
                <div className="vision-summary"><strong>{photoRows.length} {photoRows.length === 1 ? 'prodotto riconosciuto' : 'prodotti riconosciuti'}</strong><span>Controlla soprattutto le righe con confidenza più bassa.</span></div>
                {photoRows.map(row => <div key={row.id} className="receipt-match">
                  <div className="receipt-match__head">
                    <label><input type="checkbox" checked={row.include} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, include: e.target.checked } : x))} /><span>{row.raw}{row.observedText ? <small> · letto: {row.observedText}</small> : null}</span></label>
                    <Badge tone={row.confidence >= .8 ? 'success' : row.confidence >= .55 ? 'warning' : 'danger'}>{Math.round(row.confidence * 100)}%</Badge>
                  </div>
                  {row.include ? <div className="receipt-match__grid">
                    <Field label="Associazione"><select value={row.mode} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, mode: e.target.value } : x))}><option value="existing">Prodotto esistente</option><option value="new">Crea nuovo prodotto</option></select></Field>
                    {row.mode === 'existing' ? <Field label="Prodotto"><select value={row.name} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, name: e.target.value } : x))}>{row.suggestions.length ? row.suggestions.map((suggestion: any) => <option key={suggestion.name} value={suggestion.name}>{suggestion.name} · {Math.round(suggestion.score * 100)}%</option>) : <option value={row.name}>{row.name}</option>}{catalogNames().filter(name => !row.suggestions.some((suggestion: any) => suggestion.name === name)).map(name => <option key={name} value={name}>{name}</option>)}</select></Field> : <Field label="Nome prodotto"><input value={row.name} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, name: e.target.value } : x))} /></Field>}
                    <Field label="Quantità"><input type="number" min="1" value={row.qty} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, qty: Number(e.target.value) } : x))} /></Field>
                    <Field label="Unità"><select value={row.unit} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, unit: e.target.value } : x))}><option value="pz">pz</option><option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option></select></Field>
                    {row.mode === 'new' ? <Field label="Categoria"><select value={row.category} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, category: e.target.value } : x))}>{data.categories.map(cat => <option key={cat}>{cat}</option>)}</select></Field> : null}
                  </div> : null}
                </div>)}
                <label className="toggle-row"><input type="checkbox" checked={removeFromShopping} onChange={e => setRemoveFromShopping(e.target.checked)} /><span>Se un prodotto era nella lista spesa, rimuovilo automaticamente</span></label>
                <Button icon={<PackageOpen size={18} />} onClick={importPhotoRecognition}>Conferma e carica in dispensa</Button>
              </div> : <EmptyState icon={<Camera size={30} />} title="In attesa della foto" text="Dopo il riconoscimento vedrai qui i prodotti, le quantità stimate e le associazioni da confermare." />}
            </Card>
          </div> : null}
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
