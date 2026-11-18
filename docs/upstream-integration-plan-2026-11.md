# Piano di integrazione upstream — novembre 2026

> Analisi storica del 5 novembre. Il riferimento operativo aggiornato è [la rianalisi del 15 novembre](upstream-integration-plan-2026-11-15.md), che sostituisce target, conteggi e piano di verifica di questo documento.

Analisi aggiornata il 5 novembre 2026 sui riferimenti ottenuti con il fetch del 4 novembre. Le conclusioni sono riferite agli SHA sotto; un successivo fetch può cambiare conteggi e conflitti.

## Stato e perimetro

| Riferimento             | Commit     | Data commit      |
| ----------------------- | ---------- | ---------------- |
| Fork: `dev/aiknow`      | `26824f20` | 24 ottobre 2026  |
| Target: `upstream/main` | `8bd23bfd` | 4 novembre 2026  |
| Base comune             | `e9d86441` | 9 settembre 2026 |

- Working tree inizialmente pulito; `dev/aiknow` allineato a `origin/dev/aiknow`.
- Remote upstream: `https://github.com/getnao/nao.git`.
- Divergenza topologica: 41 commit esclusivi del fork e 325 esclusivi upstream. Nel fork esistono commit con titoli ripetuti da integrazioni precedenti: 41 non equivale a 41 funzionalità indipendenti.
- Rispetto alla base comune: 171 file cambiati nel fork, 2.028 upstream; 90 percorsi modificati da entrambi.
- `git merge-tree --write-tree --name-only dev/aiknow upstream/main` termina con conflitti, senza modificare branch, indice o working tree. Tree simulato: `023cd2512d36c9817b973f1d6c0dd25fcc2bdd64` (contiene conflitti, non utilizzabile come risultato finale).
- Nessun branch di integrazione creato, nessun merge reale o push eseguito durante questa analisi.

## Conflitti rilevati

| Area                                           | File in conflitto | Osservazioni                                                |
| ---------------------------------------------- | ----------------: | ----------------------------------------------------------- |
| Backend, inclusa FastAPI e metadata migrazioni |                22 | Autenticazione, agente, query, modelli, assets              |
| Frontend                                       |                11 | Login, citazioni, sidebar, usage, configurazione Vite       |
| Shared                                         |                 1 | `chart-builder.tsx`                                         |
| CLI                                            |                 1 | Test dipendenze                                             |
| `example/`                                     |                20 | Modify/delete: il fork elimina file che upstream modifica   |
| Root e toolchain                               |                 5 | `.gitignore`, `.nvmrc`, `AGENTS.md`, due package file       |
| Totale                                         |                60 | I conflitti testuali non coprono tutti i problemi semantici |

I numeri di righe aggiunte non sono una stima del lavoro: includono lockfile e snapshot generati. Non risolvere interi file applicando indiscriminatamente `ours` o `theirs`.

## Priorità 0: continuità delle migrazioni

Nel fork la sequenza finale è `0064_context_assets`, `0065_irrifarm_identity`, `0066_add_mattermost`. Upstream mantiene `0064_add_mattermost`, poi aggiunge `0065_user_groups` e `0066_notification_system`, fino a `0095_test_run_reasoning_effort`.

La simulazione unisce automaticamente entrambi i journal, lasciando gli indici 65 e 66 duplicati. I quattro snapshot 0065/0066 sono invece conflitti add/add. Anche lo snapshot 0064 e gli schemi risultanti richiedono revisione, benché non tutti compaiano tra i conflitti.

Il migratore Drizzle installato confronta il timestamp `created_at` dell'ultima migrazione con `folderMillis`; rinominare soltanto i file non risolve la compatibilità. Non riscrivere alla cieca timestamp o SQL già applicati: si rischiano salti di migrazioni oppure riesecuzioni di DDL.

Proposta da validare prima del merge:

1. Inventariare, tramite export mirato su copia dei database di destinazione, schema e registro `__drizzle_migrations`; non servono dati applicativi per questa prima verifica.
2. Conservare la storia già distribuita del fork. Definire una sequenza univoca per le nuove migrazioni upstream, con journal e snapshot coerenti per SQLite e PostgreSQL. Documentare la mappatura dai nomi upstream, per facilitare i merge futuri.
3. In alternativa, valutare una riconciliazione esplicita verso la sequenza upstream soltanto se è possibile dimostrarla compatibile con tutti i database da aggiornare. Non scegliere questa alternativa solo per ridurre i conflitti Git.
4. Provare creazione da zero, aggiornamento da database fork, seconda esecuzione senza effetti e conservazione di identità Irrifarm, assets, utenti, chat e configurazioni. Coprire entrambi i motori se entrambi sono distribuiti/supportati.

Il controllo `db:check-migrations` confronta directory, corrispondenza migrazioni/snapshot e schemi; non sostituisce una prova reale di aggiornamento e va affiancato a controlli di unicità degli indici, timestamp e catena degli snapshot.

