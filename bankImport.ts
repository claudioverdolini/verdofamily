import type { ExpenseCategory } from './types'

export type BankTable = {
  fileName: string
  headers: string[]
  rows: string[][]
}

export type BankColumnMapping = {
  date: string
  description: string
  amount: string
  debit: string
  credit: string
  reference: string
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function normalized(value: string) {
  return value.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function columnIndex(ref: string) {
  const match = String(ref || '').match(/^([A-Z]+)/i)
  if (!match) return 0
  return match[1].toUpperCase().split('').reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1
}

function chooseHeaderRow(rows: string[][]) {
  const keywords = [
    'data','date','descrizione','description','causale','movimento','beneficiario',
    'importo','amount','valore','addebito','debito','debit','uscita','accredito','credito','credit'
  ]
  let bestIndex = 0
  let bestScore = -1
  rows.slice(0, 20).forEach((row, index) => {
    const values = row.map(value => normalized(value)).filter(Boolean)
    if (!values.length) return
    const keywordScore = values.reduce((sum, value) => sum + keywords.reduce((inner, keyword) => inner + (value.includes(keyword) ? 1 : 0), 0), 0)
    const score = keywordScore * 100 + values.length
    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  })
  return bestIndex
}

function makeHeaders(row: string[]) {
  const seen = new Map<string, number>()
  return row.map((value, index) => {
    const base = text(value) || `Colonna ${index + 1}`
    const count = (seen.get(base) || 0) + 1
    seen.set(base, count)
    return count === 1 ? base : `${base} ${count}`
  })
}

function tableFromRows(fileName: string, input: string[][]): BankTable {
  const rows = input
    .map(row => row.map(value => text(value)))
    .filter(row => row.some(Boolean))
    .slice(0, 3001)
  if (!rows.length) throw new Error('Il file non contiene righe leggibili.')
  const headerIndex = chooseHeaderRow(rows)
  const headers = makeHeaders(rows[headerIndex] || [])
  const width = headers.length
  const dataRows = rows.slice(headerIndex + 1)
    .map(row => Array.from({ length: width }, (_, index) => row[index] || ''))
    .filter(row => row.some(Boolean))
    .slice(0, 3000)
  if (!headers.length || !dataRows.length) throw new Error('Non riesco a individuare intestazioni e movimenti nel file.')
  return { fileName, headers, rows: dataRows }
}

function parseDelimited(value: string, delimiter: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quoted) {
      if (char === '"' && value[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''))
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  row.push(cell.replace(/\r$/, ''))
  if (row.some(value => value.trim())) rows.push(row)
  return rows
}

function parseCsv(value: string, fileName: string) {
  const candidates = [';', ',', '\t'].map(delimiter => {
    const rows = parseDelimited(value, delimiter)
    const sample = rows.slice(0, 15)
    const score = sample.reduce((sum, row) => sum + row.length, 0) / Math.max(1, sample.length)
    return { rows, score }
  }).sort((a, b) => b.score - a.score)
  return tableFromRows(fileName, candidates[0].rows)
}

async function unzipXlsx(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  let eocd = -1
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      eocd = index
      break
    }
  }
  if (eocd < 0) throw new Error('File Excel non valido o non supportato.')
  const entries = view.getUint16(eocd + 10, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  const decoder = new TextDecoder('utf-8')
  const output = new Map<string, Uint8Array>()
  let offset = centralOffset

  for (let entry = 0; entry < entries; entry += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const fileNameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const fileName = decoder.decode(bytes.slice(offset + 46, offset + 46 + fileNameLength))

    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('Archivio Excel danneggiato.')
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const compressed = bytes.slice(dataStart, dataStart + compressedSize)

    let decompressed: Uint8Array
    if (method === 0) {
      decompressed = compressed
    } else if (method === 8) {
      const Decompression = (globalThis as any).DecompressionStream
      if (!Decompression) throw new Error('Questo browser non supporta la lettura diretta dei file Excel. Esporta il file in CSV.')
      const stream = new Blob([compressed]).stream().pipeThrough(new Decompression('deflate-raw'))
      decompressed = new Uint8Array(await new Response(stream).arrayBuffer())
    } else {
      throw new Error('Compressione Excel non supportata. Prova a esportare in CSV.')
    }
    output.set(fileName.replace(/^\//, ''), decompressed)
    offset += 46 + fileNameLength + extraLength + commentLength
  }
  return output
}

function xmlText(entries: Map<string, Uint8Array>, path: string) {
  const value = entries.get(path)
  return value ? new TextDecoder('utf-8').decode(value) : ''
}

function parseSharedStrings(xml: string) {
  if (!xml) return [] as string[]
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  return Array.from(doc.getElementsByTagName('si')).map(node =>
    Array.from(node.getElementsByTagName('t')).map(part => part.textContent || '').join('')
  )
}

function resolveFirstWorksheet(entries: Map<string, Uint8Array>) {
  const workbookXml = xmlText(entries, 'xl/workbook.xml')
  const relsXml = xmlText(entries, 'xl/_rels/workbook.xml.rels')
  if (workbookXml && relsXml) {
    const workbook = new DOMParser().parseFromString(workbookXml, 'application/xml')
    const firstSheet = workbook.getElementsByTagName('sheet')[0]
    const relationId = firstSheet?.getAttribute('r:id') || firstSheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
    if (relationId) {
      const rels = new DOMParser().parseFromString(relsXml, 'application/xml')
      const relation = Array.from(rels.getElementsByTagName('Relationship')).find(node => node.getAttribute('Id') === relationId)
      const target = relation?.getAttribute('Target') || ''
      if (target) {
        const clean = target.replace(/^\.\//, '').replace(/^\//, '')
        return clean.startsWith('xl/') ? clean : `xl/${clean}`
      }
    }
  }
  return [...entries.keys()].filter(key => /^xl\/worksheets\/sheet\d+\.xml$/i.test(key)).sort()[0] || ''
}

async function parseXlsx(file: File) {
  const entries = await unzipXlsx(await file.arrayBuffer())
  const shared = parseSharedStrings(xmlText(entries, 'xl/sharedStrings.xml'))
  const sheetPath = resolveFirstWorksheet(entries)
  if (!sheetPath) throw new Error('Non trovo un foglio dati nel file Excel.')
  const sheetXml = xmlText(entries, sheetPath)
  const doc = new DOMParser().parseFromString(sheetXml, 'application/xml')
  const rows = Array.from(doc.getElementsByTagName('row')).map(rowNode => {
    const row: string[] = []
    Array.from(rowNode.getElementsByTagName('c')).forEach(cell => {
      const ref = cell.getAttribute('r') || 'A1'
      const index = columnIndex(ref)
      const type = cell.getAttribute('t') || ''
      let value = ''
      if (type === 'inlineStr') {
        value = Array.from(cell.getElementsByTagName('t')).map(node => node.textContent || '').join('')
      } else {
        const raw = cell.getElementsByTagName('v')[0]?.textContent || ''
        value = type === 's' ? (shared[Number(raw)] ?? raw) : raw
      }
      row[index] = value
    })
    return row
  })
  return tableFromRows(file.name, rows)
}

export async function readBankFile(file: File): Promise<BankTable> {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.xlsx')) return parseXlsx(file)
  if (lower.endsWith('.xls')) throw new Error('Il vecchio formato .xls non è supportato. Salvalo come .xlsx oppure CSV.')
  const value = await file.text()
  return parseCsv(value.replace(/^\uFEFF/, ''), file.name)
}

export function suggestBankMapping(headers: string[]): BankColumnMapping {
  const find = (...words: string[]) => headers.find(header => {
    const value = normalized(header)
    return words.some(word => value.includes(word))
  }) || ''
  const debit = find('addebito','debito','debit','uscita','dare','prelievo')
  const credit = find('accredito','credito','credit','entrata','avere')
  return {
    date: find('data valuta','data contabile','data operazione','data','date'),
    description: find('descrizione','causale','description','movimento','beneficiario','esercente','dettagli','operazione'),
    amount: debit ? '' : find('importo','amount','valore','totale'),
    debit,
    credit,
    reference: find('id operazione','id movimento','identificativo','riferimento','reference','transaction id','transactionid','cro','trn','numero operazione','n operazione')
  }
}

export function parseBankAmount(value: unknown) {
  let raw = text(value).replace(/\s/g, '')
  if (!raw) return undefined
  const negativeParentheses = /^\(.*\)$/.test(raw)
  raw = raw.replace(/[()€$£]/g, '').replace(/[^0-9,.-]/g, '')
  if (!raw || raw === '-' || raw === '.') return undefined
  const comma = raw.lastIndexOf(',')
  const dot = raw.lastIndexOf('.')
  if (comma >= 0 && dot >= 0) {
    if (comma > dot) raw = raw.replace(/\./g, '').replace(',', '.')
    else raw = raw.replace(/,/g, '')
  } else if (comma >= 0) {
    raw = raw.replace(/\./g, '').replace(',', '.')
  } else if ((raw.match(/\./g) || []).length > 1) {
    const last = raw.lastIndexOf('.')
    raw = raw.slice(0, last).replace(/\./g, '') + raw.slice(last)
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return undefined
  return negativeParentheses ? -Math.abs(parsed) : parsed
}

export function parseBankDate(value: unknown) {
  const raw = text(value)
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
  const european = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/)
  if (european) {
    const year = Number(european[3]) < 100 ? 2000 + Number(european[3]) : Number(european[3])
    const month = Number(european[2])
    const day = Number(european[1])
    const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const date = new Date(`${candidate}T12:00:00`)
    if (!Number.isNaN(date.getTime()) && date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day) return candidate
  }
  const serial = Number(raw)
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    const epoch = Date.UTC(1899, 11, 30)
    const date = new Date(epoch + Math.floor(serial) * 86400000)
    return date.toISOString().slice(0, 10)
  }
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

export function normalizeBankMerchant(value: string) {
  return normalized(value)
    .replace(/\b(?:pagamento|pagam|carta|bancomat|pos|contactless|operazione|movimento|addebito|sepa|sdd|bonifico|bonif|disposizione|commissione|rif|riferimento|codice|cod|transazione|trx|data|ora|italia)\b/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/\b\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function bankMerchantSimilarity(left: string, right: string) {
  const a = normalizeBankMerchant(left)
  const b = normalizeBankMerchant(right)
  if (!a || !b) return 0
  if (a === b) return 1
  if ((a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) >= 5) return .94

  const tokensA = Array.from(new Set(a.split(' ').filter(token => token.length >= 2)))
  const tokensB = Array.from(new Set(b.split(' ').filter(token => token.length >= 2)))
  if (!tokensA.length || !tokensB.length) return 0
  const shared = tokensA.filter(token => tokensB.includes(token)).length
  const union = new Set([...tokensA, ...tokensB]).size
  const jaccard = union ? shared / union : 0
  const coverage = shared / Math.max(1, Math.min(tokensA.length, tokensB.length))
  return Math.max(jaccard, coverage * .9)
}

export function inferExpenseCategory(value: string): ExpenseCategory {
  const v = normalized(value)
  if (/supermerc|conad|coop|lidl|eurospin|esselunga|aliment|spesa|market|carrefour|pam\b|md\b/.test(v)) return 'groceries'
  if (/benz|carbur|eni\b|q8\b|ip\b|tamoil|autostr|telepass|parcheg|tren|bus|taxi|uber|auto|officina/.test(v)) return 'transport'
  if (/farmac|medic|dent|clinic|ospedal|sanit|ottic/.test(v)) return 'health'
  if (/scuol|libri|cartoler|mensa|universit|corso/.test(v)) return 'school'
  if (/enel|eni plenitude|hera|acea|a2a|gas|luce|energia|telefono|tim\b|vodafone|wind|iliad|internet|fibra|acqua|tari|utenza|bollett/.test(v)) return 'bills'
  if (/ikea|leroy|brico|casa|arredo|ferrament|casaling/.test(v)) return 'home'
  if (/zara|h&m|ovs|decathlon|abbigli|scarpe|calzatur/.test(v)) return 'clothing'
  if (/ristor|pizzeria|bar\b|cinema|teatro|netflix|spotify|booking|hotel|vacanz|amazon prime/.test(v)) return 'leisure'
  return 'other'
}

export function bankSourceRef(date: string, description: string, amount: number, discriminator = '') {
  const suffix = discriminator ? `|${normalized(discriminator)}` : ''
  const value = `${date}|${normalized(description)}|${Math.abs(amount).toFixed(2)}${suffix}`
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `bank-${(hash >>> 0).toString(16)}-${value.length}`
}
