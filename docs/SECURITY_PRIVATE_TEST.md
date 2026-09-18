# VerdoFamily — Security baseline per test privato

Data baseline: 18 settembre 2026.

Questa fase è pensata per l'uso privato/familiare prima della commercializzazione. L'obiettivo è raccogliere problemi reali di utilizzo mantenendo già attive protezioni server-side sui punti più sensibili.

## Protezioni attive

- Salute, Paghette e Scuola sono separati dal documento JSON famiglia e protetti da RLS/gateway dedicati.
- Allegati Salute e Bacheca usano bucket privati e URL firmati.
- La Bacheca verifica esistenza del post, autorizzazione del profilo e associazione esatta dell'allegato al post prima di firmare o cancellare un file.
- Gli upload Bacheca verificano anche la firma binaria del formato immagine.
- Rate limiting server-side centralizzato, non modificabile dai client.
- Audit log di sicurezza in schema `private`, non esposto alla Data API.
- Retention audit: 180 giorni. Le finestre di rate limit inattive vengono eliminate dopo 2 giorni.
- Backup/restore formato v4 con Salute, Paghette e Scuola separati.
- Le funzioni amministrative sensibili hanno `search_path` ristretto, limiti d'uso e audit delle operazioni riuscite.

## Limiti applicativi iniziali

- Bacheca upload: 12 file / 10 minuti per utente e famiglia.
- Bacheca URL firmati: 300 / 10 minuti.
- Bacheca cancellazioni: 30 / ora.
- Salute upload: 8 file / 10 minuti.
- Salute URL firmati: 300 / 10 minuti.
- Salute cancellazioni: 30 / ora.
- Paghette sync: 60 / 10 minuti per child, 120 / 10 minuti per adulto/admin.
- Scuola sync: 60 / 10 minuti per child, 120 / 10 minuti per adulto/admin.
- Documento famiglia save: 240 / 10 minuti.
- Riconoscimento foto dispensa: 20 analisi / ora.
- Creazione famiglia: 5 / ora.
- Creazione inviti famiglia: 30 / ora.
- Join tramite codice: 20 / 10 minuti.
- Backup manuali: 30 / ora.
- Restore backup: 5 / ora.

I valori sono volutamente larghi per il test privato: devono bloccare loop, automazioni difettose e abuso evidente senza interferire con l'uso normale.

## Audit registrato

Tra gli eventi tracciati:

- creazione famiglia e inizializzazione documento;
- creazione e utilizzo inviti;
- configurazione/disattivazione backup Drive;
- creazione e restore backup;
- upload/cancellazione allegati Salute;
- upload/cancellazione e tentativi vietati sulla Bacheca;
- sync Paghette e Scuola;
- riconoscimento foto dispensa;
- superamento dei principali rate limit.

I log non memorizzano password, codici invito, file sanitari, immagini o contenuti clinici.

## Security Advisor

Gli avvisi `SECURITY DEFINER` relativi agli RPC utente rimangono intenzionali: sono endpoint applicativi autenticati con controlli autorizzativi interni, `anon` e `PUBLIC` non hanno EXECUTE. Prima della commercializzazione sarà valutato se spostare anche questi endpoint dietro gateway server dedicati.

Le tabelle server-only con RLS e nessuna policy sono intenzionalmente inaccessibili ai client.

## Passaggio manuale Auth ancora richiesto

Abilitare **Leaked password protection** in Supabase Dashboard → Authentication → Providers → Email / Password security. La funzione usa HaveIBeenPwned e, secondo la documentazione Supabase corrente, richiede piano Pro o superiore.

Prima della commercializzazione: CAPTCHA Auth, MFA/2FA utenti, SMTP personalizzato, test di carico e penetration/security test dedicato.
