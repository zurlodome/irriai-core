# Verifica Docker del merge upstream

Data: 17 novembre 2026. Branch: `integration/upstream-november-2026`.

## Stato della build completa

La build completa resta aperta per un limite di memoria dell'ambiente locale. Docker dispone di 3.966.386.176 byte di RAM (circa 3,7 GiB), su un host con circa 8 GB complessivi.

Il bundle frontend ha prima esaurito l'heap predefinito di Node. Con heap di 4 GB la build ha trasformato 12.837 moduli, ma il processo è stato terminato con `Killed` / `ResourceExhausted: cannot allocate memory`. Un tentativo del solo stadio frontend con heap di 3 GB è rimasto senza avanzamento dopo la trasformazione; anche una richiesta al motore Docker ha restituito HTTP 500. Docker Desktop è stato riavviato ed è tornato disponibile. Il secondo tentativo è stato interrotto dal riavvio, senza un esito di compilazione valido.

Il Dockerfile consente di configurare l'heap con `FRONTEND_BUILD_HEAP_MB`, con default di 4096 MB. Il limite riguarda solo il comando di compilazione. Per chiudere il controllo completo serve un ambiente con memoria sufficiente anche per il resto di Node, Docker e sistema operativo; usare un runner con almeno 8 GiB assegnati a Docker e confermare il consumo effettivo. Non sono state cambiate le impostazioni globali WSL o la memoria della macchina.

```sh
docker build --progress=plain --tag irriai-upstream-validation:local .
```

Se la rete richiede una CA aziendale, aggiungere `--secret id=build_ca,src=/percorso/ca-bundle.pem`. La verifica TLS resta abilitata. Il bundle CA viene montato come secret durante le installazioni e non copiato nell'immagine.

## Correzioni emerse durante la build

- Escluse dal contesto Docker le cache Python, le directory virtualenv annidate e la cache TanStack. L'invio del contesto falliva leggendo una cache pytest locale non accessibile.
- Dichiarate direttamente nel frontend `@trpc/server`, `@tiptap/core` e `@tiptap/pm`, già importate dal codice. Il linker isolato di Bun ha evidenziato la dipendenza tRPC mancante che l'installazione npm rendeva disponibile tramite hoisting. L'audit degli import ha individuato anche i due pacchetti Tiptap.
- Aggiornati esclusivamente i tre riferimenti workspace nei lockfile npm e Bun: versioni, URL, integrità e grafo dei pacchetti restano invariati.
- Eseguito il probe `@nao/shared` dalla directory backend, che possiede la dipendenza nel layout isolato di Bun. Probe passato con sole dipendenze production.
- Spostato il mount dello script di installazione delle estensioni DuckDB nella directory backend, per risolvere `@duckdb/node-api` dal workspace proprietario.
- Aggiunto il secret CA opzionale alle installazioni npm, Bun e uv; nessuna disabilitazione TLS e nessun certificato privato aggiunto al repository.

Installazione Bun 1.4.4 congelata completa e production passate. Gli import MySQL passano sia nel builder sia nello stadio runtime. Versioni confermate nell'immagine: Node 24.22.1, npm 11.10.1, Bun 1.4.4, Python 3.12.16, `ibis-framework 12.0.0`, `mysqlclient 2.3.1` e `packaging 26.3`. Confermata anche l'assenza del secret CA, delle variabili temporanee CA e del file `.env` locale nell'immagine.

Dopo la modifica dei manifest sono passati 36 test frontend mirati in quattro file (organizzazione attiva, errori tRPC, gestione modifiche editor e editor Markdown), il formato dei manifest e il controllo whitespace. Le suite complete e la build JavaScript già eseguite sono descritte nei report precedenti; non vengono presentate come una build Docker riuscita.

## Collaudo runtime

