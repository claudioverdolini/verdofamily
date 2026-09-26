import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Camera, Check, ChevronRight, Globe2, PackageOpen, Plus, ReceiptText, Refrigerator, RefreshCw, ScanLine, Search, ShoppingBasket, Snowflake, Sparkles, Trash2, Upload } from 'lucide-react'
import { useFamily } from '../store'
import { Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Modal, PageIntro, Segmented } from '../ui'
import { cleanReceiptLine, localDateISO, normalize, pantryAverageDailyUse, pantryDaysRemaining, pantryExpiryDays, pantryNeedsRestock, parseReceiptLines, similarity } from '../utils'
import type { PantryLocation } from '../types'
import { supabase } from '../supabaseClient'

const RECEIPT_EXPENSE_CATEGORIES = [
  { value: 'groceries', label: 'Spesa alimentare' },
  { value: 'home', label: 'Casa' },
  { value: 'transport', label: 'Auto e trasporti' },
  { value: 'health', label: 'Salute' },
  { value: 'school', label: 'Scuola' },
  { value: 'bills', label: 'Bollette e utenze' },
  { value: 'leisure', label: 'Tempo libero' },
  { value: 'clothing', label: 'Abbigliamento' },
  { value: 'other', label: 'Altro' }
] as const

function receiptMoney(value: string) {
  const match = String(value || '').replace(/\s/g, '').match(/(\d{1,6}[,.]\d{2})(?!.*\d)/)
  if (!match) return undefined
  const amount = Number(match[1].replace(',', '.'))
  return Number.isFinite(amount) ? amount : undefined
}

function receiptFingerprint(text: string) {
  let hash = 2166136261
  const normalized = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim()
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `ocr-${(hash >>> 0).toString(16)}-${normalized.length}`
}

function inspectReceiptText(text: string) {
  const rawLines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const normalizedLines = rawLines.map(line => normalize(line))
  let total = 0
  for (let i = rawLines.length - 1; i >= 0; i--) {
    const n = normalizedLines[i]
    if ((n.includes('totale') && !n.includes('subtotale')) || n.startsWith('importo')) {
      const amount = receiptMoney(rawLines[i])
      if (amount !== undefined) { total = amount; break }
    }
  }

  let date = localDateISO()
  const dateMatch = String(text || '').match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/)
  if (dateMatch) {
    const year = Number(dateMatch[3]) < 100 ? 2000 + Number(dateMatch[3]) : Number(dateMatch[3])
    const month = Number(dateMatch[2])
    const day = Number(dateMatch[1])
    const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) date = candidate
  }

  const stop = ['documento commerciale','scontrino','p iva','partita iva','iva','data','ora','cassa','totale','subtotale','pagamento','contanti','carta','resto']
  const merchant = rawLines.slice(0, 12).find(line => {
    const n = normalize(line)
    return /[a-zà-ù]{3}/i.test(line)
      && !stop.some(term => n === term || n.startsWith(term + ' '))
      && !/^via\s|^viale\s|^piazza\s|^corso\s|^tel\s|^www\.|^http/i.test(line)
      && !/^\d/.test(line)
  })?.replace(/\s{2,}/g, ' ').slice(0, 160) || ''

  const details = new Map<string, { price?: number; qty: number }>()
  rawLines.forEach(line => {
    const cleaned = cleanReceiptLine(line)
    if (!cleaned) return
    const qtyMatch = line.match(/^\s*(\d+(?:[,.]\d+)?)\s*[xX]\s*/)
    const qty = qtyMatch ? Math.max(0, Number(qtyMatch[1].replace(',', '.')) || 1) : 1
    const price = receiptMoney(line)
    details.set(normalize(cleaned), { price, qty })
  })

  if (total <= 0) {
    const sum = [...details.values()].reduce((value, row) => value + Number(row.price || 0), 0)
    if (sum > 0) total = Math.round(sum * 100) / 100
  }

  return { merchant, date, total, sourceRef: receiptFingerprint(text), details }
}

