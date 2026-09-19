import React, { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Send, Volume2, X } from 'lucide-react'
import { useFamily } from '../store'
import { localDateISO, normalize } from '../utils'

function addDays(days: number) {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + days)
  return localDateISO(date)
}

function clean(value: string) {
  return normalize(value).replace(/[?!.,;:]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function splitItems(value: string) {
  return value.split(/\s*(?:,|\be\b)\s*/i).map(item => item.trim()).filter(Boolean)
}

export default function VoiceAssistant() {
  const {
    data, authUser, setActivePage, addShoppingItem, addTodo, upsertDeadline, upsertBoardPost
  } = useFamily()

  const assistantName = data.assistantName || 'Verdo'
  const [open, setOpen] = useState(false)
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [reply, setReply] = useState('Ciao, sono ' + assistantName + '. Come posso aiutarti?')
  const recognitionRef = useRef<any>(null)
  const silenceTimerRef = useRef<number | null>(null)
  const commandHandledRef = useRef(false)

  const recognitionSupported = typeof window !== 'undefined'
    && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)

  function clearSilenceTimer() {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }

  function releaseRecognition(recognition?: any) {
    clearSilenceTimer()
    if (!recognition || recognitionRef.current === recognition) recognitionRef.current = null
    setListening(false)
  }

  useEffect(() => {
    return () => {
      clearSilenceTimer()
      try { recognitionRef.current?.abort?.() } catch {}
      recognitionRef.current = null
    }
  }, [])

  function speak(text: string) {
    setReply(text)
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    try {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'it-IT'
      window.speechSynthesis.speak(utterance)
    } catch {}
  }

  function stripName(value: string) {
    const lower = clean(value)
    const name = clean(assistantName)
    if (lower === name) return ''
    if (lower.startsWith(name + ' ')) return value.trim().slice(assistantName.length).replace(/^[\s,:-]+/, '')
    if (lower.startsWith('ehi ' + name + ' ')) return value.trim().slice(assistantName.length + 4).replace(/^[\s,:-]+/, '')
    return value.trim()
  }

  function agenda(date: string, label: string) {
    const events = data.calendarEvents.filter(item => item.date === date)
    const school = data.schoolItems.filter(item => item.date === date && !item.done)
    const chores = data.chores.filter(item => item.deadline === date && !item.done)
    const deadlines = data.deadlines.filter(item => item.date === date && !item.done && (item.kind || 'general') === 'general')
    const parts: string[] = []
    events.slice(0, 3).forEach(item => parts.push((item.time ? item.time + ' ' : '') + item.title))
    school.slice(0, 3).forEach(item => parts.push('scuola: ' + item.title))
    chores.slice(0, 3).forEach(item => parts.push('compito: ' + item.title))
    deadlines.slice(0, 3).forEach(item => parts.push('scadenza: ' + item.title))
    return parts.length ? 'Per ' + label + ': ' + parts.join('; ') + '.' : 'Non vedo impegni per ' + label + '.'
  }

  function navigate(text: string) {
    const routes: Array<[string[], any]> = [
      [['home'], 'home'], [['calendario', 'agenda'], 'calendar'], [['spesa', 'dispensa', 'frigo'], 'shopping'],
      [['pasti', 'menu'], 'meals'], [['paghette', 'compiti'], 'chores'], [['scuola'], 'school'],
      [['bacheca'], 'board'], [['salute'], 'health'], [['scadenze'], 'deadlines'],
      [['da fare', 'todo'], 'todos'], [['membri', 'utenti'], 'users'], [['impostazioni'], 'settings']
    ]
    for (const [words, page] of routes) {
      if (words.some(word => text.includes(word))) {
        setActivePage(page)
        speak('Apro ' + words[0] + '.')
        return true
      }
    }
    return false
  }

  function execute(rawValue: string) {
    if (!authUser) return
    const raw = stripName(rawValue)
    const text = clean(raw)
    if (!text) return
    setTranscript(rawValue)

    if (/\b(elimina|cancella|rimuovi)\b/.test(text)) {
      speak('Per sicurezza non elimino nulla direttamente con la voce. Apri la sezione interessata: prima di cancellare ti verrà sempre chiesta conferma a schermo.')
      return
    }

    if (/^(apri|vai|mostra)\b/.test(text) && navigate(text)) return

    const shopping = raw.match(/(?:aggiungi|metti)\s+(.+?)\s+(?:alla|nella)\s+(?:lista\s+della\s+)?spesa\b/i)
    if (shopping) {
      const items = splitItems(shopping[1])
      items.forEach(name => addShoppingItem({ name, qty: 1, unit: 'pz', category: 'Generico' }))
      speak(items.length === 1 ? 'Ho aggiunto ' + items[0] + ' alla spesa.' : 'Ho aggiunto ' + items.length + ' articoli alla lista della spesa.')
      return
    }

    const todo = raw.match(/(?:aggiungi|crea)\s+(?:da fare|un todo|una cosa da fare)\s+(.+)/i)
    if (todo) {
      addTodo({ title: todo[1].trim(), userId: authUser.id })
      speak('Aggiunto ai Da fare.')
      return
    }

    const board = raw.match(/(?:metti|scrivi|pubblica)\s+(?:in|sulla|nella)\s+bacheca\s+(.+)/i)
    if (board) {
      upsertBoardPost({ type: 'message', title: '', body: board[1].trim(), audience: 'family', userIds: [], pinned: false })
      speak('Messaggio pubblicato in bacheca.')
      return
    }

    const reminder = raw.match(/ricordami\s+(?:di\s+)?(.+)/i)
    if (reminder) {
      const when = text.includes('dopodomani') ? { date: addDays(2), word: 'dopodomani' }
        : text.includes('domani') ? { date: addDays(1), word: 'domani' }
        : text.includes('oggi') ? { date: addDays(0), word: 'oggi' }
        : null
      if (!when) {
        speak('Dimmi anche quando. Per esempio: ricordami di chiamare il medico domani.')
        return
      }
      const title = reminder[1].replace(/\b(oggi|domani|dopodomani)\b/gi, '').trim() || 'Promemoria'
      upsertDeadline({ title, date: when.date, userId: authUser.id, kind: 'general', category: 'other', reminderDays: [0] })
      speak('Va bene. Ho creato il promemoria per ' + when.word + '.')
      return
    }

    if (/\bquanto\b.*\b(paghetta|saldo)\b/.test(text)) {
      const target = [...data.users].sort((a, b) => b.name.length - a.name.length).find(user => text.includes(clean(user.name))) || authUser
      if (authUser.role === 'bimbo' && target.id !== authUser.id) {
        speak('Per privacy posso dirti soltanto il tuo saldo.')
        return
      }
      speak(target.name + ' ha ' + Number(target.balance || 0).toFixed(2).replace('.', ',') + ' euro di paghetta.')
      return
    }

    if (/\b(cosa|che cosa).*\bspesa\b/.test(text) || text.includes('lista della spesa')) {
      const items = data.shopping.filter(item => !item.taken)
      speak(items.length ? 'Nella lista ci sono: ' + items.slice(0, 8).map(item => item.name).join(', ') + '.' : 'La lista della spesa è vuota.')
      return
    }

    if (text.includes('domani') && /\b(cosa|agenda|impegni)\b/.test(text)) {
      speak(agenda(addDays(1), 'domani'))
      return
    }

    if (text.includes('oggi') && /\b(cosa|agenda|impegni)\b/.test(text)) {
      speak(agenda(addDays(0), 'oggi'))
      return
    }

    speak('Non ho ancora capito questo comando. Prova con: aggiungi latte alla spesa, ricordami di chiamare il medico domani, scrivi in bacheca, apri scuola, cosa abbiamo domani, oppure quanto ho di paghetta.')
  }

  function startListening() {
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!Recognition) {
      setOpen(true)
      speak('Il riconoscimento vocale non è disponibile in questo browser. Puoi comunque scrivermi il comando.')
      return
    }

    try { recognitionRef.current?.abort?.() } catch {}
    clearSilenceTimer()
    commandHandledRef.current = false

    const recognition = new Recognition()
    recognitionRef.current = recognition
    recognition.lang = 'it-IT'
    recognition.continuous = false
    recognition.interimResults = true
    let finalText = ''
    let bestText = ''

    const finish = (value?: string) => {
      if (commandHandledRef.current) return
      const command = String(value || bestText || finalText || '').trim()
      commandHandledRef.current = true
      clearSilenceTimer()
      releaseRecognition(recognition)
      try { recognition.stop?.() } catch {}
      if (command) execute(command)
      else setReply('Non ho sentito nulla. Premi il microfono per riprovare.')
    }

    recognition.onstart = () => {
      setOpen(true)
      setListening(true)
      setReply('Ti ascolto…')
    }

    recognition.onresult = (event: any) => {
      let interim = ''
      let receivedFinal = false

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const value = event.results[index][0]?.transcript || ''
        if (event.results[index].isFinal) {
          finalText += value
          receivedFinal = true
        } else {
          interim += value
        }
      }

      bestText = (finalText || interim).trim()
      setTranscript(bestText)

      clearSilenceTimer()

      if (receivedFinal && finalText.trim()) {
        finish(finalText)
        return
      }

      if (bestText) {
        // iOS/WebKit può lasciare la frase come "interim" anche dopo che
        // l'utente ha finito di parlare. Un breve silenzio chiude la sessione.
        silenceTimerRef.current = window.setTimeout(() => finish(bestText), 1100)
      }
    }

    recognition.onerror = (event: any) => {
      clearSilenceTimer()
      commandHandledRef.current = true
      releaseRecognition(recognition)
      if (event?.error === 'not-allowed') speak('Per usare il microfono devi autorizzarlo nel browser.')
      else if (event?.error !== 'no-speech' && event?.error !== 'aborted') speak('Non sono riuscito ad ascoltare bene. Riprova.')
      else if (event?.error === 'no-speech') setReply('Non ho sentito nulla. Premi il microfono per riprovare.')
    }

    recognition.onend = () => {
      if (!commandHandledRef.current) finish(finalText || bestText)
      else releaseRecognition(recognition)
    }

    try {
      recognition.start()
    } catch {
      releaseRecognition(recognition)
      speak('Non sono riuscito ad avviare il microfono. Riprova.')
    }
  }

  function stopListening() {
    const recognition = recognitionRef.current
    clearSilenceTimer()
    commandHandledRef.current = true
    try { recognition?.stop?.() } catch {}
    releaseRecognition(recognition)
    setReply('Ascolto fermato. Premi il microfono quando vuoi parlare di nuovo.')
  }

  return <>
    <button className={'voice-fab' + (listening ? ' is-listening' : '')} onClick={() => listening ? stopListening() : startListening()} aria-label={'Parla con ' + assistantName}>
      {listening ? <MicOff size={21} /> : <Mic size={21} />}
      <span>{listening ? 'Sto ascoltando…' : 'Parla con ' + assistantName}</span>
    </button>

    {open ? <div className="voice-layer" onMouseDown={event => { if (event.target === event.currentTarget && !listening) setOpen(false) }}>
      <section className="voice-panel" role="dialog" aria-modal="true" aria-label={'Assistente ' + assistantName}>
        <header className="voice-panel__head">
          <div><span className="voice-panel__orb"><Mic size={20} /></span><div><strong>{assistantName}</strong><small>Assistente VerdoFamily</small></div></div>
          <button className="voice-icon-btn" onClick={() => { clearSilenceTimer(); commandHandledRef.current = true; try { recognitionRef.current?.abort?.() } catch {}; recognitionRef.current = null; setListening(false); setOpen(false) }} aria-label="Chiudi assistente"><X size={20} /></button>
        </header>
        <div className={'voice-listen-state' + (listening ? ' is-listening' : '')}><span>{listening ? 'Ti ascolto…' : recognitionSupported ? 'Premi il microfono e parla' : 'Microfono non disponibile: usa il testo'}</span></div>
        <div className="voice-transcript">
          <label>Comando</label>
          <div><input value={transcript} onChange={event => setTranscript(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') execute(transcript) }} placeholder={'Es. ' + assistantName + ', aggiungi latte alla spesa'} /><button onClick={() => execute(transcript)} aria-label="Invia comando"><Send size={18} /></button></div>
        </div>
        <div className="voice-reply"><Volume2 size={18} /><p>{reply}</p></div>
        <div className="voice-examples">
          <strong>Prova:</strong>
          <button onClick={() => execute('Aggiungi latte e pane alla spesa')}>Aggiungi latte e pane alla spesa</button>
          <button onClick={() => execute('Cosa abbiamo domani?')}>Cosa abbiamo domani?</button>
          <button onClick={() => execute('Apri scuola')}>Apri scuola</button>
        </div>
        <button className={'voice-main-btn' + (listening ? ' is-listening' : '')} onClick={() => listening ? stopListening() : startListening()}>
          {listening ? <><MicOff size={20} /> Ferma ascolto</> : <><Mic size={20} /> Parla con {assistantName}</>}
        </button>
      </section>
    </div> : null}
  </>
}
