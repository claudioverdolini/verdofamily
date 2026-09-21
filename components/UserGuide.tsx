import React, { useMemo, useState } from 'react'
import {
  Bell, CalendarDays, CheckSquare2, ChevronRight, Cloud, GraduationCap, HeartPulse,
  HelpCircle, Home, Lightbulb, Mic, PackageOpen, Pin, ReceiptText, Search,
  Settings, ShoppingBasket, Sparkles, Users, Utensils, WalletCards, X
} from 'lucide-react'
import type { PageKey } from '../types'
import { Button, IconButton } from '../ui'

type GuideSection = {
  id: string
  title: string
  subtitle: string
  icon: React.ReactNode
  page?: PageKey
  keywords: string
  items: string[]
}

const SECTIONS: GuideSection[] = [
  {
    id: 'start',
    title: 'Primi passi',
    subtitle: 'Come orientarsi senza perdersi',
    icon: <Sparkles size={20} />,
    keywords: 'inizio primi passi navigazione menu altro home',
    items: [
      'La barra in basso contiene i moduli principali; “Altro” apre tutte le altre sezioni.',
      'Il menu ☰ in alto a sinistra mostra sempre l’intera struttura di VerdoFamily.',
      'L’icona nuvola indica lo stato della sincronizzazione cloud.',
      'La campanella raccoglie notifiche, avvisi e promemoria.',
      'La guida resta sempre disponibile dall’icona ? nell’header.'
    ]
  },
  {
    id: 'home',
    title: 'Home e riepiloghi',
    subtitle: 'Il centro operativo della famiglia',
    icon: <Home size={20} />,
    page: 'home',
    keywords: 'home widget riepilogo oggi settimana famiglia personalizza',
    items: [
      'La Home riassume impegni, spesa, pasti, scuola, scadenze, cose da fare e altri moduli.',
      'I widget della Home possono essere scelti e ordinati dalle Impostazioni.',
      'Le azioni rapide permettono di creare subito un impegno, aggiungere una spesa, pianificare un pasto o aprire un modulo.',
      'Le viste Oggi / Settimana / Famiglia aiutano a cambiare rapidamente livello di dettaglio.'
    ]
  },
  {
    id: 'calendar',
    title: 'Calendario',
    subtitle: 'Impegni individuali e familiari',
    icon: <CalendarDays size={20} />,
    page: 'calendar',
    keywords: 'calendario agenda evento impegno ricorrenza promemoria famiglia',
    items: [
      'Crea eventi per una persona, più persone o tutta la famiglia.',
      'Puoi usare viste Agenda, Settimana e Mese; su telefono viene privilegiata la lettura compatta.',
      'Gli eventi possono avere orario, note e uno o più promemoria.',
      'Puoi creare eventi giornalieri, settimanali, ogni 2 settimane, mensili o annuali, con data finale facoltativa.',
      'Gli impegni ricorrenti alimentano correttamente calendario, Home e notifiche.'
    ]
  },
  {
    id: 'meals',
    title: 'Pasti e ricette',
    subtitle: 'Planner, idee e ingredienti',
    icon: <Utensils size={20} />,
    page: 'meals',
    keywords: 'pasti ricette planner menu piatti cookidoo link ingredienti lista spesa',
    items: [
      'Pianifica pranzo, cena e gli altri pasti giorno per giorno, anche per più persone in un’unica operazione.',
      'Su smartphone il planner mostra un giorno alla volta per evitare lo scorrimento orizzontale.',
      'Puoi salvare ricette, piatti e link esterni, compresi link Cookidoo o altri siti.',
      'Gli ingredienti delle ricette possono essere usati per costruire la lista della spesa e confrontati con la dispensa.'
    ]
  },
  {
    id: 'shopping',
    title: 'Spesa & Dispensa',
    subtitle: 'Lista, inventario, foto e OCR',
    icon: <ShoppingBasket size={20} />,
    page: 'shopping',
    keywords: 'spesa dispensa inventario foto ocr scontrino barcode ean marca formato aperta residuo doppione freezer frigo',
    items: [
      'Gestisci lista della spesa, dispensa, frigo e freezer nello stesso modulo.',
      '“Foto prodotti” riconosce confezioni e prodotti: puoi usare fino a 6 foto nella stessa sessione.',
      'Se lo stesso articolo compare in più foto, VerdoFamily segnala o esclude i doppioni più probabili.',
      'Se una confezione sembra aperta, viene richiesto il residuo oppure una seconda foto dell’interno.',
      'Ogni prodotto può avere nome, marca, variante/linea, formato confezione e barcode/EAN separati.',
      'Quando possibile viene creata una scheda tecnica online con immagine, ingredienti, allergeni, Nutri-Score, NOVA, Eco-Score e valori nutrizionali.',
      'La lettura scontrino/OCR può caricare gli acquisti direttamente in dispensa.',
      'Scadenze, soglie minime e ritmo di consumo generano suggerimenti di riacquisto.'
    ]
  },
  {
    id: 'chores',
    title: 'Compiti & Paghette',
    subtitle: 'Responsabilità, approvazioni e wallet',
    icon: <WalletCards size={20} />,
    page: 'chores',
    keywords: 'compiti paghetta wallet ricorrenti bambini approvazione credito famiglia',
    items: [
      'Assegna compiti singoli o ricorrenti a bambini e adulti.',
      'Compiti singoli e ricorrenti possono essere assegnati a più persone con un’unica operazione.',
      'Lo svolgimento resta individuale: ogni persona completa e riceve approvazione separatamente.',
      'La paghetta viene accreditata solo dopo l’approvazione prevista.',
      'Il wallet conserva saldo e movimenti per ciascun membro.'
    ]
  },
  {
    id: 'school',
    title: 'Scuola',
    subtitle: 'Orario, compiti, verifiche e materiale',
    icon: <GraduationCap size={20} />,
    page: 'school',
    keywords: 'scuola orario compiti verifiche interrogazioni materiale circolari gite pagamenti',
    items: [
      'Gestisci orario scolastico e materie per ciascun figlio.',
      'Registra compiti, verifiche, interrogazioni, materiali, circolari, autorizzazioni, gite e pagamenti.',
      'Quando la stessa attività riguarda più ragazzi, puoi selezionarli insieme e VerdoFamily crea uno stato separato per ciascuno.',
      'Le attività scolastiche possono comparire nei riepiloghi e nelle notifiche.'
    ]
  },
  {
    id: 'board',
    title: 'Bacheca',
    subtitle: 'Messaggi e comunicazioni familiari',
    icon: <Pin size={20} />,
    page: 'board',
    keywords: 'bacheca messaggi note foto promemoria famiglia evidenza',
    items: [
      'Pubblica note, messaggi, promemoria o foto per tutta la famiglia o per persone specifiche.',
      'Puoi mettere in evidenza i contenuti importanti.',
      'L’avatar del mittente rende immediatamente riconoscibile chi ha pubblicato il messaggio.'
    ]
  },
  {
    id: 'health',
    title: 'Salute',
    subtitle: 'Visite, terapie e documenti',
    icon: <HeartPulse size={20} />,
    page: 'health',
    keywords: 'salute farmaci terapia visite esami vaccini referti documenti promemoria',
    items: [
      'Registra visite, esami, vaccini, referti, documenti sanitari e note.',
      'Puoi gestire terapie e farmaci con date e informazioni utili.',
      'Le visite possono avere struttura, medico, specialità, esito e controlli successivi.',
      'I promemoria sanitari possono collegarsi a calendario e scadenze.'
    ]
  },
  {
    id: 'deadlines',
    title: 'Scadenze',
    subtitle: 'Documenti, auto, assicurazioni e ricorrenze',
    icon: <ReceiptText size={20} />,
    page: 'deadlines',
    keywords: 'scadenze annuali documenti assicurazione auto abbonamento compleanno manutenzione',
    items: [
      'Tieni sotto controllo scadenze singole e annuali; una nuova scadenza può essere assegnata a più persone con un solo inserimento.',
      'Puoi classificare documenti, assicurazioni, auto, scuola, abbonamenti, compleanni, manutenzioni e altre categorie.',
      'Imposta avvisi anticipati e consulta sia le prossime scadenze sia la vista annuale.'
    ]
  },
  {
    id: 'todos',
    title: 'Da fare e routine',
    subtitle: 'Attività veloci e ricorrenti',
    icon: <CheckSquare2 size={20} />,
    page: 'todos',
    keywords: 'todo da fare routine quotidiana settimanale mensile ricorrente',
    items: [
      'Usa “Da fare” per attività semplici: puoi assegnare lo stesso promemoria a più persone in una volta sola.',
      'Anche una nuova routine può essere assegnata contemporaneamente a più membri; poi ogni routine resta individuale.',
      'Le routine possono ripetersi giornalmente, settimanalmente, ogni due settimane, mensilmente, semestralmente o annualmente.',
      'Le completazioni restano associate alla persona e alla data.'
    ]
  },
  {
    id: 'users',
    title: 'Membri e profili',
    subtitle: 'Persone, ruoli e avatar',
    icon: <Users size={20} />,
    page: 'users',
    keywords: 'membri utenti profilo foto avatar ruoli admin adulto bambino invito',
    items: [
      'Ogni membro ha un profilo con nome, ruolo, colore e foto/avatar.',
      'I ruoli Admin, Adulto e Bimbo possono avere esperienze e permessi differenti.',
      'Le attività, i messaggi, i compiti e molti riepiloghi vengono associati al profilo corretto.'
    ]
  },
  {
    id: 'notifications',
    title: 'Notifiche e privacy',
    subtitle: 'Promemoria senza mostrare troppo',
    icon: <Bell size={20} />,
    keywords: 'notifiche push privacy lockscreen campanella dettagli promemoria',
    items: [
      'La campanella raccoglie notifiche interne e stato letto/non letto.',
      'Le notifiche push possono aprire direttamente il dettaglio pertinente.',
      'Puoi scegliere se mostrare dettagli completi oppure contenuti più discreti sulla schermata di blocco.',
      'Le preferenze di notifica sono configurabili per i diversi moduli.'
    ]
  },
  {
    id: 'voice',
    title: 'Assistente vocale',
    subtitle: 'Comandi naturali per operazioni rapide',
    icon: <Mic size={20} />,
    keywords: 'voce assistente comando vocale nome microfono parlare',
    items: [
      'Puoi usare il comando vocale per impartire richieste rapide all’assistente di VerdoFamily.',
      'Il nome dell’assistente può essere personalizzato dalle Impostazioni.',
      'Quando una richiesta comporta un’eliminazione, VerdoFamily deve sempre chiedere conferma prima di procedere.'
    ]
  },
  {
    id: 'settings',
    title: 'Impostazioni',
    subtitle: 'Aspetto, Home, notifiche e dati',
    icon: <Settings size={20} />,
    page: 'settings',
    keywords: 'impostazioni tema colore stile luminosità densità home widget notifiche dati backup',
    items: [
      'Personalizza luminosità, stile colore e spaziatura dell’interfaccia.',
      'Scegli quali moduli mostrare nella barra inferiore e quali widget vedere nella Home.',
      'Gestisci preferenze di notifica e livello di dettaglio delle push.',
      'Qui trovi anche le impostazioni relative al profilo, alla famiglia e alla gestione dei dati.'
    ]
  },
  {
    id: 'cloud',
    title: 'Cloud e sicurezza dei dati',
    subtitle: 'Sincronizzazione e protezioni',
    icon: <Cloud size={20} />,
    keywords: 'cloud sincronizzazione backup sicurezza dati cancellazione conferma',
    items: [
      'I dati della famiglia vengono sincronizzati tra i dispositivi collegati.',
      'Le modifiche strutturali vengono migrate mantenendo compatibilità con i dati esistenti.',
      'Prima delle migrazioni importanti vengono creati snapshot di sicurezza.',
      'Le operazioni distruttive richiedono conferma: niente eliminazioni silenziose.'
    ]
  }
]