## Priorità 0: autorizzazioni e tutti i percorsi SQL

Upstream introduce permessi di gruppi, accesso a file e tabelle, row-level security e un servizio centrale `apps/backend/src/services/warehouse-sql.service.ts` per esecuzione e validazione SQL. Il fork passa oggi `allowed_mbo_sns` direttamente a FastAPI da più punti personalizzati.

La risoluzione deve comporre i vincoli: le autorizzazioni Irrifarm e quelle dei gruppi devono restringere entrambe il risultato. Nessuna delle due deve sostituire l'altra.

- Trasportare lo scope MBO nel nuovo contesto dell'agente e nel servizio warehouse comune; preservare la distinzione tra `null` (identità Irrifarm assente) e `[]` (nessun MBO autorizzato).
- In FastAPI comporre scoping MBO, permessi sulle tabelle, RLS, esclusione colonne e guardrail prima dell'esecuzione. Verificare il medesimo contratto anche su `/validate_sql`.
- Preservare timeout, limite righe e intervallo temporale richiesto per la telemetria; mantenere `applied_limit` nella risposta e nel rendering al modello. Il contratto upstream `WarehouseSqlResult` attualmente non lo include.
- Verificare chat, `ask_nao`, query semantiche compilate, refresh delle live story, filtri, automazioni e percorsi delegati all'agente. L'upstream ha aggiunto codemode e subagent: inventariarne i punti di ingresso ai tool prima di dichiarare completa la copertura.
- Verificare separatamente query su file locali, risultati precedenti e cache condivise: non assumere che il solo controllo al warehouse protegga ogni riuso dei dati.
- Il prompt Irrifarm e il classificatore di pertinenza del progetto vanno reinseriti nel nuovo ciclo dell'agente, che ora include profili e nuova compaction. Il prompt resta un aiuto al comportamento, non il controllo di autorizzazione.

Test di accettazione: scope vuoto, singolo MBO, molti MBO, tabella non classificata, join, CTE, tentativo di bypass, combinazione MBO/RLS, limite e timeout; stessi vincoli nei diversi canali. Verificare che il refresh o la condivisione di una story non allarghi l'accesso rispetto all'identità prevista dal prodotto.

## Priorità 1: SSO e sessioni Irrifarm

`auth.ts` confligge; upstream aggiunge sincronizzazione gruppi SSO, scadenza sessioni, selezione organizzazione, onboarding e verifica email. Il plugin Irrifarm è un file locale aggiunto, quindi la sua compatibilità non viene garantita dal merge automatico.

- Conservare handoff, account provider `irrifarm`, identità e iscrizione al progetto previsto.
- Provare login iniziale e successivo, aggiornamento scope e comportamento delle sessioni già esistenti.
- Integrare i controlli upstream su utenti disattivati e membership; verificare esplicitamente la compatibilità del plugin con i nuovi hook di creazione sessione.
- Mantenere accessi demo/test protetti e disabilitati fuori dagli ambienti previsti.
- Verificare che email sintetiche `@users.invalid` non attivino invii o flussi di verifica indesiderati.

## Priorità 1: modelli e reasoning

Upstream risolve ora i modelli attraverso una lista ordinata di sorgenti: configurazione DB, `nao_config.yaml`, ambiente, modelli gestiti nao. Include default di chat e background e supporto del parametro `model` in `ask_nao`.

Il fork aggiunge default di progetto, modelli Azure e opzioni di reasoning. Conviene adottare l'architettura upstream e trasferire solo i comportamenti mancanti, evitando di ripristinare le vecchie funzioni in blocco.

Matrice richiesta: configurazione presente in una o più sorgenti, precedenze, modello esplicito/default, modello non più abilitato, provider personalizzato/Azure, reasoning e budget token, chat/MCP/test/background. I test locali esistenti sono una baseline, non la prova che upstream sia già equivalente.

## Priorità 1: assets, citazioni e branding

- Preservare endpoint e tabella context assets, rendering immagini/PDF e normalizzazione dei percorsi wiki.
- Integrare con le nuove restrizioni di accesso ai file upstream: autorizzazione su endpoint assets e PDF, isolamento tra progetti e protezione dei percorsi.
- Riconciliare la logica delle citazioni con streaming, nuovi artifact e query result paginati; l'upstream aggiunge anche riparazioni dei marker di citazione.
- Conservare il branding Irri AI sfruttando le opzioni white-label upstream dove equivalenti.
- Ricontrollare precisione dei costi piccoli e presentazione degli utenti Irrifarm nella nuova pagina usage.
- La verifica frontend resta automatizzata; nessuna verifica GUI manuale, come richiesto da `AGENTS.md`.

## Priorità 2: runtime, dipendenze, packaging ed esempio