Costruita l'immagine locale di collaudo `irriai-upstream-runtime-check:20261117` usando una copia temporanea del Dockerfile che omette soltanto il `COPY` del bundle frontend. Non è un artefatto di rilascio e non chiude il controllo della build completa.

Le prove usano una rete interna privata, database applicativi SQLite e PostgreSQL 17 nuovi e un warehouse MySQL 8 con dati campione e un account con soli permessi SELECT. Nessuna porta host, mount di dati esistenti o `.env` locale. Container e rete creati con un prefisso univoco sono stati rimossi e la rimozione è stata verificata.

| Verifica                                                  | SQLite                 | PostgreSQL 17          |
| --------------------------------------------------------- | ---------------------- | ---------------------- |
| Health backend e FastAPI                                  | Passata                | Passata                |
| Backend e sidecar eseguiti come UID 1000                  | Passata                | Passata                |
| Migrazioni applicate, prima e dopo riavvio                | 107                    | 107                    |
| Dato campione presente dopo riavvio                       | Passata                | Passata                |
| Query MySQL senza scope / scope A / scope B / scope vuoto | 3 / 2 / 1 / 0 righe    | 3 / 2 / 1 / 0 righe    |
| Scope A intersecato con RLS `region = 'north'`            | Solo ID 1              | Solo ID 1              |
| Chiamata interna senza secret                             | HTTP 401               | HTTP 401               |
| DELETE scoped rifiutata, tre righe ancora presenti        | HTTP 400               | HTTP 400               |
| Validazione SQL protetta                                  | Passata                | Passata                |
| Servizio Bun → FastAPI → MySQL, scope A / vuoto           | ID 1, 2 / nessuna riga | ID 1, 2 / nessuna riga |

Passati anche il caricamento dell'estensione DuckDB `excel` con autoinstallazione disabilitata e senza rete esterna, l'avvio/chiusura automatico di Chromium 156.0.8078.79 come utente `nao` e l'inefficacia degli override della chiave di licenza nell'immagine. Nessuna pagina aperta manualmente e nessuno screenshot.

Per verificare anche pagina e asset è stata assemblata una seconda immagine di collaudo, `irriai-upstream-runtime-assets-check:20261117`, aggiungendo il bundle Linux già compilato e verificato nel precedente step. Recuperato in sola lettura dal container di validazione precedente; gli SHA-256 di `index.html` e `story-runtime/standalone.js` corrispondono al report del 16 novembre:

```text
index.html: e06948f88ae4e6bd2724a5ac9add9a3da33547b72f5ea614d9d7612171e77a43
standalone.js: 985537dc3d308f5b2c8711105b8127d5483e9b5ca755f7a496390a65f0c69704
```

Il bundle non ricompila le nuove dichiarazioni dirette del manifest; i pacchetti risolti hanno comunque le stesse versioni. Il collaudo di questa seconda immagine è distinto dalla build completa con Bun, che rimane aperta.

Anche la seconda immagine passa l'intero collaudo su entrambi i database, prima e dopo il riavvio. In aggiunta alle verifiche precedenti:

- Pagina iniziale HTTP 200 con elemento `app`.
- Quattro asset locali disponibili, non vuoti e senza fallback HTML.
- Undici file story runtime disponibili, incluso `standalone.js`.
- Asset JavaScript inesistente restituito come HTTP 404.

Confermata anche in questa esecuzione la rimozione di tutti i container e della rete del collaudo. Il controllo lasciato aperto è la build completa dal Dockerfile del repository, con compilazione frontend nello stadio Bun, da ripetere su un ambiente adeguato. L'aggiornamento di copie dei database distribuiti resta un successivo controllo distinto.

Log, harness e risultati JSON sono conservati nella directory temporanea locale `irriai-image-validation-11218549-3286-4eb7-b9d4-fcbe89ee2c24`. Le immagini di collaudo rimangono locali; nessuna immagine è stata pubblicata.

Nessun commit di merge, push o deploy. Gli ambienti e i database esistenti restano invariati.
