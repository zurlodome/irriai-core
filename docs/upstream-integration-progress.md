# Integrazione upstream: stato della lavorazione

Aggiornato il 18 novembre 2026.

## Riferimenti e vincoli

- Branch: `integration/upstream-november-2026`.
- Base del fork: `e15ecc06377dca2334268528f10817c844328265`.
- Target upstream fissato: `08f1a42b620889b87d2222a77c5f700adefa43b5`.
- Supportare SQLite e PostgreSQL conservando i dati esistenti.
- Merge del target upstream concluso sul branch di integrazione con un commit locale a due genitori. Nessun push eseguito.
- Stash preparatorio conservato: `276d2bb7f106405587f924f49f29a95b4d053b3c`.
- Database applicativi originali invariati. Alle prove con dati campione si aggiunge il collaudo su copie dei database locali SQLite e PostgreSQL 16, con backup e ripristino verificati.

## Migrazioni riconciliate

Le 67 migrazioni originali del fork restano invariate per ciascun motore. Le 40 migrazioni upstream sono aggiunte come `0067..0106`, conservando SQL e timestamp. Gli snapshot mantengono le tabelle Irrifarm e proseguono la catena del fork. Un fixture verifica hash e metadata della storia distribuita, normalizzando esclusivamente CRLF/LF.

Il validatore controlla journal, file SQL registrati, snapshot e continuità degli ID. `db:check-migrations` passa sul merge effettivo.

Comando riproducibile da `apps/backend`:

```sh
bun scripts/db.verify-upstream-integration.ts --current --postgres
```

Sono passate sia la verifica del candidato sia quella delle migrazioni effettivamente riconciliate:

| Prova                              | SQLite  | PostgreSQL temporaneo 17 |
| ---------------------------------- | ------- | ------------------------ |
| Journal e snapshot, 107 migrazioni | Passata | Passata                  |
| Installazione da zero              | Passata | Passata                  |
| Aggiornamento 67 a 107             | Passato | Passato                  |
| Conservazione dati campione        | Passata | Passata                  |
| Riesecuzione idempotente           | Passata | Passata                  |
| Equivalenza schema fresh/upgrade   | Passata | Passata                  |
| Integrità relazioni                | Passata | Passata                  |

I campioni coprono utenti, organizzazioni, progetti/configurazione, chat, identità/scope Irrifarm e asset. I container delle prove riuscite sono stati rimossi. Una ripetizione successiva non è partita perché Docker non era più disponibile: non rappresenta un errore SQL. Il 18 novembre sono stati verificati anche upgrade e ripristino su copie dei database applicativi locali; eventuali installazioni esterne con storia differente richiedono un inventario equivalente.

## Integrazione applicativa

- Scope MBO trasportato nel servizio warehouse, SQL/validazione FastAPI, reference verification e live story. Scope vuoto rimane restrittivo. Test DuckDB verificano l'intersezione con RLS.
- Filtri e query story eseguiti con identità del richiedente. Le richieste con viewer/scope non riutilizzano la cache globale; il warmup scoped non la popola.
- Asset protetti da autenticazione, appartenenza al progetto e permessi correnti del documento, con cache privata disabilitata. Il diniego restituisce HTTP 403. Lettura di file e riferimenti ad asset riusa i controlli upstream sui percorsi.
- Conservati auth, branding, contesto agente e configurazione modelli Irrifarm, adattandoli ai contratti upstream. Azure non riceve l'opzione OpenAI `forceReasoning`.
- Ripristinato `example/`, necessario al nuovo onboarding. Conservato Node 24.22.1.
- Lock npm/Bun allineati e dipendenze installate dalla versione npm fissata. Nessuna disabilitazione della verifica TLS.
- Template CLI: scrittura UTF-8 esplicita, percorsi glob portabili e rifiuto di percorsi con radice Windows; test dei permessi indipendente da chmod Unix.

## Verifiche più recenti

