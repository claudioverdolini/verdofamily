import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Camera, Check, ChevronRight, Globe2, PackageOpen, Plus, Refrigerator, RefreshCw, ScanLine, Search, ShoppingBasket, Snowflake, Sparkles, Trash2, Upload } from 'lucide-react'
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
  const [enrichmentBusy, setEnrichmentBusy] = useState(false)
  const [enrichmentMessage, setEnrichmentMessage] = useState('')
  const [residualBusyId, setResidualBusyId] = useState<string | null>(null)

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

  async function callProductEnrichment(action: 'lookup' | 'batch', extra: Record<string, any> = {}) {
    if (!supabase || !familyId || !cloudAuthenticated) throw new Error('Cloud non disponibile.')
    const { data: result, error } = await supabase.functions.invoke('product-enrichment', {
      body: { action, familyId, ...extra }
    })
    if (error) throw new Error(error.message || 'Ricerca informazioni prodotto non disponibile.')
    if (result?.error) throw new Error(result.error)
    return result
  }

  async function enrichImportedItems(items: any[]) {
    if (!cloudAuthenticated || !familyId || !supabase || !items.length) return items

    const withExisting = items.map(item => {
      const existing = data.pantry.find(pantryItem =>
        normalize(pantryItem.name) === normalize(item.name) && !!pantryItem.productInfo
      )
      return existing?.productInfo ? { ...item, productInfo: existing.productInfo } : item
    })

    const requests = withExisting
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !item.productInfo && item.name)
      .sort((a, b) => Number(!!b.item.barcode) - Number(!!a.item.barcode))
      .slice(0, 6)
      .map(({ item, index }) => ({
        key: String(index),
        name: item.name,
        brand: item.brand || '',
        barcode: item.barcode || '',
        observedText: item.observedText || ''
      }))

    if (!requests.length) return withExisting

    setEnrichmentBusy(true)
    setEnrichmentMessage('Cerco automaticamente le schede tecniche disponibili…')
    try {
      const response = await callProductEnrichment('batch', { items: requests })
      const byKey = new Map((response?.results || []).map((row: any) => [String(row.key), row]))
      let enriched = 0
      const next = withExisting.map((item, index) => {
        const result: any = byKey.get(String(index))
        if (!result?.autoApply || !result?.match) return item
        enriched += 1
        return { ...item, productInfo: result.match }
      })
      setEnrichmentMessage(enriched
        ? `${enriched} ${enriched === 1 ? 'scheda tecnica trovata' : 'schede tecniche trovate'} e collegate automaticamente.`
        : 'Nessuna corrispondenza online abbastanza sicura: i prodotti verranno comunque caricati normalmente.')
      return next
    } catch {
      setEnrichmentMessage('I prodotti verranno caricati normalmente; il recupero delle schede online non è disponibile in questo momento.')
      return withExisting
    } finally {
      setEnrichmentBusy(false)
    }
  }

  async function refreshEditingProductInfo() {
    if (!editingPantry?.name?.trim() || enrichmentBusy) return
    setEnrichmentBusy(true)
    setEnrichmentMessage('Cerco informazioni online…')
    try {
      const response = await callProductEnrichment('lookup', {
        item: {
          key: 'manual',
          name: editingPantry.name.trim(),
          barcode: editingPantry.productInfo?.barcode || '',
          brand: editingPantry.productInfo?.brand || ''
        }
      })
      const result = response?.result
      const match = result?.match
      if (!match) {
        setEnrichmentMessage('Non ho trovato una scheda online sufficientemente pertinente.')
        return
      }

      if (!result?.autoApply) {
        const label = [match.brand, match.displayName].filter(Boolean).join(' · ') || 'prodotto trovato'
        const confidence = Math.round(Number(result?.confidence || 0) * 100)
        if (!window.confirm(`Ho trovato “${label}” con una corrispondenza del ${confidence}%. Vuoi collegare questa scheda?`)) {
          setEnrichmentMessage('Scheda non collegata.')
          return
        }
      }

      setEditingPantry((current: any) => current ? { ...current, productInfo: match } : current)
      setEnrichmentMessage('Scheda tecnica aggiornata.')
    } catch {
      setEnrichmentMessage('Ricerca online non disponibile in questo momento.')
    } finally {
      setEnrichmentBusy(false)
    }
  }

  function nutrientRows(info: any) {
    const n = info?.nutriments || {}
    return [
      ['Energia', n.energyKcal100g, 'kcal'],
      ['Grassi', n.fat100g, 'g'],
      ['Saturi', n.saturatedFat100g, 'g'],
      ['Carboidrati', n.carbohydrates100g, 'g'],
      ['Zuccheri', n.sugars100g, 'g'],
      ['Fibre', n.fiber100g, 'g'],
      ['Proteine', n.proteins100g, 'g'],
      ['Sale', n.salt100g, 'g']
    ].filter(([, value]) => value !== undefined && value !== null && Number.isFinite(Number(value)))
  }

  function rowNeedsResidual(row: any) {
    return row.include
      && ['opened','possibly_opened'].includes(row.detectedPackageState || row.packageState)
      && !row.confirmedClosed
      && !(Number(row.remainingQty) > 0)
      && !(Number(row.residualPercent) > 0)
  }

  function residualLabel(item: any) {
    if ((item.packageState || 'sealed') !== 'opened') return ''
    if (Number.isFinite(Number(item.remainingQty)) && item.remainingUnit) {
      return `${Number(item.remainingQty).toLocaleString('it-IT', { maximumFractionDigits: 2 })} ${item.remainingUnit} residui`
    }
    if (Number.isFinite(Number(item.residualPercent))) return `~${Math.round(Number(item.residualPercent))}% residuo`
    return 'Residuo non indicato'
  }

  async function estimateResidualFromPhoto(rowId: string, file: File) {
    setPhotoError('')
    setResidualBusyId(rowId)
    try {
      const prepared = await preparePantryPhoto(file)
      const row = photoRows.find(item => item.id === rowId)
      if (!row) return
      const result = await callPantryVision('estimate-residual', {
        imageData: prepared.imageData,
        mimeType: prepared.mimeType,
        productName: row.name || row.raw,
        packageHint: row.productInfo?.packageQuantity || ''
      })
      setPhotoRows(prev => prev.map(item => item.id !== rowId ? item : {
        ...item,
        packageState: 'opened',
        detectedPackageState: 'opened',
        residualPercent: Math.max(0, Math.min(100, Number(result?.percentRemaining) || 0)),
        remainingQty: Number(result?.estimatedQuantity) > 0 ? Number(result.estimatedQuantity) : undefined,
        remainingUnit: Number(result?.estimatedQuantity) > 0 ? (result?.unit || '') : (item.remainingUnit || 'g'),
        residualSource: 'photo',
        residualNote: String(result?.note || ''),
        residualConfidence: Math.max(0, Math.min(1, Number(result?.confidence) || 0))
      }))
    } catch (error: any) {
      setPhotoError(error?.message || 'Non riesco a stimare il residuo da questa foto.')
    } finally {
      setResidualBusyId(null)
    }
  }

  function markPhotoRowClosed(rowId: string) {
    setPhotoRows(prev => prev.map(item => item.id !== rowId ? item : {
      ...item,
      packageState: 'sealed',
      detectedPackageState: 'sealed',
      confirmedClosed: true,
      remainingQty: undefined,
      remainingUnit: undefined,
      residualPercent: undefined,
      residualSource: undefined
    }))
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
      const result = await callPantryVision('analyze', { ...photoPayload, locationHint: inventoryDestination })
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
          brand: String(item.brand || '').trim(),
          barcode: String(item.barcode || '').replace(/\D/g, ''),
          detectedPackageState: ['sealed','opened','possibly_opened','unknown'].includes(String(item.packageState || '')) ? String(item.packageState) : 'unknown',
          packageState: ['opened','possibly_opened'].includes(String(item.packageState || '')) ? 'opened' : 'sealed',
          openReason: String(item.openReason || '').trim(),
          remainingQty: undefined,
          remainingUnit: 'g',
          residualPercent: undefined,
          residualSource: undefined,
          confirmedClosed: item.packageState === 'sealed',
          notes: String(item.notes || '').trim(),
          confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
          include: true,
          mode: confidentExisting ? 'existing' : 'new',
          name: chosenName,
          qty: Math.max(1, Number(item.qty) || 1),
          unit: item.unit || 'pz',
          category,
          expiryDate: String(item.expiryDate || ''),
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

  async function importPhotoRecognition() {
    const unresolved = photoRows.filter(rowNeedsResidual)
    if (unresolved.length) {
      const names = unresolved.slice(0, 3).map(row => row.name || row.raw).join(', ')
      setPhotoError(`Prima di caricare devi confermare il residuo ${unresolved.length === 1 ? 'della confezione' : 'delle confezioni'}: ${names}.`)
      return
    }

    const selected = photoRows.filter(x => x.include && x.name.trim()).map(x => ({
      name: x.name.trim(),
      qty: Math.max(1, Number(x.qty) || 1),
      unit: x.unit || 'pz',
      category: x.category || 'Generico',
      location: inventoryDestination,
      expiryDate: x.expiryDate || undefined,
      brand: x.brand || '',
      barcode: x.barcode || '',
      observedText: x.observedText || '',
      packageState: x.packageState === 'opened' ? 'opened' : 'sealed',
      remainingQty: x.packageState === 'opened' && Number.isFinite(Number(x.remainingQty)) ? Math.max(0, Number(x.remainingQty)) : undefined,
      remainingUnit: x.packageState === 'opened' ? (x.remainingUnit || undefined) : undefined,
      residualPercent: x.packageState === 'opened' && Number.isFinite(Number(x.residualPercent)) ? Math.max(0, Math.min(100, Number(x.residualPercent))) : undefined,
      residualSource: x.packageState === 'opened' ? (x.residualSource || 'manual') : undefined
    }))
    if (!selected.length) return
    const enriched = await enrichImportedItems(selected)
    importReceiptItems(enriched, removeFromShopping, inventoryDestination)
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
      if (q) {
        const searchable = normalize([
          item.name,
          item.productInfo?.brand,
          item.productInfo?.displayName,
          item.productInfo?.barcode
        ].filter(Boolean).join(' '))
        if (!searchable.includes(q)) return false
      }
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
    setEnrichmentMessage('')
    setEditingPantry({ id: undefined, name: '', qty: 1, unit: 'pz', category: data.categories[0] || 'Generico', minQty: 0, location: locationFilter === 'all' ? 'pantry' : locationFilter, expiryDate: '', autoRestock: true, packageState: 'sealed', remainingQty: undefined, remainingUnit: 'g', residualPercent: undefined, residualSource: undefined })
  }

  function savePantry() {
    if (!editingPantry?.name?.trim()) return
    const opened = editingPantry.packageState === 'opened'
    const hasResidual = Number(editingPantry.remainingQty) > 0 || Number(editingPantry.residualPercent) > 0
    if (opened && !hasResidual) {
      setEnrichmentMessage('Per una confezione aperta indica la quantità residua oppure una percentuale residua.')
      return
    }
    upsertPantryItem({
      ...editingPantry,
      name: editingPantry.name.trim(),
      qty: Number(editingPantry.qty) || 0,
      minQty: Number(editingPantry.minQty) || 0,
      location: editingPantry.location || 'pantry',
      expiryDate: editingPantry.expiryDate || undefined,
      autoRestock: editingPantry.autoRestock !== false,
      packageState: opened ? 'opened' : 'sealed',
      remainingQty: opened && Number.isFinite(Number(editingPantry.remainingQty)) ? Math.max(0, Number(editingPantry.remainingQty)) : undefined,
      remainingUnit: opened ? (editingPantry.remainingUnit || undefined) : undefined,
      residualPercent: opened && Number.isFinite(Number(editingPantry.residualPercent)) ? Math.max(0, Math.min(100, Number(editingPantry.residualPercent))) : undefined,
      residualSource: opened ? (editingPantry.residualSource || 'manual') : undefined
    })
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

  async function importReceipt() {
    const selected = receiptRows.filter(x => x.include && x.name.trim()).map(x => ({
      name: x.name.trim(),
      qty: Math.max(0, Number(x.qty) || 1),
      unit: x.unit || 'pz',
      category: x.category || 'Generico',
      location: inventoryDestination,
      observedText: x.raw || x.name
    }))
    if (!selected.length) return
    const enriched = await enrichImportedItems(selected)
    importReceiptItems(enriched, removeFromShopping, inventoryDestination)
    setReceiptRows([])
    setReceiptText('')
    setTab('pantry')
  }

  return (
    <div className="page">
      <PageIntro
        eyebrow="Casa"
        title="Spesa & Inventario"
        description="Lista spesa, dispensa, frigo e freezer con scadenze, consumi e suggerimenti automatici."
        actions={<Button icon={<Plus size={18} />} onClick={() => tab === 'pantry' ? openNewPantry() : setTab('shopping')}>{tab === 'pantry' ? 'Nuovo prodotto' : 'Aggiungi prodotto'}</Button>}
      />

      <div className="page-tabs-wrap page-tabs-wrap--shopping">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'shopping', label: `Spesa · ${pending.length}` },
            { value: 'pantry', label: `Dispensa · ${data.pantry.length}` },
            { value: 'insights', label: `Avvisi · ${restockSuggestions.length + expiringSoon.length}` },
            { value: 'scan', label: 'Scansiona' }
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
              action={taken.length ? <div className="shopping-stock-destination">
                <select value={inventoryDestination} onChange={e => setInventoryDestination(e.target.value as PantryLocation)} aria-label="Destinazione inventario">
                  <option value="pantry">Dispensa</option>
                  <option value="fridge">Frigo</option>
                  <option value="freezer">Freezer</option>
                </select>
                <Button variant="soft" size="sm" icon={<PackageOpen size={16} />} onClick={() => moveTakenShoppingToPantry(inventoryDestination)}>Carica {taken.length}</Button>
              </div> : null}
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
          <div className="inventory-location-stats">
            <button className={locationFilter === 'all' ? 'is-active' : ''} onClick={() => setLocationFilter('all')}><PackageOpen size={18} /><span><strong>{data.pantry.length}</strong><small>Tutto</small></span></button>
            <button className={locationFilter === 'pantry' ? 'is-active' : ''} onClick={() => setLocationFilter('pantry')}><PackageOpen size={18} /><span><strong>{locations.pantry}</strong><small>Dispensa</small></span></button>
            <button className={locationFilter === 'fridge' ? 'is-active' : ''} onClick={() => setLocationFilter('fridge')}><Refrigerator size={18} /><span><strong>{locations.fridge}</strong><small>Frigo</small></span></button>
            <button className={locationFilter === 'freezer' ? 'is-active' : ''} onClick={() => setLocationFilter('freezer')}><Snowflake size={18} /><span><strong>{locations.freezer}</strong><small>Freezer</small></span></button>
          </div>
          <div className="pantry-toolbar">
            <div className="search-box"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Cerca nell’inventario…" /></div>
            <div className="chip-scroll">
              {['Tutte', ...data.categories].map(cat => <button key={cat} className={`chip ${categoryFilter === cat ? 'is-active' : ''}`} onClick={() => setCategoryFilter(cat)}>{cat}</button>)}
            </div>
            <Button variant="ghost" onClick={() => setCategoryModal(true)}>Categorie</Button>
          </div>

          {pantryFiltered.length ? (
            <div className="pantry-grid">
              {pantryFiltered.map(item => {
                const status = inventoryStatus.find(entry => entry.item.id === item.id)
                const low = !!status?.needsRestock
                const expiryDays = status?.expiryDays
                const expiring = expiryDays !== null && expiryDays !== undefined && expiryDays <= 7
                return (
                  <Card key={item.id} className="pantry-item-card" onClick={() => { setEnrichmentMessage(''); setEditingPantry({ ...item }) }}>
                    <div className="pantry-item-card__top">
                      <div className="inventory-badges"><Badge>{locationLabel(item.location)}</Badge><Badge>{item.category}</Badge>{item.packageState === 'opened' ? <Badge tone="warning">Aperta</Badge> : null}{item.productInfo ? <Badge tone="success">{item.productInfo.nutriScore ? `Nutri-Score ${item.productInfo.nutriScore}` : 'Scheda online'}</Badge> : null}</div>
                      <div className="inventory-badges">{expiring ? <Badge tone="warning">{expiryDays! < 0 ? 'Scaduto' : expiryDays === 0 ? 'Scade oggi' : `Scade tra ${expiryDays}g`}</Badge> : null}{low ? <Badge tone="danger">Da ricomprare</Badge> : null}</div>
                    </div>
                    <strong>{item.name}</strong>
                    <div className="pantry-item-card__qty"><span>{item.qty}</span><small>{item.unit}</small></div>
                    <div className="inventory-card-meta">
                      {item.packageState === 'opened' ? <span className="inventory-residual-line">Confezione aperta · {residualLabel(item)}</span> : null}
                      {item.expiryDate ? <span>Scadenza {item.expiryDate.slice(8,10)}/{item.expiryDate.slice(5,7)}</span> : <span>Nessuna scadenza</span>}
                      {status?.averageDailyUse ? <span>Consumo medio {status.averageDailyUse < 1 ? status.averageDailyUse.toFixed(2) : status.averageDailyUse.toFixed(1)} {item.unit}/g</span> : <span>Consumo in apprendimento</span>}
                      {status?.daysRemaining !== null && status?.daysRemaining !== undefined ? <span>Autonomia ~{Math.max(0, Math.ceil(status.daysRemaining))} giorni</span> : null}
                    </div>
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

      {tab === 'insights' ? (
        <div className="inventory-insights-layout">
          <div className="inventory-insight-stats">
            <Card><span>Da ricomprare</span><strong>{restockSuggestions.length}</strong><small>soglia o consumo previsto</small></Card>
            <Card><span>Scadenze 7 giorni</span><strong>{expiringSoon.length}</strong><small>da consumare o controllare</small></Card>
            <Card><span>Movimenti registrati</span><strong>{data.pantryMovements.length}</strong><small>base del consumo medio</small></Card>
          </div>

          <Card>
            <CardHeader title="Suggerimenti di riacquisto" subtitle="Basati su soglia minima e ritmo di consumo degli ultimi 30 giorni." />
            {restockSuggestions.length ? <div className="inventory-suggestion-list">
              {restockSuggestions.map(({ item, daysRemaining, averageDailyUse }) => {
                const already = data.shopping.some(row => !row.taken && normalize(row.name) === normalize(item.name))
                return <div key={item.id} className="inventory-suggestion-row">
                  <div className="inventory-suggestion-icon"><Sparkles size={18} /></div>
                  <div>
                    <strong>{item.name}</strong>
                    <span>{locationLabel(item.location)} · {item.qty} {item.unit} disponibili</span>
                    <small>{daysRemaining !== null ? `A questo ritmo può finire tra ~${Math.max(0, Math.ceil(daysRemaining))} giorni` : `Sotto la soglia minima di ${item.minQty || 0} ${item.unit}`}{averageDailyUse > 0 ? ` · media ${averageDailyUse.toFixed(2)} ${item.unit}/giorno` : ''}</small>
                  </div>
                  <Button variant="soft" size="sm" disabled={already} onClick={() => addRestockSuggestion(item, daysRemaining)}>{already ? 'Già in lista' : 'Aggiungi alla spesa'}</Button>
                </div>
              })}
            </div> : <EmptyState icon={<Sparkles size={28} />} title="Scorte sotto controllo" text="Non risultano prodotti da reintegrare in questo momento." />}
          </Card>

          <Card>
            <CardHeader title="Scadenze da controllare" subtitle="Prodotti già scaduti o in scadenza nei prossimi 7 giorni." />
            {expiringSoon.length ? <div className="inventory-suggestion-list">
              {expiringSoon.map(({ item, expiryDays }) => <div key={item.id} className="inventory-suggestion-row">
                <div className="inventory-suggestion-icon inventory-suggestion-icon--warning"><AlertTriangle size={18} /></div>
                <div>
                  <strong>{item.name}</strong>
                  <span>{locationLabel(item.location)} · {item.qty} {item.unit}</span>
                  <small>{expiryDays! < 0 ? `Scaduto da ${Math.abs(expiryDays!)} giorni` : expiryDays === 0 ? 'Scade oggi' : `Scade tra ${expiryDays} giorni`} · {item.expiryDate}</small>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setEnrichmentMessage(''); setEditingPantry({ ...item }); setTab('pantry') }}>Apri</Button>
              </div>)}
            </div> : <EmptyState icon={<Check size={28} />} title="Nessuna scadenza vicina" text="Non risultano prodotti in scadenza nei prossimi 7 giorni." />}
          </Card>
        </div>
      ) : null}

      {tab === 'scan' ? (
        <div>
          <div className="scan-mode-switch">
            <Segmented value={scanMode} onChange={setScanMode} options={[{ value: 'receipt', label: '🧾 Leggi scontrino' }, { value: 'pantry-photo', label: '📷 Riconosci prodotti' }]} />
            <span>{scanMode === 'receipt' ? 'Usa questa modalità solo per una foto dello scontrino.' : 'Usa questa modalità per prodotti, scaffali, frigorifero o dispensa.'}</span>
          </div>
          <div className="inventory-import-destination">
            <strong>Dove caricare i prodotti?</strong>
            <Segmented value={inventoryDestination} onChange={setInventoryDestination} options={[{ value: 'pantry', label: 'Dispensa' }, { value: 'fridge', label: 'Frigo' }, { value: 'freezer', label: 'Freezer' }]} />
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
                <Button icon={<PackageOpen size={18} />} disabled={enrichmentBusy} onClick={importReceipt}>{enrichmentBusy ? 'Cerco informazioni…' : 'Importa in dispensa'}</Button>
                {enrichmentMessage ? <div className="product-enrichment-message"><Globe2 size={16} /><span>{enrichmentMessage}</span></div> : null}
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
                    <label><input type="checkbox" checked={row.include} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, include: e.target.checked } : x))} /><span>{row.raw}{row.brand ? <small> · {row.brand}</small> : null}{row.barcode ? <small> · EAN {row.barcode}</small> : row.observedText ? <small> · letto: {row.observedText}</small> : null}</span></label>
                    <Badge tone={row.confidence >= .8 ? 'success' : row.confidence >= .55 ? 'warning' : 'danger'}>{Math.round(row.confidence * 100)}%</Badge>
                  </div>
                  {row.include ? <div className="receipt-match__grid">
                    <Field label="Associazione"><select value={row.mode} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, mode: e.target.value } : x))}><option value="existing">Prodotto esistente</option><option value="new">Crea nuovo prodotto</option></select></Field>
                    {row.mode === 'existing' ? <Field label="Prodotto"><select value={row.name} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, name: e.target.value } : x))}>{row.suggestions.length ? row.suggestions.map((suggestion: any) => <option key={suggestion.name} value={suggestion.name}>{suggestion.name} · {Math.round(suggestion.score * 100)}%</option>) : <option value={row.name}>{row.name}</option>}{catalogNames().filter(name => !row.suggestions.some((suggestion: any) => suggestion.name === name)).map(name => <option key={name} value={name}>{name}</option>)}</select></Field> : <Field label="Nome prodotto"><input value={row.name} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, name: e.target.value } : x))} /></Field>}
                    <Field label="Quantità"><input type="number" min="1" value={row.qty} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, qty: Number(e.target.value) } : x))} /></Field>
                    <Field label="Unità"><select value={row.unit} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, unit: e.target.value } : x))}><option value="pz">pz</option><option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option></select></Field>
                    {row.mode === 'new' ? <Field label="Categoria"><select value={row.category} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, category: e.target.value } : x))}>{data.categories.map(cat => <option key={cat}>{cat}</option>)}</select></Field> : null}
                    <Field label="Scadenza" hint="Solo se visibile/certa"><input type="date" value={row.expiryDate || ''} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, expiryDate: e.target.value } : x))} /></Field>
                    {['opened','possibly_opened'].includes(row.detectedPackageState) && !row.confirmedClosed ? <div className="open-package-check field--wide">
                      <div className="open-package-check__head">
                        <AlertTriangle size={19} />
                        <div>
                          <strong>{row.detectedPackageState === 'opened' ? 'Confezione aperta rilevata' : 'Questa confezione potrebbe essere aperta'}</strong>
                          <span>{row.openReason || 'Prima del caricamento serve confermare quanto prodotto rimane.'}</span>
                        </div>
                      </div>
                      <div className="open-package-check__choices">
                        <button type="button" onClick={() => markPhotoRowClosed(row.id)}>In realtà è chiusa</button>
                        <label>
                          <input type="file" accept="image/*" capture="environment" disabled={residualBusyId === row.id} onChange={e => { const file = e.target.files?.[0]; if (file) void estimateResidualFromPhoto(row.id, file); e.currentTarget.value = '' }} />
                          <Camera size={16} /><span>{residualBusyId === row.id ? 'Analisi…' : 'Foto dell’interno'}</span>
                        </label>
                      </div>
                      <div className="open-package-residual">
                        <Field label="Residuo" hint="In alternativa alla foto">
                          <input type="number" min="0" step="0.1" placeholder="Es. 280" value={row.remainingQty ?? ''} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, packageState: 'opened', remainingQty: e.target.value === '' ? undefined : Number(e.target.value), residualSource: 'manual' } : x))} />
                        </Field>
                        <Field label="Unità">
                          <select value={row.remainingUnit || 'g'} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, packageState: 'opened', remainingUnit: e.target.value, residualSource: 'manual' } : x))}>
                            <option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option><option value="pz">pz</option>
                          </select>
                        </Field>
                        <Field label="Oppure residuo %" hint="Facoltativo se indichi quantità">
                          <input type="number" min="1" max="100" step="1" placeholder="Es. 40" value={row.residualPercent ?? ''} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, packageState: 'opened', residualPercent: e.target.value === '' ? undefined : Math.max(0, Math.min(100, Number(e.target.value))), residualSource: 'manual' } : x))} />
                        </Field>
                      </div>
                      {(Number(row.remainingQty) > 0 || Number(row.residualPercent) > 0) ? <div className="open-package-check__result">
                        <Check size={16} />
                        <span>Residuo confermato: {Number(row.remainingQty) > 0 && row.remainingUnit ? `${Number(row.remainingQty).toLocaleString('it-IT', { maximumFractionDigits: 2 })} ${row.remainingUnit}` : `~${Math.round(Number(row.residualPercent))}%`}{row.residualSource === 'photo' && row.residualConfidence ? ` · stima foto ${Math.round(row.residualConfidence * 100)}%` : ''}</span>
                      </div> : <div className="open-package-check__pending">Serve questo dato prima di caricare il prodotto.</div>}
                    </div> : null}
                  </div> : null}
                </div>)}
                <label className="toggle-row"><input type="checkbox" checked={removeFromShopping} onChange={e => setRemoveFromShopping(e.target.checked)} /><span>Se un prodotto era nella lista spesa, rimuovilo automaticamente</span></label>
                {photoRows.some(rowNeedsResidual) ? <div className="callout callout--warning"><strong>Residuo da confermare</strong><br />{photoRows.filter(rowNeedsResidual).length} {photoRows.filter(rowNeedsResidual).length === 1 ? 'confezione richiede una foto dell’interno oppure l’indicazione del residuo.' : 'confezioni richiedono una foto dell’interno oppure l’indicazione del residuo.'}</div> : null}
                <Button icon={<PackageOpen size={18} />} disabled={enrichmentBusy || photoRows.some(rowNeedsResidual)} onClick={importPhotoRecognition}>{enrichmentBusy ? 'Cerco informazioni…' : 'Conferma e carica in dispensa'}</Button>
                {enrichmentMessage ? <div className="product-enrichment-message"><Globe2 size={16} /><span>{enrichmentMessage}</span></div> : null}
              </div> : <EmptyState icon={<Camera size={30} />} title="In attesa della foto" text="Dopo il riconoscimento vedrai qui i prodotti, le quantità stimate e le associazioni da confermare." />}
            </Card>
          </div> : null}
        </div>
      ) : null}

      <Modal
        open={!!editingPantry}
        onClose={() => setEditingPantry(null)}
        title={editingPantry?.id ? 'Modifica prodotto' : 'Nuovo prodotto in inventario'}
        footer={<div className="modal-actions"><div>{editingPantry?.id ? <Button variant="danger" icon={<Trash2 size={17} />} onClick={() => { deletePantryItem(editingPantry.id); setEditingPantry(null) }}>Elimina</Button> : null}</div><div className="modal-actions__right"><Button variant="ghost" onClick={() => setEditingPantry(null)}>Annulla</Button><Button onClick={savePantry}>Salva</Button></div></div>}
      >
        {editingPantry ? <div className="form-grid form-grid--2">
          <Field label="Prodotto" className="field--wide"><input autoFocus value={editingPantry.name} onChange={e => setEditingPantry({ ...editingPantry, name: e.target.value })} /></Field>
          <Field label="Quantità"><input type="number" min="0" value={editingPantry.qty} onChange={e => setEditingPantry({ ...editingPantry, qty: Number(e.target.value) })} /></Field>
          <Field label="Unità"><select value={editingPantry.unit} onChange={e => setEditingPantry({ ...editingPantry, unit: e.target.value })}><option value="pz">pz</option><option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option></select></Field>
          <Field label="Categoria"><select value={editingPantry.category} onChange={e => setEditingPantry({ ...editingPantry, category: e.target.value })}>{data.categories.map(cat => <option key={cat}>{cat}</option>)}</select></Field>
          <Field label="Posizione"><select value={editingPantry.location || 'pantry'} onChange={e => setEditingPantry({ ...editingPantry, location: e.target.value as PantryLocation })}><option value="pantry">Dispensa</option><option value="fridge">Frigo</option><option value="freezer">Freezer</option></select></Field>
          <Field label="Scadenza" hint="Facoltativa"><input type="date" value={editingPantry.expiryDate || ''} onChange={e => setEditingPantry({ ...editingPantry, expiryDate: e.target.value })} /></Field>
          <Field label="Soglia minima" hint="0 = solo previsione consumo"><input type="number" min="0" value={editingPantry.minQty || 0} onChange={e => setEditingPantry({ ...editingPantry, minQty: Number(e.target.value) })} /></Field>
          <div className="pantry-partial-card field--wide">
            <div className="pantry-partial-card__head">
              <div><strong>Stato confezione</strong><span>Registra anche prodotti già consumati parzialmente.</span></div>
              <select value={editingPantry.packageState || 'sealed'} onChange={e => setEditingPantry({
                ...editingPantry,
                packageState: e.target.value,
                ...(e.target.value === 'sealed'
                  ? { remainingQty: undefined, remainingUnit: undefined, residualPercent: undefined, residualSource: undefined }
                  : { remainingUnit: editingPantry.remainingUnit || 'g', residualSource: editingPantry.residualSource || 'manual' })
              })}>
                <option value="sealed">Chiusa / intera</option>
                <option value="opened">Aperta / parzialmente consumata</option>
              </select>
            </div>
            {editingPantry.packageState === 'opened' ? <div className="pantry-partial-grid">
              <Field label="Quantità residua" hint={editingPantry.productInfo?.packageQuantity ? `Formato: ${editingPantry.productInfo.packageQuantity}` : 'Puoi indicare quantità o percentuale'}>
                <input type="number" min="0" step="0.1" value={editingPantry.remainingQty ?? ''} onChange={e => setEditingPantry({ ...editingPantry, remainingQty: e.target.value === '' ? undefined : Number(e.target.value), residualSource: 'manual' })} placeholder="Es. 280" />
              </Field>
              <Field label="Unità residua">
                <select value={editingPantry.remainingUnit || 'g'} onChange={e => setEditingPantry({ ...editingPantry, remainingUnit: e.target.value, residualSource: 'manual' })}>
                  <option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option><option value="pz">pz</option>
                </select>
              </Field>
              <Field label="Residuo %" hint="Alternativa alla quantità">
                <input type="number" min="1" max="100" value={editingPantry.residualPercent ?? ''} onChange={e => setEditingPantry({ ...editingPantry, residualPercent: e.target.value === '' ? undefined : Math.max(0, Math.min(100, Number(e.target.value))), residualSource: 'manual' })} placeholder="Es. 40" />
              </Field>
              <div className="pantry-partial-summary"><span>Disponibilità effettiva</span><strong>{residualLabel(editingPantry)}</strong></div>
            </div> : null}
          </div>
          <div className="product-tech-card field--wide">
            <div className="product-tech-card__head">
              {editingPantry.productInfo?.imageUrl ? <img src={editingPantry.productInfo.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="product-tech-card__placeholder"><Globe2 size={24} /></div>}
              <div>
                <span>Scheda tecnica online</span>
                <strong>{editingPantry.productInfo?.brand || editingPantry.productInfo?.displayName || 'Informazioni prodotto'}</strong>
                {editingPantry.productInfo?.displayName && editingPantry.productInfo?.brand ? <small>{editingPantry.productInfo.displayName}</small> : null}
              </div>
              <Button variant="soft" size="sm" icon={<RefreshCw size={15} />} disabled={enrichmentBusy || !editingPantry.name?.trim()} onClick={refreshEditingProductInfo}>
                {editingPantry.productInfo ? 'Aggiorna' : 'Cerca online'}
              </Button>
            </div>

            {editingPantry.productInfo ? <>
              <div className="product-tech-badges">
                {editingPantry.productInfo.barcode ? <Badge>EAN {editingPantry.productInfo.barcode}</Badge> : null}
                {editingPantry.productInfo.packageQuantity ? <Badge>{editingPantry.productInfo.packageQuantity}</Badge> : null}
                {editingPantry.productInfo.nutriScore ? <Badge tone="success">Nutri-Score {editingPantry.productInfo.nutriScore}</Badge> : null}
                {editingPantry.productInfo.novaGroup ? <Badge>NOVA {editingPantry.productInfo.novaGroup}</Badge> : null}
                {editingPantry.productInfo.ecoScore ? <Badge>Eco-Score {editingPantry.productInfo.ecoScore}</Badge> : null}
              </div>

              {editingPantry.productInfo.allergens?.length ? <div className="product-tech-section"><strong>Allergeni</strong><span>{editingPantry.productInfo.allergens.join(', ')}</span></div> : null}
              {editingPantry.productInfo.ingredients ? <div className="product-tech-section"><strong>Ingredienti</strong><p>{editingPantry.productInfo.ingredients}</p></div> : null}

              {nutrientRows(editingPantry.productInfo).length ? <div className="product-tech-section">
                <strong>Valori nutrizionali per 100 g/ml</strong>
                <div className="product-tech-nutrition">{nutrientRows(editingPantry.productInfo).map(([label, value, unit]: any) => <span key={label}><small>{label}</small><b>{Number(value).toLocaleString('it-IT', { maximumFractionDigits: 2 })} {unit}</b></span>)}</div>
              </div> : null}

              {editingPantry.productInfo.labels?.length ? <div className="product-tech-section"><strong>Etichette</strong><span>{editingPantry.productInfo.labels.slice(0, 8).join(' · ')}</span></div> : null}
              <div className="product-tech-source">
                <span>Dati esterni · aggiornati {new Date(editingPantry.productInfo.retrievedAt).toLocaleDateString('it-IT')}</span>
                {editingPantry.productInfo.sourceUrl ? <a href={editingPantry.productInfo.sourceUrl} target="_blank" rel="noreferrer">Apri fonte</a> : null}
              </div>
            </> : <div className="product-tech-empty">
              <span>Se il prodotto è presente nei cataloghi pubblici posso recuperare automaticamente marca, foto, ingredienti, allergeni e valori nutrizionali.</span>
            </div>}
            {enrichmentMessage ? <div className="product-enrichment-message"><Globe2 size={16} /><span>{enrichmentMessage}</span></div> : null}
          </div>
          <label className="toggle-row field--wide"><input type="checkbox" checked={editingPantry.autoRestock !== false} onChange={e => setEditingPantry({ ...editingPantry, autoRestock: e.target.checked })} /><span><strong>Suggerimenti automatici di riacquisto</strong><small>Usa soglia minima e consumo medio per avvisarti prima che finisca.</small></span></label>
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
