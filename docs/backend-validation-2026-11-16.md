# Verifica backend del merge upstream

Data: 16 novembre 2026. Branch: `integration/upstream-november-2026`.

## Ambiente e isolamento

Verifica Linux in un container locale temporaneo con Node 24.22.1, Bun 1.4.4, Vitest 4.1.12 e dipendenze installate da `package-lock.json`. Il codice viene copiato sul filesystem Linux, senza usare i `node_modules` Windows. Git e il binding nativo `better-sqlite3` sono disponibili nel container.

I test girano come utente `node`, senza privilegi root, senza rete e senza copiare il `.env` locale. Questo permette di verificare realmente symlink, permessi Unix e lettura dei file tramite descriptor, senza disabilitare le protezioni. I database usati dai test sono temporanei.

## Correzioni

- Esploratore e skill restituiscono percorsi virtuali con `/` anche su Windows. Le aspettative già presenti nei test hanno evidenziato e verificato il problema.
- I test sugli owner confrontano il contenuto indipendentemente da CRLF/LF introdotti dal checkout Git; nessuna normalizzazione dei file applicativi.
- I test OAuth mantengono il contratto Irrifarm: senza allowlist di domini l'accesso viene negato. Nessun cambiamento alla politica applicativa.
- Il fixture Slack simula anche `auth.test` e `users.info` del client interno dell'adapter. I cinque test coinvolti passano senza chiamate HTTP reali.

## Risultati e diagnosi

- TypeScript backend: passato dopo le modifiche.
- ESLint, Prettier e controllo whitespace dei file modificati: passati.
- Header dei file su Windows: 8 test passati.
- Slack isolato su Windows: 5 test passati.
- Configurazione env su Windows: 13 test passati usando il vero eseguibile Bun nel `PATH`. `spawnSync('bun')` non avvia il wrapper npm `bun.cmd` senza shell.
- Prima suite completa Windows: 4.248 passati e 141 falliti, prima delle correzioni di questo step. Non interpretare questo risultato come una suite Windows ora completamente verde.
- Prima suite Linux: 4.227 passati, 155 falliti e 8 saltati. I fallimenti erano limitati a 9 file: Git mancava nell'immagine minima e i cinque test Slack usavano il vecchio fixture.
- Ripetizione dei 9 file dopo installazione Git e correzione fixture: **216 passati, zero fallimenti**.
- Conferma finale della suite Linux completa: **4.382 passati, zero fallimenti, 8 saltati**, 390 file, 105,66 secondi; exit code 0 e report `success: true`.

Gli otto test screenshot sono esclusi automaticamente dalla suite quando Chrome non è disponibile. Nessuna verifica GUI manuale eseguita.

Durante l'esecuzione compaiono warning `MaxListenersExceededWarning` nei worker condivisi; la suite termina senza errori. I problemi Windows di symlink, permessi Unix e descriptor sotto Node non sono stati risolti indebolendo i controlli: i relativi test passano nell'ambiente Linux.

Il container `irriai-backend-validation-20261116` è arrestato e conservato per riutilizzare ambiente e dipendenze nel prossimo step. I report JSON e i log sono conservati nella directory temporanea locale `irriai-backend-validation-8048f462-0741-4fa0-a387-5e9585e8c5d8`.

Comando della suite, dall'ambiente Linux predisposto:

```sh
cd /app/apps/backend
node /app/node_modules/vitest/vitest.mjs run --reporter=json --outputFile=/tmp/backend-linux-final-results.json
```

La verifica riguarda il backend. Frontend completo, tre residui CLI, build production e upgrade su copie dei database distribuiti restano step separati. Nessun commit di merge o push eseguito.