- TypeScript backend e frontend: passati (frontend con heap di 8 GB).
- Backend mirato: 219 test passati in 6 file; dopo la correzione HTTP, i 4 test della route asset sono stati rieseguiti e passano.
- Backend completo Linux: **4.382 passati, zero fallimenti e 8 saltati** in 390 file. Test eseguiti senza rete, senza `.env` e come utente non privilegiato. Gli 8 casi screenshot richiedono Chrome, assente nel container. Dettagli e diagnosi Windows in [backend-validation-2026-11-16.md](backend-validation-2026-11-16.md).
- Frontend citazioni e identità Irrifarm: 40 test passati.
- Frontend completo: **1.659 passati, zero fallimenti e zero saltati**, 222 file, sia nella suite Linux sia nella conferma finale Windows. I sei casi billing dipendevano dalla locale dell'host; adattati soltanto i fixture dei test, con ripristino del formatter a ogni caso. I 46 test billing/valuta aggiornati passano anche su Linux. Dettagli in [frontend-validation-2026-11-16.md](frontend-validation-2026-11-16.md).
- Frontend TypeScript e lint completo: passati; ESLint senza errori né warning dopo pulizia dell'import e della costante inutilizzata nella tabella chat. I tre test della tabella passano dopo la pulizia; nessuna modifica al comportamento della formattazione dei costi.
- Shared completo: 941 test passati in 51 file.
- FastAPI locale: 165 test passati; escluse solo le due prove BigQuery con connessione reale. Directory temporanea nuova per evitare permessi della cache pytest Windows.
- CLI template e comando chat: 130 test passati dopo le correzioni Windows.
- CLI completo: **1.608 passati, zero fallimenti, zero errori e 262 saltati**, 1.870 casi. Corretti fixture Rich e applicabilità del test POSIX; rigenerati i metadata dell'installazione locale. Prova separata Linux dei permessi token `0600` passata. Dettagli in [cli-validation-2026-11-16.md](cli-validation-2026-11-16.md).
- Lint globale JS/TS: passato senza errori né warning. Formato globale, lint Python, lock npm canonico, lock Bun congelato Windows/Linux e configurazioni Compose verificati. Toolchain fissata a Node 24.22.1, npm 11.10.1 e Bun 1.4.4. Dettagli in [repository-validation-2026-11-16.md](repository-validation-2026-11-16.md).
- CLI: ty, Ruff, ordinamento import e formato passati sull'intera CLI dopo le ultime correzioni. Sidecar riformattato con la configurazione Ruff del progetto.
- Build production frontend (Vite e TypeScript), backend Bun e binario standalone: passate. Avvii da sorgente, bundle e binario verificati con SQLite temporaneo, health, frontend, asset e 107 migrazioni; sorgente e bundle passano anche con sole dipendenze production. Corretti comando di build legacy e percorsi migrazioni degli artefatti compilati. TypeScript backend, 26 test migrazioni Linux, 9 test percorsi Windows e integrità SQLite/PostgreSQL passano. Dettagli in [production-build-validation-2026-11-16.md](production-build-validation-2026-11-16.md).
- Nessuna verifica GUI manuale, secondo `AGENTS.md`.
- Docker: assemblato e collaudato il runtime con backend Bun e sidecar Python. Passano avvio, 107 migrazioni, riavvio e conservazione dati campione su SQLite e PostgreSQL 17; query MySQL reali con scope MBO, RLS, autenticazione interna e trasporto backend-sidecar. Passati anche Chromium, estensione Excel DuckDB offline e blocco degli override della chiave di licenza. Una seconda immagine con il bundle frontend Linux già validato passa anche pagina, quattro asset e undici file story runtime su entrambi i motori, prima e dopo riavvio. La build completa resta aperta per la RAM della VM locale (circa 3,7 GiB); dettagli e distinzione delle immagini di collaudo in [docker-validation-2026-11-17.md](docker-validation-2026-11-17.md).

- Database locali reali: backup e ripristino, upgrade SQLite 69→109 e PostgreSQL 51→108, conservazione di tutte le righe/valori esistenti, conversione citazioni, idempotenza e confronto degli schemi con installazioni nuove passati. I totali includono le registrazioni storiche asset identificate nei commit precedenti. Passati sessione autenticata e lettura progetti/chat via API su entrambi i motori, oltre alla risoluzione di una story storica SQLite. Originali verificati invariati tramite hash e cloni rimossi. Dettagli in [database-upgrade-validation-2026-11-18.md](database-upgrade-validation-2026-11-18.md).

## Stato finale e limiti residui

Le suite backend Linux, frontend e CLI sono verdi nei rispettivi ambienti di verifica, con le esclusioni documentate. Le voci seguenti distinguono i controlli completati dai limiti da considerare per il rilascio.

- Backend Windows: la prima esecuzione di questo step ha prodotto 4.248 passati e 141 falliti. Corretti percorsi virtuali, fixture Slack e aspettative OAuth; verificato il problema di avvio Bun tramite wrapper npm. La suite completa Linux successiva passa, incluse le prove symlink/permessi/descriptor; non si dichiara invece completamente verde la suite nativa Windows. Resta il limite degli 8 test screenshot senza Chrome.
- CLI: restano escluse le integrazioni e i casi di piattaforma/provider elencati nel report. Il test dei bit POSIX non verifica le ACL Windows; la protezione `0600` del codice corrente è stata verificata separatamente su Linux senza modificare il salvataggio delle credenziali.
- Controlli finali del repository completati: gestiti cache e CRLF, corretti i file con problemi reali di stile e il Compose, ripristinato lo stack PostgreSQL di sviluppo isolato. I 268 file storici SQL/snapshot mantengono i blob Git originali del fork. I 25 file con warning whitespace ereditati sono identici a upstream e restano invariati.
- Build workspace, avvio runtime JS, controlli repository, collaudo Docker con sidecar e upgrade su copie dei database applicativi locali completati. L'utente ha richiesto di assumere valida l'immagine Docker: la ricompilazione completa resta documentata come non conclusa, ma non viene riaperta come requisito di questo step. Revisione finale del merge completata, con conferma dell'identità dei 268 file storici SQL/snapshot e assenza di conflitti. Per un rollout esterno vanno conservati secret di autenticazione e backup e verificata l'eventuale differenza della storia distribuita; accesso al provider Irrifarm e verifica visiva spettano all'ambiente di rilascio.
- Prestazioni frontend: Vite segnala il chunk principale di circa 8,23 MB (2,38 MB gzip). La build passa; l'ottimizzazione della dimensione non è stata inclusa in questo step.

Merge concluso localmente il 18 novembre 2026. I controlli pre-commit sono eseguiti direttamente su Windows: lock canonico con npm 11.10.1, lint JS/TS, formato globale, integrità migrazioni con Bun 1.4.4 e i quattro comandi del lint Python tramite la venv esistente. L'hook POSIX richiede `make` e `uv`, assenti nell'ambiente Windows: il commit usa gli esiti dei controlli equivalenti già eseguiti. Stash preparatorio e backup conservati. Nessun push o deploy effettuato.