const DISCOVER = [
  'Puoi selezionare più foto della dispensa insieme: VerdoFamily confronta gli articoli tra immagini.',
  'Le confezioni aperte possono avere quantità o percentuale residua e una stima da foto dell’interno.',
  'Le ricorrenze dei compiti possono essere assegnate a più persone con una sola configurazione.',
  'La Home è modulare: puoi scegliere quali riepiloghi mostrare.',
  'Le schede tecniche della dispensa possono recuperare automaticamente informazioni online.',
  'Le notifiche possono usare un contenuto discreto sulla schermata di blocco.'
]

export default function UserGuide({
  open,
  onClose,
  currentPage,
  onNavigate
}: {
  open: boolean
  onClose: () => void
  currentPage: PageKey
  onNavigate: (page: PageKey) => void
}) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return SECTIONS
    return SECTIONS.filter(section => {
      const text = [section.title, section.subtitle, section.keywords, ...section.items].join(' ').toLowerCase()
      return text.includes(q)
    })
  }, [query])

  if (!open) return null

  function openModule(page?: PageKey) {
    if (!page) return
    onNavigate(page)
    onClose()
  }

  return (
    <div className="guide-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="guide-panel" role="dialog" aria-modal="true" aria-label="Guida VerdoFamily">
        <header className="guide-header">
          <div className="guide-header__icon"><HelpCircle size={23} /></div>
          <div>
            <span>Centro assistenza</span>
            <h2>Guida VerdoFamily</h2>
            <p>Tutte le funzioni, spiegate in modo pratico.</p>
          </div>
          <IconButton label="Chiudi guida" onClick={onClose}><X size={21} /></IconButton>
        </header>

        <div className="guide-search">
          <Search size={18} />
          <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Cerca: foto, paghetta, ricette, notifiche…" />
        </div>

        <div className="guide-body">
          {!query ? <section className="guide-discover">
            <div className="guide-section-title"><Lightbulb size={18} /><div><strong>Funzioni che potresti non conoscere</strong><span>Qualche scorciatoia utile da scoprire.</span></div></div>
            <div className="guide-discover__grid">{DISCOVER.map((item, index) => <div key={index}><span>{index + 1}</span><p>{item}</p></div>)}</div>
          </section> : null}

          <div className="guide-results-head">
            <strong>{query ? `${filtered.length} risultati` : 'Tutte le funzioni'}</strong>
            {query ? <button type="button" onClick={() => setQuery('')}>Azzera ricerca</button> : null}
          </div>

          <div className="guide-list">
            {filtered.map(section => {
              const isOpen = expanded === section.id
              const isCurrent = !!section.page && section.page === currentPage
              return <article key={section.id} className={`guide-item ${isOpen ? 'is-open' : ''} ${isCurrent ? 'is-current' : ''}`}>
                <button type="button" className="guide-item__toggle" onClick={() => setExpanded(isOpen ? null : section.id)}>
                  <span className="guide-item__icon">{section.icon}</span>
                  <span className="guide-item__copy"><strong>{section.title}</strong><small>{section.subtitle}</small></span>
                  {isCurrent ? <span className="guide-current-badge">Qui ora</span> : null}
                  <ChevronRight size={18} className="guide-item__chevron" />
                </button>
                {isOpen ? <div className="guide-item__content">
                  <ul>{section.items.map((item, index) => <li key={index}>{item}</li>)}</ul>
                  {section.page ? <Button variant="soft" size="sm" onClick={() => openModule(section.page)}>Apri questo modulo <ChevronRight size={15} /></Button> : null}
                </div> : null}
              </article>
            })}
            {!filtered.length ? <div className="guide-empty"><Search size={25} /><strong>Nessun risultato</strong><span>Prova con una parola più semplice, per esempio “foto”, “scadenza” o “paghetta”.</span></div> : null}
          </div>
        </div>
      </section>
    </div>
  )
}