export default function ShoppingPantryPage() {
  const {
    data,
    authUser,
    addShoppingItem,
    toggleShoppingItem,
    deleteShoppingItem,
    moveTakenShoppingToPantry,
    upsertPantryItem,
    deletePantryItem,
    changePantryQty,
    reconcilePantryItems,
    addCategory,
    renameCategory,
    deleteCategory,
    importReceiptItems,
    upsertExpense,
    cloudAuthenticated,
    familyId
  } = useFamily()

  const isChild = authUser?.role === 'bimbo'
  const pendingChildRequests = (data.approvalRequests || []).filter(request => request.requestedByUserId === authUser?.id && request.kind === 'shopping')
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
  const [receiptMeta, setReceiptMeta] = useState<any>({ merchant: '', date: localDateISO(), total: 0, category: 'groceries', sourceRef: '' })
  const [removeFromShopping, setRemoveFromShopping] = useState(true)

  const [scanMode, setScanMode] = useState<'receipt' | 'pantry-photo'>('receipt')
  const [photoStockMode, setPhotoStockMode] = useState<'add' | 'reconcile'>('add')
  const [visionStatus, setVisionStatus] = useState<{ configured: boolean; model?: string | null } | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [photoPreview, setPhotoPreview] = useState('')
  const [photoPayload, setPhotoPayload] = useState<{ imageData: string; mimeType: string } | null>(null)
  const [photoBatch, setPhotoBatch] = useState<Array<{ id: string; preview: string; imageData: string; mimeType: string; name: string }>>([])
  const [photoRows, setPhotoRows] = useState<any[]>([])
  const [enrichmentBusy, setEnrichmentBusy] = useState(false)
  const [enrichmentMessage, setEnrichmentMessage] = useState('')
  const [residualBusyId, setResidualBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!window.matchMedia?.('(max-width: 820px)').matches) return
    const scroller = document.querySelector<HTMLElement>('.content')
    const frame = window.requestAnimationFrame(() => scroller?.scrollTo({ top: 0, left: 0, behavior: 'auto' }))
    return () => window.cancelAnimationFrame(frame)
  }, [tab])

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
      return existing?.productInfo ? {
        ...item,
        brand: item.brand || existing.brand || existing.productInfo.brand || '',
        variant: item.variant || existing.variant || '',
        packageSize: item.packageSize || existing.packageSize || existing.productInfo.packageQuantity || '',
        barcode: item.barcode || existing.barcode || existing.productInfo.barcode || '',
        productInfo: existing.productInfo
      } : item
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
        return {
          ...item,
          brand: item.brand || result.match.brand || '',
          packageSize: item.packageSize || result.match.packageQuantity || '',
          barcode: item.barcode || result.match.barcode || '',
          productInfo: result.match
        }
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

      setEditingPantry((current: any) => current ? {
        ...current,
        brand: current.brand || match.brand || '',
        packageSize: current.packageSize || match.packageQuantity || '',
        barcode: current.barcode || match.barcode || '',
        productInfo: match
      } : current)
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

  function photoProductFingerprint(row: any) {
    const barcode = String(row?.barcode || '').replace(/\D/g, '')
    const brand = normalize(String(row?.brand || ''))
    const name = normalize(String(row?.name || row?.raw || ''))
    const observed = normalize(String(row?.observedText || ''))
    return { barcode, brand, name, observed }
  }

  function photoDuplicateScore(a: any, b: any) {
    const left = photoProductFingerprint(a)
    const right = photoProductFingerprint(b)
    if (!left.name || !right.name) return { score: 0, reason: '' }

    const differentPackageState = (a.packageState || 'sealed') !== (b.packageState || 'sealed')
    const nameScore = similarity([left.brand, left.name].filter(Boolean).join(' '), [right.brand, right.name].filter(Boolean).join(' '))
    const observedScore = left.observed && right.observed ? similarity(left.observed, right.observed) : 0
    const brandMatches = !!left.brand && !!right.brand && (left.brand === right.brand || similarity(left.brand, right.brand) >= .9)

    // EAN identifies the SKU, not the physical pack. It is a strong duplicate clue
    // only when the two recognition rows also look alike and represent the same state.
    if (left.barcode && right.barcode && left.barcode === right.barcode && !differentPackageState) {
      const score = Math.max(.95, nameScore, observedScore)
      return { score, reason: 'Stesso barcode rilevato in un’altra foto' }
    }

    if (!differentPackageState && brandMatches && nameScore >= .92) {
      return { score: Math.max(.94, nameScore), reason: 'Stessa marca e prodotto rilevati in un’altra foto' }
    }

    if (!differentPackageState && nameScore >= .88 && observedScore >= .72) {
      return { score: Math.max(.89, (nameScore + observedScore) / 2), reason: 'Nome ed etichetta molto simili a un’altra foto' }
    }

    if (!differentPackageState && nameScore >= .84 && (brandMatches || observedScore >= .55)) {
      return { score: Math.max(.82, nameScore * .92), reason: 'Possibile articolo già presente in un’altra foto' }
    }

    return { score: 0, reason: '' }
  }

  function flagPhotoDuplicates(rows: any[]) {
    const next = rows.map(row => ({ ...row, duplicateKind: undefined, duplicateOf: undefined, duplicateReason: undefined, duplicateScore: undefined }))
    for (let i = 0; i < next.length; i += 1) {
      const current = next[i]
      if (!current.sourcePhotoId) continue
      let best: { row: any; score: number; reason: string } | null = null

      for (let j = 0; j < i; j += 1) {
        const previous = next[j]
        if (!previous.sourcePhotoId || previous.sourcePhotoId === current.sourcePhotoId) continue
        const match = photoDuplicateScore(current, previous)
        if (match.score > (best?.score || 0)) best = { row: previous, ...match }
      }

      if (!best || best.score < .82) continue
      const strong = best.score >= .94
      current.duplicateKind = strong ? 'strong' : 'possible'
      current.duplicateOf = best.row.id
      current.duplicateReason = best.reason
      current.duplicateScore = best.score
      if (strong) current.include = false
    }
    return next
  }

  function keepDuplicateRow(rowId: string) {
    setPhotoRows(prev => prev.map(row => row.id === rowId
      ? { ...row, include: true, duplicateKind: undefined, duplicateOf: undefined, duplicateReason: undefined, duplicateScore: undefined }
      : row
    ))
  }

  function excludeDuplicateRow(rowId: string) {
    setPhotoRows(prev => prev.map(row => row.id === rowId ? { ...row, include: false } : row))
  }

  async function addPantryPhotos(files: File[]) {
    const images = files.filter(file => file.type.startsWith('image/'))
    if (!images.length) {
      setPhotoError('Seleziona almeno una foto valida.')
      return
    }

    const remaining = Math.max(0, 6 - photoBatch.length)
    if (!remaining) {
      setPhotoError('Puoi usare fino a 6 foto nella stessa sessione. Analizza o rimuovi una foto prima di aggiungerne altre.')
      return
    }

    const chosen = images.slice(0, remaining)
    setPhotoError(images.length > remaining ? `Ho aggiunto le prime ${remaining} foto: il limite per sessione è 6.` : '')

    const prepared: Array<{ id: string; preview: string; imageData: string; mimeType: string; name: string }> = []
    for (let index = 0; index < chosen.length; index += 1) {
      try {
        const item = await preparePantryPhoto(chosen[index])
        prepared.push({
          id: `batch-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
          preview: item.preview,
          imageData: item.imageData,
          mimeType: item.mimeType,
          name: chosen[index].name || `Foto ${photoBatch.length + index + 1}`
        })
      } catch (error: any) {
        setPhotoError(error?.message || 'Una delle foto non può essere preparata.')
      }
    }

    if (!prepared.length) return
    setPhotoBatch(prev => [...prev, ...prepared].slice(0, 6))
    // Keep legacy single-photo fields synced with the most recently added photo.
    const latest = prepared[prepared.length - 1]
    setPhotoPreview(latest.preview)
    setPhotoPayload({ imageData: latest.imageData, mimeType: latest.mimeType })
  }

  async function selectPantryPhoto(file: File) {
    await addPantryPhotos([file])
  }

  function removePantryPhoto(photoId: string) {
    setPhotoBatch(prev => {
      const next = prev.filter(photo => photo.id !== photoId)
      const latest = next[next.length - 1]
      setPhotoPreview(latest?.preview || '')
      setPhotoPayload(latest ? { imageData: latest.imageData, mimeType: latest.mimeType } : null)
      return next
    })
    setPhotoRows(prev => flagPhotoDuplicates(prev.filter(row => row.sourcePhotoId !== photoId)))
  }

  function clearPantryPhoto() {
    setPhotoBusy(false)
    setPhotoError('')
    setPhotoRows([])
    setPhotoBatch([])
    setPhotoPreview('')
    setPhotoPayload(null)
  }

  async function analyzePantryPhoto() {
    const photos = photoBatch.length
      ? photoBatch
      : (photoPayload ? [{ id: 'legacy-photo', preview: photoPreview, ...photoPayload, name: 'Foto' }] : [])
    if (!photos.length) return

    setPhotoBusy(true)
    setPhotoError('')
    try {
      const catalog = catalogNames()
      const allRows: any[] = []

      // Sequential analysis avoids bursts against the vision backend and makes
      // multi-photo sessions predictable on mobile networks.
      for (let photoIndex = 0; photoIndex < photos.length; photoIndex += 1) {
        const photo = photos[photoIndex]
        const result = await callPantryVision('analyze', {
          imageData: photo.imageData,
          mimeType: photo.mimeType,
          locationHint: inventoryDestination
        })

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
            id: `photo-${photo.id}-${index}`,
            sourcePhotoId: photo.id,
            sourcePhotoIndex: photoIndex,
            sourcePhotoName: photo.name || `Foto ${photoIndex + 1}`,
            raw: String(item.detectedName || '').trim(),
            observedText: String(item.observedText || '').trim(),
            brand: String(item.brand || '').trim(),
            variant: String(item.variant || '').trim(),
            packageSize: String(item.packageSize || '').trim(),
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
            location: ['pantry','fridge','freezer'].includes(String(item.location || '')) ? item.location : inventoryDestination,
            expiryDate: String(item.expiryDate || ''),
            suggestions
          }
        }).filter((row: any) => row.raw)

        allRows.push(...rows)
      }

      const deduped = flagPhotoDuplicates(allRows)
      setPhotoRows(deduped)

      const strongCount = deduped.filter(row => row.duplicateKind === 'strong').length
      const possibleCount = deduped.filter(row => row.duplicateKind === 'possible').length
      if (!deduped.length) {
        setPhotoError('Non ho riconosciuto prodotti con sufficiente affidabilità. Prova foto più vicine e ben illuminate.')
      } else if (strongCount || possibleCount) {
        setPhotoError(
          strongCount
            ? `Ho escluso ${strongCount} ${strongCount === 1 ? 'doppione molto probabile' : 'doppioni molto probabili'} tra le foto${possibleCount ? ` e segnalato ${possibleCount} possibile ${possibleCount === 1 ? 'doppione' : 'doppioni'}` : ''}. Controlla le righe evidenziate.`
            : `Ho segnalato ${possibleCount} possibile ${possibleCount === 1 ? 'doppione' : 'doppioni'} tra le foto. Controlla prima di importare.`
        )
      }
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
      location: x.location || inventoryDestination,
      expiryDate: x.expiryDate || undefined,
      brand: x.brand || '',
      variant: x.variant || '',
      packageSize: x.packageSize || '',
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

    if (photoStockMode === 'reconcile') {
      const ok = window.confirm('Aggiornare le quantità dei prodotti riconosciuti in base alla foto? Gli articoli non visibili nella foto non verranno rimossi.')
      if (!ok) return
      reconcilePantryItems(enriched, inventoryDestination)
    } else {
      importReceiptItems(enriched, removeFromShopping, 'pantry')
    }
    setPhotoRows([])
    setPhotoBatch([])
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
          item.brand,
          item.variant,
          item.packageSize,
          item.barcode,
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
    setEditingPantry({ id: undefined, name: '', brand: '', variant: '', packageSize: '', barcode: '', qty: 1, unit: 'pz', category: data.categories[0] || 'Generico', minQty: 0, location: locationFilter === 'all' ? 'pantry' : locationFilter, expiryDate: '', autoRestock: true, packageState: 'sealed', remainingQty: undefined, remainingUnit: 'g', residualPercent: undefined, residualSource: undefined })
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
      brand: String(editingPantry.brand || '').trim(),
      variant: String(editingPantry.variant || '').trim(),
      packageSize: String(editingPantry.packageSize || '').trim(),
      barcode: String(editingPantry.barcode || '').replace(/\D/g, ''),
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

  function inferredStorageLocation(name: string, existingName?: string): PantryLocation {
    const exactName = existingName || name
    const existing = data.pantry.find(item => normalize(item.name) === normalize(exactName))
    if (existing?.location && ['pantry','fridge','freezer'].includes(existing.location)) return existing.location

    const value = normalize(name)
    const freezerWords = ['surgelat', 'congelat', 'gelato', 'ghiacciolo', 'frozen', 'pizza surgelata', 'patatine surgelate']
    if (freezerWords.some(word => value.includes(normalize(word)))) return 'freezer'

    const fridgeWords = [
      'yogurt','latte fresco','mozzarella','burrata','ricotta','stracchino','mascarpone','formaggio',
      'burro','panna fresca','prosciutto','salame','mortadella','affettato','wurstel','carne','pollo',
      'tacchino','hamburger','pesce','salmone','tonno fresco','uova','pasta fresca','ravioli','tortellini',
      'gnocchi freschi','tofu fresco'
    ]
    if (fridgeWords.some(word => value.includes(normalize(word)))) return 'fridge'
    return 'pantry'
  }

  function aggregateReceiptRows(input: any[]) {
    const groups = new Map<string, any>()

    for (const row of input) {
      if (!row?.name?.trim()) continue
      const isExisting = row.mode === 'existing'
      const identityParts = isExisting
        ? [normalize(row.name), row.unit || 'pz', row.location || 'pantry']
        : [
            normalize(row.name),
            normalize(row.brand || ''),
            normalize(row.variant || ''),
            normalize(row.packageSize || ''),
            row.unit || 'pz',
            row.location || 'pantry'
          ]
      const key = identityParts.join('|')
      const current = groups.get(key)

      if (!current) {
        groups.set(key, { ...row })
        continue
      }

      const qty = Math.max(0, Number(current.qty) || 0) + Math.max(0, Number(row.qty) || 0)
      const hasCurrentTotal = Number.isFinite(Number(current.totalPrice))
      const hasRowTotal = Number.isFinite(Number(row.totalPrice))
      const totalPrice = hasCurrentTotal || hasRowTotal
        ? Math.round(((hasCurrentTotal ? Number(current.totalPrice) : 0) + (hasRowTotal ? Number(row.totalPrice) : 0)) * 100) / 100
        : undefined

      const rawParts = [current.raw, row.raw].map(value => String(value || '').trim()).filter(Boolean)
      const observedParts = [current.observedText, row.observedText].map(value => String(value || '').trim()).filter(Boolean)

      groups.set(key, {
        ...current,
        qty,
        totalPrice,
        unitPrice: totalPrice !== undefined && qty > 0 ? Math.round(totalPrice / qty * 100) / 100 : current.unitPrice,
        category: current.category === 'Generico' && row.category && row.category !== 'Generico' ? row.category : current.category,
        brand: current.brand || row.brand || '',
        variant: current.variant || row.variant || '',
        packageSize: current.packageSize || row.packageSize || '',
        confidence: Math.max(Number(current.confidence) || 0, Number(row.confidence) || 0),
        raw: [...new Set(rawParts)].join(' + '),
        observedText: [...new Set(observedParts)].join(' + '),
        suggestions: current.suggestions?.length ? current.suggestions : row.suggestions
      })
    }

    return [...groups.values()]
  }

  function applyReceiptVision(result: any) {
    const catalog = catalogNames()
    const rows = aggregateReceiptRows((Array.isArray(result?.items) ? result.items : []).map((item: any, index: number) => {
      const exact = item.matchName && catalog.some(name => normalize(name) === normalize(item.matchName))
        ? catalog.find(name => normalize(name) === normalize(item.matchName))
        : ''
      const searchText = `${item.detectedName || ''} ${item.observedText || ''}`.trim()
      const suggestions = catalog
        .map(name => ({ name, score: similarity(searchText, name) }))
        .filter(x => x.score >= 0.16)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
      const top = suggestions[0]
      const confidentExisting = !!exact || (!!top && top.score >= 0.8)
      const chosenName = exact || (confidentExisting ? top.name : String(item.detectedName || '').trim())
      const matchedPantry = data.pantry.find(entry => normalize(entry.name) === normalize(chosenName))
      const category = matchedPantry?.category || (data.categories.includes(item.category) ? item.category : 'Generico')
      const requestedLocation = ['pantry','fridge','freezer'].includes(String(item.location || ''))
        ? item.location as PantryLocation
        : inferredStorageLocation(chosenName, exact || undefined)
      const location = matchedPantry?.location || requestedLocation
      const qty = Math.max(0.01, Number(item.qty) || 1)
      const totalPrice = Number(item.totalPrice) > 0 ? Number(item.totalPrice) : undefined
      const unitPrice = Number(item.unitPrice) > 0
        ? Number(item.unitPrice)
        : totalPrice !== undefined && qty > 0 ? Math.round(totalPrice / qty * 100) / 100 : undefined
      return {
        id: `vision-receipt-${Date.now()}-${index}`,
        raw: String(item.detectedName || '').trim(),
        observedText: String(item.observedText || '').trim(),
        brand: String(item.brand || '').trim(),
        variant: String(item.variant || '').trim(),
        packageSize: String(item.packageSize || '').trim(),
        confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
        include: true,
        mode: confidentExisting ? 'existing' : 'new',
        name: chosenName,
        qty,
        unit: ['pz','g','kg','ml','l'].includes(item.unit) ? item.unit : 'pz',
        category,
        location,
        totalPrice,
        unitPrice,
        suggestions
      }
    }).filter((row: any) => row.name))

    const rawText = String(result?.rawText || '').trim() || [
      result?.merchant || '',
      result?.date || '',
      ...rows.map((row: any) => `${row.observedText || row.raw}${row.totalPrice ? ` ${row.totalPrice.toFixed(2)}` : ''}`),
      result?.total ? `TOTALE ${Number(result.total).toFixed(2)}` : ''
    ].filter(Boolean).join('\n')

    setReceiptText(rawText)
    setReceiptMeta({
      merchant: String(result?.merchant || '').trim(),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(result?.date || '')) ? result.date : localDateISO(),
      total: Math.max(0, Number(result?.total) || 0),
      category: 'groceries',
      sourceRef: receiptFingerprint(rawText || JSON.stringify(result?.items || []))
    })
    setReceiptRows(rows)
    return rows.length
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
    setEnrichmentMessage('')
    let aiError = ''

    try {
      // First choice: multimodal receipt understanding. It reads the image as a
      // receipt and reconstructs real product names instead of exposing noisy OCR.
      if (cloudAuthenticated && familyId && supabase) {
        try {
          setOcrProgress(0.12)
          const prepared = await preparePantryPhoto(file)
          setOcrProgress(0.28)
          const result = await callPantryVision('analyze-receipt', {
            imageData: prepared.imageData,
            mimeType: prepared.mimeType
          })
          setOcrProgress(0.92)
          const count = applyReceiptVision(result)
          if (count) {
            setOcrProgress(1)
            setEnrichmentMessage(`Riconoscimento intelligente completato: ${count} ${count === 1 ? 'prodotto identificato' : 'prodotti identificati'} e destinazione proposta automaticamente.`)
            return
          }
          aiError = 'Nessun prodotto identificato con sufficiente affidabilità.'
        } catch (error: any) {
          aiError = String(error?.message || '')
        }
      }

      // Offline / backend fallback: keep local OCR available, but apply semantic
      // storage heuristics so imported items are not all forced into Dispensa.
      const mod: any = await import('tesseract.js')
      const T = mod.default || mod
      const res = await T.recognize(file, 'ita', {
        logger: (msg: any) => {
          if (msg?.status === 'recognizing text' && typeof msg.progress === 'number') {
            const localProgress = Math.max(0, Math.min(1, msg.progress))
            setOcrProgress(0.3 + localProgress * 0.7)
          }
        }
      })
      const text = res?.data?.text || ''
      if (!text.trim()) throw new Error('empty')

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
      if (aiError) setOcrError('Il riconoscimento intelligente non era disponibile: ho usato la lettura OCR locale. Controlla le righe prima di importare.')
    } catch {
      setOcrError(aiError || 'Non sono riuscito a leggere bene lo scontrino. Prova una foto più nitida oppure usa “Foto dispensa” per riconoscere direttamente i prodotti.')
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
    const inspection = inspectReceiptText(text)
    const lines = parseReceiptLines(text)
    const catalog = catalogNames()
    const rows = aggregateReceiptRows(lines.map((raw, index) => {
      const suggestions = catalog
        .map(name => ({ name, score: similarity(raw, name) }))
        .filter(x => x.score >= 0.18)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
      const top = suggestions[0]
      const confident = !!top && top.score >= 0.72
      const matchedPantry = confident ? data.pantry.find(item => normalize(item.name) === normalize(top.name)) : undefined
      const detail = inspection.details.get(normalize(raw))
      const qty = Math.max(0, Number(detail?.qty || 1))
      const totalPrice = detail?.price
      const chosenName = confident ? top.name : raw
      return {
        id: `${Date.now()}-${index}`,
        raw,
        include: true,
        mode: confident ? 'existing' : 'new',
        name: chosenName,
        qty,
        unit: matchedPantry?.unit || 'pz',
        category: matchedPantry?.category || 'Generico',
        location: matchedPantry?.location || inferredStorageLocation(chosenName),
        totalPrice,
        unitPrice: totalPrice !== undefined && qty > 0 ? Math.round(totalPrice / qty * 100) / 100 : undefined,
        suggestions
      }
    }))
    setReceiptMeta({
      merchant: inspection.merchant,
      date: inspection.date,
      total: inspection.total,
      category: 'groceries',
      sourceRef: inspection.sourceRef
    })
    setReceiptRows(rows)
  }

  async function importReceipt() {
    const sourceRef = receiptMeta.sourceRef || receiptFingerprint(receiptText)
    const duplicateExpense = !!sourceRef && (data.expenses || []).some(item => item.source === 'receipt' && item.sourceRef === sourceRef)
    if (duplicateExpense && !window.confirm('Questo scontrino risulta già importato. Continuando potresti aumentare di nuovo le quantità in dispensa. Vuoi continuare comunque? La spesa non verrà duplicata nel Report.')) return

    const selectedRows = aggregateReceiptRows(receiptRows.filter(x => x.include && x.name.trim()))
    const selected = selectedRows.map(x => ({
      name: x.name.trim(),
      qty: Math.max(0, Number(x.qty) || 1),
      unit: x.unit || 'pz',
      category: x.category || 'Generico',
      location: x.location || inferredStorageLocation(x.name),
      brand: x.brand || '',
      variant: x.variant || '',
      packageSize: x.packageSize || '',
      observedText: x.observedText || x.raw || x.name
    }))
    if (!selected.length) return
    const enriched = await enrichImportedItems(selected)
    importReceiptItems(enriched, removeFromShopping, inventoryDestination)

    const total = Math.max(0, Number(receiptMeta.total) || 0)
    if (total > 0 && !duplicateExpense) {
      upsertExpense({
        date: receiptMeta.date || localDateISO(),
        merchant: receiptMeta.merchant?.trim() || 'Scontrino',
        total,
        category: receiptMeta.category || 'groceries',
        source: 'receipt',
        sourceRef,
        notes: 'Importato automaticamente da riconoscimento scontrino',
        items: selectedRows.map(row => ({
          id: crypto.randomUUID(),
          name: row.name.trim(),
          qty: Math.max(0, Number(row.qty) || 1),
          unit: row.unit || 'pz',
          unitPrice: row.unitPrice,
          totalPrice: row.totalPrice,
          category: row.category || undefined
        }))
      })
    }

    setReceiptRows([])
    setReceiptText('')
    setReceiptMeta({ merchant: '', date: localDateISO(), total: 0, category: 'groceries', sourceRef: '' })
    setTab('pantry')
  }

  return (
    <div className="page">
      <PageIntro
        eyebrow="Casa"
        title="Spesa & Inventario"
        description="Lista spesa, dispensa, frigo e freezer con scadenze, consumi e suggerimenti automatici."
        actions={isChild
          ? <Button icon={<Plus size={18} />} onClick={() => setTab('shopping')}>Aggiungi alla spesa</Button>
          : <Button icon={<Plus size={18} />} onClick={() => tab === 'pantry' ? openNewPantry() : setTab('shopping')}>{tab === 'pantry' ? 'Nuovo prodotto' : 'Aggiungi prodotto'}</Button>}
      />

      {isChild ? <div className="child-approval-hint">
        <strong>Le tue aggiunte vengono controllate da un genitore</strong>
        <span>{pendingChildRequests.length ? `${pendingChildRequests.length} richieste in attesa di conferma.` : 'Aggiungi ciò che manca: comparirà nella lista dopo la conferma.'}</span>
      </div> : null}

      <div className="page-tabs-wrap page-tabs-wrap--shopping">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'shopping', label: `Spesa · ${pending.length}` },
            { value: 'pantry', label: `Dispensa · ${data.pantry.length}` },
            { value: 'insights', label: `Avvisi · ${restockSuggestions.length + expiringSoon.length}` },
            ...(!isChild ? [{ value: 'scan', label: 'Importa' }] : [])
          ] as any}
        />
      </div>

      {!isChild && tab !== 'scan' ? <div className="shopping-import-shortcuts" aria-label="Importazione rapida">
        <button type="button" onClick={() => { setScanMode('pantry-photo'); setTab('scan') }}>
          <span className="shopping-import-shortcuts__icon"><Camera size={19} /></span>
          <span><strong>Foto prodotti</strong><small>Scatta o scegli una foto</small></span>
          <ChevronRight size={17} />
        </button>
        <button type="button" onClick={() => { setScanMode('receipt'); setTab('scan') }}>
          <span className="shopping-import-shortcuts__icon"><ScanLine size={19} /></span>
          <span><strong>Scontrino</strong><small>Foto o OCR acquisti</small></span>
          <ChevronRight size={17} />
        </button>
      </div> : null}

      {tab === 'shopping' ? (
        <div className="shopping-layout">
          <div className="shopping-quick-add" aria-label="Aggiunta rapida alla lista spesa">
            <div className="shopping-quick-add__label">
              <span><Plus size={16} /></span>
              <div><strong>Aggiungi alla lista</strong><small>Scrivi il prodotto e premi Invio</small></div>
            </div>
            <div className="quick-input-row">
              <input
                autoComplete="off"
                value={shopName}
                onChange={e => setShopName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addQuickShopping() }}
                placeholder="Cosa manca?"
                aria-label="Prodotto da aggiungere"
              />
              <input type="number" min="0" step="1" value={shopQty} onChange={e => setShopQty(Number(e.target.value))} aria-label="Quantità" />
              <select value={shopUnit} onChange={e => setShopUnit(e.target.value)} aria-label="Unità">
                <option value="pz">pz</option><option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option>
              </select>
              <IconButton label="Aggiungi" onClick={addQuickShopping}><Plus size={20} /></IconButton>
            </div>
          </div>

          <Card className={`shopping-list-card ${data.shopping.length ? '' : 'is-empty'}`}>
            <CardHeader
              title="Da comprare"
              subtitle={pending.length ? `${pending.length} ${pending.length === 1 ? 'prodotto' : 'prodotti'} ancora da prendere` : 'Lista completata'}
              action={!isChild && taken.length ? <div className="shopping-stock-destination">
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
                    <button className="check-item__check" disabled={isChild} onClick={() => toggleShoppingItem(item.id)} aria-label={item.taken ? 'Segna da comprare' : 'Segna acquistato'}>
                      {item.taken ? <Check size={16} /> : null}
                    </button>
                    <button className="check-item__copy" disabled={isChild} onClick={() => toggleShoppingItem(item.id)}>
                      <strong>{item.name}</strong><span>{item.qty} {item.unit}</span>
                    </button>
                    <IconButton label="Elimina" onClick={() => deleteShoppingItem(item.id)}><Trash2 size={17} /></IconButton>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={<ShoppingBasket size={30} />} title="Lista vuota" text="Aggiungi ciò che manca oppure usa Foto prodotti / Scontrino qui sopra." />
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
                    {(item.brand || item.variant || item.packageSize) ? <div className="pantry-product-identity">
                      {item.brand ? <b>{item.brand}</b> : null}
                      {item.variant ? <span>{item.variant}</span> : null}
                      {item.packageSize ? <span>{item.packageSize}</span> : null}
                    </div> : null}
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

          {scanMode === 'pantry-photo' ? <div className="inventory-photo-mode">
            <div>
              <strong>Come vuoi usare la foto?</strong>
              <span>{photoStockMode === 'add'
                ? 'Aggiunge ciò che riconosce alle quantità già presenti.'
                : 'Allinea le quantità dei prodotti riconosciuti a ciò che vede nella foto. Gli articoli non visibili restano invariati.'}</span>
            </div>
            <Segmented value={photoStockMode} onChange={setPhotoStockMode} options={[{ value: 'add', label: 'Aggiungi prodotti' }, { value: 'reconcile', label: 'Aggiorna scorte' }]} />
          </div> : null}

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
                <span>Puoi selezionare più immagini insieme.</span>
              </label>
            </div>
            <div className="image-source-hint">Meglio se la foto è dritta, nitida e ben illuminata.</div>
            {ocrBusy ? <div className="progress-row"><div className="progress-track"><span style={{ width: `${Math.round(ocrProgress * 100)}%` }} /></div><strong>{Math.round(ocrProgress * 100)}%</strong></div> : null}
            {ocrError ? <div className="callout callout--warning">{ocrError}</div> : null}
            <Field label="Testo riconosciuto" hint="Puoi correggerlo prima dell'analisi.">
              <textarea rows={8} value={receiptText} onChange={e => setReceiptText(e.target.value)} placeholder="Incolla qui il testo dello scontrino…" />
            </Field>
            <Button icon={<ScanLine size={18} />} disabled={!receiptText.trim()} onClick={() => analyzeReceipt()}>Analizza prodotti</Button>
            {receiptRows.length ? <div className="receipt-expense-meta">
              <div className="receipt-expense-meta__head"><ReceiptText size={18} /><div><strong>Dati per il Report spese</strong><span>Controlla ciò che l’OCR ha riconosciuto prima dell’importazione.</span></div></div>
              <div className="form-grid form-grid--2">
                <Field label="Negozio / esercente" className="field--wide"><input value={receiptMeta.merchant || ''} onChange={e => setReceiptMeta({ ...receiptMeta, merchant: e.target.value })} placeholder="Es. Conad" /></Field>
                <Field label="Data"><input type="date" value={receiptMeta.date || localDateISO()} onChange={e => setReceiptMeta({ ...receiptMeta, date: e.target.value })} /></Field>
                <Field label="Totale €" hint={Number(receiptMeta.total) > 0 ? 'Rilevato automaticamente: verifica prima di importare.' : 'Non rilevato: inseriscilo per alimentare il Report.'}><input type="number" min="0" step="0.01" value={receiptMeta.total || ''} onChange={e => setReceiptMeta({ ...receiptMeta, total: e.target.value })} placeholder="0,00" /></Field>
                <Field label="Categoria"><select value={receiptMeta.category || 'groceries'} onChange={e => setReceiptMeta({ ...receiptMeta, category: e.target.value })}>{RECEIPT_EXPENSE_CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
              </div>
              {Number(receiptMeta.total) <= 0 ? <div className="callout callout--warning">Il totale non è stato riconosciuto: i prodotti possono essere importati comunque, ma la spesa entrerà nei Report solo se indichi un importo.</div> : null}
            </div> : null}
          </Card>

          <Card>
            <CardHeader title="2. Verifica associazioni" subtitle="Quando il match non è sicuro, scegli un prodotto esistente oppure creane uno nuovo." />
            {receiptRows.length ? (
              <div className="receipt-matches">
                {receiptRows.map(row => (
                  <div key={row.id} className="receipt-match">
                    <div className="receipt-match__head">
                      <label><input type="checkbox" checked={row.include} onChange={e => setReceiptRows(prev => prev.map(x => x.id === row.id ? { ...x, include: e.target.checked } : x))} /><span>{row.raw}</span></label>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        {Number.isFinite(Number(row.confidence)) ? <Badge tone={row.confidence >= .8 ? 'success' : row.confidence >= .55 ? 'warning' : 'danger'}>{Math.round(row.confidence * 100)}%</Badge> : null}
                        {row.mode === 'existing' ? <Badge tone="success">Associato</Badge> : <Badge tone="warning">Da verificare</Badge>}
                      </div>
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
                            <select value={row.name} onChange={e => {
                              const name = e.target.value
                              const existing = data.pantry.find(item => normalize(item.name) === normalize(name))
                              setReceiptRows(prev => prev.map(x => x.id === row.id ? {
                                ...x,
                                name,
                                category: existing?.category || x.category,
                                unit: existing?.unit || x.unit,
                                location: existing?.location || inferredStorageLocation(name)
                              } : x))
                            }}>
                              {row.suggestions.length ? row.suggestions.map((s: any) => <option key={s.name} value={s.name}>{s.name} · {Math.round(s.score * 100)}%</option>) : <option value={row.name}>{row.name}</option>}
                              {catalogNames().filter(n => !row.suggestions.some((s: any) => s.name === n)).map(name => <option key={name} value={name}>{name}</option>)}
                            </select>
                          </Field>
                        ) : (
                          <Field label="Nome nuovo prodotto"><input value={row.name} onChange={e => setReceiptRows(prev => prev.map(x => x.id === row.id ? { ...x, name: e.target.value } : x))} /></Field>
                        )}
                        <Field label="Quantità"><input type="number" min="0" value={row.qty} onChange={e => setReceiptRows(prev => prev.map(x => x.id === row.id ? { ...x, qty: Number(e.target.value), unitPrice: x.totalPrice !== undefined && Number(e.target.value) > 0 ? Math.round(x.totalPrice / Number(e.target.value) * 100) / 100 : x.unitPrice } : x))} /></Field>
                        <Field label="Prezzo riga €" hint="Facoltativo"><input type="number" min="0" step="0.01" value={row.totalPrice ?? ''} onChange={e => setReceiptRows(prev => prev.map(x => x.id === row.id ? { ...x, totalPrice: e.target.value === '' ? undefined : Number(e.target.value), unitPrice: e.target.value !== '' && Number(x.qty) > 0 ? Math.round(Number(e.target.value) / Number(x.qty) * 100) / 100 : undefined } : x))} /></Field>
                        <Field label="Unità"><select value={row.unit} onChange={e => setReceiptRows(prev => prev.map(x => x.id === row.id ? { ...x, unit: e.target.value } : x))}><option value="pz">pz</option><option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option></select></Field>
                        <Field label="Destinazione" hint="Scelta automaticamente in base al prodotto."><select value={row.location || 'pantry'} onChange={e => setReceiptRows(prev => prev.map(x => x.id === row.id ? { ...x, location: e.target.value as PantryLocation } : x))}><option value="pantry">Dispensa</option><option value="fridge">Frigo</option><option value="freezer">Freezer</option></select></Field>
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
              {photoBatch.length ? <div className="pantry-photo-batch">
                <div className="pantry-photo-batch__head">
                  <div><strong>{photoBatch.length} {photoBatch.length === 1 ? 'foto pronta' : 'foto pronte'}</strong><span>Le analizzerò come un’unica sessione e controllerò i doppioni tra immagini.</span></div>
                  <Button variant="danger" size="sm" icon={<Trash2 size={16} />} onClick={clearPantryPhoto}>Svuota</Button>
                </div>
                <div className="pantry-photo-batch__grid">
                  {photoBatch.map((photo, index) => <div key={photo.id} className="pantry-photo-thumb">
                    <img src={photo.preview} alt={`Foto ${index + 1} da analizzare`} />
                    <span>Foto {index + 1}</span>
                    <button type="button" aria-label={`Rimuovi foto ${index + 1}`} onClick={() => removePantryPhoto(photo.id)}><Trash2 size={14} /></button>
                  </div>)}
                </div>
              </div> : null}
              <div className="image-source-grid image-source-grid--pantry">
                <label className="image-source-option">
                  <input type="file" accept="image/*" capture="environment" onChange={e => { const file = e.target.files?.[0]; if (file) void selectPantryPhoto(file); e.currentTarget.value = '' }} />
                  <Camera size={30} />
                  <strong>{photoBatch.length ? 'Aggiungi un’altra foto' : 'Scatta foto'}</strong>
                  <span>Usa la fotocamera del tablet o telefono.</span>
                </label>
                <label className="image-source-option">
                  <input type="file" accept="image/*" multiple onChange={e => { const files = Array.from(e.target.files || []); if (files.length) void addPantryPhotos(files); e.currentTarget.value = '' }} />
                  <Upload size={30} />
                  <strong>{photoBatch.length ? 'Aggiungi foto dalla galleria' : 'Scegli una o più foto'}</strong>
                  <span>Apri galleria, Foto o File del dispositivo.</span>
                </label>
              </div>
              <div className="image-source-hint">Per risultati migliori: foto frontale, luce uniforme e prodotti non troppo sovrapposti.</div>
              <div className="callout">🔒 La foto viene usata solo per il riconoscimento e non viene salvata nella dispensa o negli allegati.</div>
              {photoError ? <div className="callout callout--warning">{photoError}</div> : null}
              <Button icon={<ScanLine size={18} />} disabled={!photoBatch.length || photoBusy || visionStatus?.configured === false} onClick={analyzePantryPhoto}>{photoBusy ? `Analizzo ${photoBatch.length} ${photoBatch.length === 1 ? 'foto' : 'foto'}…` : `Riconosci prodotti da ${photoBatch.length || 0} ${photoBatch.length === 1 ? 'foto' : 'foto'}`}</Button>
            </Card>

            <Card>
              <CardHeader title="2. Controlla e carica" subtitle="Nessuna quantità viene modificata senza la tua conferma." />
              {photoBusy ? <div className="vision-loading"><ScanLine size={28} /><strong>Sto guardando la foto…</strong><span>Leggo confezioni, etichette e quantità visibili.</span></div> : photoRows.length ? <div className="receipt-matches">
                <div className="vision-summary"><strong>{photoRows.filter(row => row.include).length} da importare · {photoRows.length} riconosciuti</strong><span>{photoRows.some(row => row.duplicateKind) ? 'I doppioni tra foto sono evidenziati e quelli più sicuri vengono esclusi automaticamente.' : 'Controlla soprattutto le righe con confidenza più bassa.'}</span></div>
                {photoRows.map(row => <div key={row.id} className="receipt-match">
                  <div className="receipt-match__head">
                    <label><input type="checkbox" checked={row.include} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, include: e.target.checked } : x))} /><span>{row.raw}{row.brand ? <small> · {row.brand}</small> : null}{row.variant ? <small> · {row.variant}</small> : null}{row.packageSize ? <small> · {row.packageSize}</small> : null}{row.barcode ? <small> · EAN {row.barcode}</small> : row.observedText ? <small> · letto: {row.observedText}</small> : null}<small> · Foto {(row.sourcePhotoIndex ?? 0) + 1}</small></span></label>
                    <Badge tone={row.confidence >= .8 ? 'success' : row.confidence >= .55 ? 'warning' : 'danger'}>{Math.round(row.confidence * 100)}%</Badge>
                  </div>
                  {row.duplicateKind ? <div className={`photo-duplicate-warning photo-duplicate-warning--${row.duplicateKind}`}>
                    <AlertTriangle size={17} />
                    <div>
                      <strong>{row.duplicateKind === 'strong' ? 'Doppione molto probabile' : 'Possibile doppione'}</strong>
                      <span>{row.duplicateReason}{row.duplicateScore ? ` · ${Math.round(row.duplicateScore * 100)}% corrispondenza` : ''}</span>
                    </div>
                    {row.duplicateKind === 'strong' && !row.include
                      ? <button type="button" onClick={() => keepDuplicateRow(row.id)}>Tieni comunque</button>
                      : <button type="button" onClick={() => excludeDuplicateRow(row.id)}>Escludi</button>}
                  </div> : null}
                  {row.include ? <div className="receipt-match__grid">
                    <Field label="Associazione"><select value={row.mode} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, mode: e.target.value } : x))}><option value="existing">Prodotto esistente</option><option value="new">Crea nuovo prodotto</option></select></Field>
                    {row.mode === 'existing' ? <Field label="Prodotto"><select value={row.name} onChange={e => {
                      const name = e.target.value
                      const existing = data.pantry.find(item => normalize(item.name) === normalize(name))
                      setPhotoRows(prev => prev.map(x => x.id === row.id ? {
                        ...x,
                        name,
                        category: existing?.category || x.category,
                        unit: existing?.unit || x.unit,
                        location: existing?.location || x.location || inferredStorageLocation(name)
                      } : x))
                    }}>{row.suggestions.length ? row.suggestions.map((suggestion: any) => <option key={suggestion.name} value={suggestion.name}>{suggestion.name} · {Math.round(suggestion.score * 100)}%</option>) : <option value={row.name}>{row.name}</option>}{catalogNames().filter(name => !row.suggestions.some((suggestion: any) => suggestion.name === name)).map(name => <option key={name} value={name}>{name}</option>)}</select></Field> : <Field label="Nome prodotto"><input value={row.name} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, name: e.target.value } : x))} /></Field>}
                    <Field label="Quantità"><input type="number" min="1" value={row.qty} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, qty: Number(e.target.value) } : x))} /></Field>
                    <Field label="Unità"><select value={row.unit} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, unit: e.target.value } : x))}><option value="pz">pz</option><option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option></select></Field>
                    {row.mode === 'new' ? <Field label="Categoria"><select value={row.category} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, category: e.target.value } : x))}>{data.categories.map(cat => <option key={cat}>{cat}</option>)}</select></Field> : null}
                    <Field label="Destinazione"><select value={row.location || inventoryDestination} onChange={e => setPhotoRows(prev => prev.map(x => x.id === row.id ? { ...x, location: e.target.value as PantryLocation } : x))}><option value="pantry">Dispensa</option><option value="fridge">Frigo</option><option value="freezer">Freezer</option></select></Field>
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
                {photoStockMode === 'add'
                  ? <label className="toggle-row"><input type="checkbox" checked={removeFromShopping} onChange={e => setRemoveFromShopping(e.target.checked)} /><span>Se un prodotto era nella lista spesa, rimuovilo automaticamente</span></label>
                  : <div className="callout"><strong>Aggiornamento scorte</strong><br />Vengono corrette solo le quantità dei prodotti riconosciuti nella foto. La lista spesa e gli articoli non visibili restano invariati.</div>}
                {photoRows.some(rowNeedsResidual) ? <div className="callout callout--warning"><strong>Residuo da confermare</strong><br />{photoRows.filter(rowNeedsResidual).length} {photoRows.filter(rowNeedsResidual).length === 1 ? 'confezione richiede una foto dell’interno oppure l’indicazione del residuo.' : 'confezioni richiedono una foto dell’interno oppure l’indicazione del residuo.'}</div> : null}
                <Button icon={<PackageOpen size={18} />} disabled={enrichmentBusy || photoRows.some(rowNeedsResidual)} onClick={importPhotoRecognition}>{enrichmentBusy ? 'Cerco informazioni…' : photoStockMode === 'reconcile' ? 'Aggiorna le scorte' : 'Conferma e carica'}</Button>
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
          <div className="pantry-identity-fields field--wide">
            <div className="pantry-identity-fields__head"><strong>Identità prodotto</strong><span>Dati brevi usati per riconoscimento, doppioni e scheda tecnica.</span></div>
            <div className="pantry-identity-fields__grid">
              <Field label="Marca"><input value={editingPantry.brand || ''} onChange={e => setEditingPantry({ ...editingPantry, brand: e.target.value })} placeholder="Es. Barilla" /></Field>
              <Field label="Variante / linea"><input value={editingPantry.variant || ''} onChange={e => setEditingPantry({ ...editingPantry, variant: e.target.value })} placeholder="Es. Integrale" /></Field>
              <Field label="Formato confezione"><input value={editingPantry.packageSize || ''} onChange={e => setEditingPantry({ ...editingPantry, packageSize: e.target.value })} placeholder="Es. 500 g" /></Field>
              <Field label="Barcode / EAN"><input inputMode="numeric" value={editingPantry.barcode || ''} onChange={e => setEditingPantry({ ...editingPantry, barcode: e.target.value.replace(/\D/g, '').slice(0, 14) })} placeholder="8–14 cifre" /></Field>
            </div>
          </div>
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
