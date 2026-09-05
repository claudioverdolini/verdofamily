# VerdoFamily · Family Hub

Family Hub responsive per calendario, spesa/dispensa, pasti, compiti, paghette, scadenze e ToDo.

## Avvio locale

```bash
npm install
npm run dev
```

## Test e build

```bash
npm test
npm run build
```

## Profili demo

- `Admin` / `admin`
- `Famiglia` / `famiglia`

## Architettura

- `App.tsx`: shell, login e navigazione responsive
- `store.tsx`: stato centralizzato, persistenza e operazioni di business
- `pages/`: sezioni dell'app separate e stabili
- `ui.tsx`: componenti UI riutilizzabili
- `utils.ts`: date, migrazione dati, matching OCR e parser scontrini
- `types.ts`: modello dati TypeScript

I dati locali vengono migrati automaticamente dalle chiavi precedenti `familyhub_v1` / `familyhub_v2` a `verdofamily_v3`.

## Scontrini OCR

La sezione **Spesa & Dispensa → Scansiona scontrino** usa `tesseract.js`. Le righe riconosciute vengono confrontate con l'anagrafica esistente: in caso di corrispondenza incerta l'utente deve scegliere un articolo esistente oppure crearne uno nuovo prima dell'importazione in dispensa.

## Mobile / PWA

L'interfaccia usa viewport `100dvh`, safe-area iOS, barra di navigazione inferiore e manifest PWA. In produzione viene registrato un service worker leggero per la shell dell'app.