- Fork: Node `24.22.1`; upstream: `.nvmrc` ed engines su `22.23.4`, ma Docker base su `node:24-slim`. Proposta: preservare il pin esplicito 24.22.1 del fork durante l'integrazione, allineando tutti i manifest e la CI, e validarne la compatibilità con le nuove dipendenze.
- npm richiesto: `11.10.1`; ambiente rilevato: `11.19.1`. Prima di rigenerare i lockfile utilizzare la versione dichiarata. Esistono sia `package-lock.json` sia `bun.lock`; Docker usa Bun, quindi verificare entrambi.
- Upstream dichiara ora `packaging>=21.3` come dipendenza core Python: rivalutare il workaround Docker locale, conservando comunque le prove di import di MySQL/ibis e il supporto SSL.
- Conservare e verificare Azure Pipelines, entrypoint, variabili e build CLI; un Dockerfile unito automaticamente non è necessariamente funzionante.
- L'esempio Jaffle Shop è stato eliminato dal fork, ma upstream aggiunge nuovo contenuto e flussi di onboarding che usano l'esempio. Decidere esplicitamente se ripristinarlo o continuare a escluderlo, verificando i riferimenti a runtime e nel packaging. Una semplice cancellazione dei 20 conflitti può lasciare una directory parziale.
- Upstream separa `LICENSE-ENTERPRISE`: leggere la modifica e mappare le feature effettivamente utilizzate prima della distribuzione. Questa analisi non determina diritti o condizioni di licenza.

## Strategia Git proposta

Usare un branch dedicato da `dev/aiknow`, per esempio `integration/upstream-november-2026`, mantenendo la storia tramite merge. Il branch di settembre è già antenato di `dev/aiknow`; ripartire da lì perderebbe le personalizzazioni successive come base di lavoro.

1. Fissare baseline e target SHA; registrare la matrice delle funzionalità da preservare e la decisione sulle migrazioni.
2. Creare il branch da `26824f20`. Preparare eventuali test di contratto mancanti in commit separati prima del merge.
3. Avviare `git merge --no-commit --no-ff 8bd23bfd` sul branch dedicato. Risolvere nell'ordine: migrazioni/schema, contesti e autorizzazioni, servizio SQL/FastAPI, auth, modelli, assets/frontend, toolchain/esempio.
4. Completare il merge commit soltanto quando il risultato è coerente e supera i controlli. Evitare commit intermedi contenenti marker o un albero parzialmente risolto.
5. Separare in commit successivi eventuali refactor e correzioni aggiuntive; aprire una PR verso `dev/aiknow` con comportamento risultante e prove di aggiornamento DB.
6. Distribuire prima in staging su copia del database, con backup e ripristino verificati; il ritorno al vecchio codice non implica che lo schema aggiornato sia retrocompatibile.

Preferenza iniziale: merge diretto al target fissato. Un passaggio intermedio per fine settembre può aiutare a diagnosticare permessi/RLS, ma aggiunge una seconda integrazione e relativa validazione; utilizzarlo solo se il merge diretto diventa troppo difficile da isolare.

## Verifiche effettuate sulla baseline del fork

| Controllo                                                                                                          | Risultato                                                                                    |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `npm.cmd run lint`                                                                                                 | Passa; 2 warning backend esistenti: import `Link` inutilizzato e ordine import del migratore |
| Backend: `irrifarm-agent-context`, `answer-quality`, `inference-options`, `project-available-models`, `nao-config` | 5 file, 105 test passati                                                                     |
| `cli/.venv/Scripts/python.exe -m pytest apps/backend/fastapi/test_irrifarm_scope.py -q`                            | 16 test passati; warning di scrittura della cache pytest                                     |

Vitest inizialmente bloccato dai permessi sandbox di esbuild; stessa selezione rieseguita con successo fuori dalla sandbox. In PowerShell usare gli eseguibili `.cmd` disponibili: i wrapper `.ps1` sono bloccati dall'execution policy locale.

Non ancora eseguiti: intera suite backend/frontend, build, lint Python completo, controllo migrazioni, aggiornamento DB reale, Docker. Nessun risultato dei test sopra valida il tree simulato, che contiene ancora conflitti.

Per l'integrazione completa: lint JS/TS, format check, suite backend e frontend (nel fork sono presenti test frontend, nonostante la nota storica in AGENTS), build frontend/backend secondo gli script finali, lint CLI/Python, test FastAPI, controllo migrazioni, installazione da lockfile e build/smoke Docker MySQL. Aggiungere prove automatiche sui percorsi di autorizzazione e sugli aggiornamenti DB descritti sopra.

## Informazioni ancora da fissare

- Motori DB e versioni del fork effettivamente distribuite; stato delle migrazioni per ciascun ambiente.
- Comportamento desiderato per scope aggiornato durante una sessione e per story condivise/refresh pianificati.
- Necessità del progetto esempio e uso effettivo di cloud, billing e funzionalità enterprise nel deployment Irrifarm.

Questi punti condizionano l'implementazione e il rollout, ma non impediscono la preparazione del branch e dei test di contratto.
