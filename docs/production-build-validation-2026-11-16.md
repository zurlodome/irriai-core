# Verifica build production del merge upstream

Data: 16 novembre 2026. Branch: `integration/upstream-november-2026`.

## Esito

| Verifica Linux                                                 | Risultato  |
| -------------------------------------------------------------- | ---------- |
| Frontend: `npm run build -w @nao/frontend` (Vite e TypeScript) | Passata    |
| Backend: `npm run build -w @nao/backend`                       | Passata    |
| Backend: `npm run build:standalone -w @nao/backend`            | Passata    |
| Avvio production da sorgente, come nel Dockerfile              | Passato    |
| Avvio del bundle `dist/index.js`                               | Passato    |
| Avvio del binario standalone con layout del pacchetto CLI      | Passato    |
| Avvio sorgente e bundle con sole dipendenze production         | Passato    |
| TypeScript backend                                             | Passato    |
| Test percorsi e integrità migrazioni Linux                     | 26 passati |
| Test percorsi migrazioni Windows                               | 9 passati  |
| Controllo migrazioni SQLite e PostgreSQL                       | Passato    |
| Lint, formato e whitespace dei file modificati                 | Passati    |

Ambiente locale: Node 24.22.1, Bun 1.4.4, container Linux di validazione già predisposto. Build e controlli di avvio senza rete, senza `.env` locale e come utente non privilegiato. Nessun database applicativo aggiornato e nessun deploy.

## Problemi individuati e corretti

Il vecchio comando backend usava `tsup`, che non supporta gli import `with { type: 'text' }` introdotti upstream. Build e comando `start` sono ora coerenti con il runtime Bun richiesto dal progetto. Il bundle mantiene esterne le dipendenze di pacchetto e copia il worker codemode in `dist`.

Il controllo di avvio ha poi rilevato che il bundle cercava le migrazioni in `apps/migrations-sqlite`, anziché nella directory backend. La risoluzione distingue ora `src/db`, `dist` e binario compilato; in quest'ultimo caso usa la directory dell'eseguibile. I percorsi assoluti espliciti restano invariati. Non viene cercata automaticamente un'altra storia migrazioni sul filesystem. SQL, journal, snapshot e hash della baseline non sono modificati.

Il resolver è verificato per entrambi i motori nei tre layout e su Windows. I controlli di integrità della storia SQLite/PostgreSQL e gli avvii reali degli artefatti passano.

## Controlli di avvio automatici

Ogni avvio usa un database SQLite temporaneo distinto, che viene rimosso dopo l'arresto del processo. I controlli verificano:

- `/api/health` restituisce `200` e `status: ok`.
- La pagina iniziale production viene servita come HTML.
- I quattro asset locali referenziati, inclusi JavaScript, CSS e favicon, sono disponibili.
- I dieci moduli del runtime story e `standalone.js` vengono serviti senza fallback HTML.
- Un asset inesistente restituisce `404`.
- Il database contiene esattamente le 107 migrazioni del journal.

Per il binario standalone, il frontend è collocato in `public` accanto all'eseguibile, come previsto da `cli/build.py`; entrambe le directory migrazioni sono presenti.

La prova delle dipendenze production usa una copia distinta con `npm ci --omit=dev --ignore-scripts --offline`, limitata a backend, shared e radice: 930 pacchetti installati dalla cache. Sorgente e bundle si avviano da questa copia senza ricorrere ai `node_modules` dell'ambiente di sviluppo. Il lockfile è rimasto invariato.

## Artefatti e warning

- Frontend: circa 35 MB su disco; il chunk principale misura 8.234,23 kB, 2.377,63 kB gzip. Vite segnala chunk oltre 500 kB: resta un tema concreto di prestazioni da valutare separatamente.
- Runtime story standalone: 1.956.889 byte.
- Bundle backend: 2.306.714 byte; worker codemode: 5.325 byte.
- Binario Linux standalone: 193.067.184 byte.
- Presenti warning sulle direttive `use client` ignorate e sui selettori CSS `::highlight`. I selettori risultano conservati nel CSS generato. Nessun errore di build.

Hash SHA-256 e log delle prove sono conservati tra gli artefatti temporanei locali. Nessuna verifica GUI manuale eseguita.

Questa verifica copre gli artefatti JavaScript e l'avvio backend. Non è stata ricostruita l'intera immagine Docker comprensiva del sidecar Python, né eseguito un aggiornamento su copie dei database distribuiti. Restano i controlli finali del repository e la prova di upgrade sui dati reali copiati. Nessun commit di merge o push eseguito.
