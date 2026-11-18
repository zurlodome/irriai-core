# Integrazione upstream: rianalisi del 15 novembre 2026

> Lavorazione avviata su `integration/upstream-november-2026`: [stato delle attività e verifiche](upstream-integration-progress.md). Le sezioni seguenti descrivono l'analisi prima dell'avvio.

Questa analisi sostituisce il [piano del 5 novembre](upstream-integration-plan-2026-11.md). Si basa su `git fetch --all --prune` eseguito il 15 novembre e su una nuova simulazione del merge, senza cambiare branch, indice o codice applicativo.

## Stato verificato e confronto

| Dato                                      | Analisi precedente               | Situazione aggiornata                      |
| ----------------------------------------- | -------------------------------- | ------------------------------------------ |
| Fork `dev/aiknow`                         | `26824f20`                       | `e15ecc06377dca2334268528f10817c844328265` |
| Target `upstream/main`                    | `8bd23bfd`                       | `08f1a42b620889b87d2222a77c5f700adefa43b5` |
| Ultimo commit del fork                    | 24 ottobre                       | 5 novembre                                 |
| Ultimo commit upstream                    | 4 novembre                       | 15 novembre                                |
| Base comune                               | `e9d86441` del 9 settembre       | Invariata                                  |
| Commit esclusivi fork / upstream          | 41 / 325                         | 44 / 412                                   |
| File cambiati dal fork rispetto alla base | 171                              | 174                                        |
| File cambiati upstream rispetto alla base | 2.028                            | 2.668                                      |
| Percorsi modificati da entrambi           | 90                               | 93                                         |
| File in conflitto nella simulazione       | 60                               | 68                                         |
| Ultima migrazione upstream                | `0095_test_run_reasoning_effort` | `0104_shared_github_access_token`          |

`dev/aiknow` è allineato a `origin/dev/aiknow`. All'inizio della rianalisi `docs/` era già non tracciata, con il rapporto precedente. Non è stato creato alcun branch di integrazione, né eseguito un merge reale, commit o push.

Il delta upstream dal vecchio target contiene 87 commit. Il conteggio dei file include una riorganizzazione estesa dei test: non misura direttamente la complessità del codice nuovo.

## Nuovi commit del fork da preservare

| Commit     | Comportamento da conservare                                                                                                                                            | Implicazioni per il merge                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `b32ec94a` | Il project scope guard accetta analytics autorizzati su irrigazione, storico programmi e documentazione; rispetta `RULES.md` e distingue follow-up da domande estranee | Conservare il nuovo test `project-scope-guard.test.ts` e collegare il guard al nuovo ciclo/profili dell'agente |
| `0da27b0b` | Docker installa dipendenze production escludendo il workspace frontend                                                                                                 | Preservare lo stage `runtime-deps`, il lockfile congelato e i moduli locali backend/shared                     |
| `e15ecc06` | Dipendenze runtime esplicite: `glob`/`marked` backend e React/Recharts shared; smoke import di `@nao/shared`                                                           | Riconciliare manifest e lockfile con le nuove dipendenze upstream, poi provare l'immagine production           |

Queste correzioni rendono superata una ripartenza operativa da `26824f20`. Il branch proposto deve partire da `e15ecc06`.

## Nuova simulazione dei conflitti

Comando: `git merge-tree --write-tree --name-only dev/aiknow upstream/main`. Risultato previsto: exit code 1, con tree `c85b9cd06a8103848bdf36caf2e1492a62315ce9`. Il tree contiene marker e non costituisce un merge utilizzabile.

Il [rapporto JSON](upstream-merge-simulation-2026-11-15.json) conserva SHA completi, elenco dei 68 percorsi e messaggi Git.

| Area                                   | Prima | Ora |
| -------------------------------------- | ----: | --: |
| Backend, FastAPI e metadata migrazioni |    22 |  26 |
| Frontend                               |    11 |  12 |
| Shared                                 |     1 |   2 |
| CLI                                    |     1 |   2 |
| Esempio Jaffle Shop                    |    20 |  20 |
| Root e toolchain                       |     5 |   6 |
| Totale                                 |    60 |  68 |

Tutti i 60 conflitti precedenti restano. Si aggiungono:

- `apps/backend/package.json`
- `apps/backend/src/components/ai/system-prompt.tsx`
- `apps/backend/tests/project-available-models.test.ts`
- `apps/backend/tests/tools-paths.test.ts`
- `apps/frontend/tests/components/settings/chats-replay-table.test.tsx`
- `apps/shared/package.json`
- `bun.lock`
- `cli/tests/nao_core/config/test_starrocks.py`

## Priorità 0: migrazioni e database distribuiti

Il problema strutturale è confermato per SQLite e PostgreSQL: il fork conserva `0064_context_assets`, `0065_irrifarm_identity`, `0066_add_mattermost`; upstream ha `0064_add_mattermost`, `0065_user_groups`, `0066_notification_system`. Il merge automatico dei journal produce ancora indici 65 e 66 duplicati, senza segnalare un conflitto testuale nei journal stessi.

Upstream aggiunge nove migrazioni rispetto al vecchio target: deployed-at del progetto, citazioni dei messaggi, provenienza delle versioni story, cache opzioni dei filtri, trigger delle automazioni, trigger delle esecuzioni, editor multipli delle story, impostazioni menu e token GitHub condiviso.

Resta necessaria una strategia che conservi la storia già applicata del fork, riconcili nomi/indici/snapshot delle nuove migrazioni e tenga conto dei timestamp usati da Drizzle. La sola rinumerazione dei file o il superamento di `db:check-migrations` non dimostrano la correttezza dell'upgrade.

Prima del merge reale: inventario dello schema e del registro migrazioni degli ambienti da aggiornare, su copie o export mirati; prova di database vuoto, aggiornamento dal fork, seconda esecuzione e verifica dei dati conservati. Definire una mappatura esplicita delle migrazioni upstream per semplificare gli aggiornamenti futuri.

## Priorità 0: identità, scope MBO e cache delle story

Oltre a chat, MCP e refresh, ora esistono nuovi percorsi per SQL scritto dalle custom story (`custom-story-sql.ts`), filtri a cascata/semantici e opzioni dei filtri memorizzate nel database.

Evidenze lette nel codice upstream:

- `runCustomStorySql` costruisce il contesto con `target.viewerId`, quindi usa i permessi di chi visualizza la story.
- `createStoryExecutionContext(chatId, userId?)` accetta un'identità esplicita e usa il proprietario della chat quando non è passata.
- `story-filter-options.ts` calcola le opzioni con `createStoryExecutionContext(chatId)`; la cache è identificata da story e hash della sorgente. La sorgente contiene tabella/dimensione, database e condizioni dei filtri, senza identità o scope MBO.
- La lettura della cache può restituire opzioni senza eseguire nuovamente una query al warehouse; esistono refresh asincroni e warm-up.

Queste differenze richiedono una decisione e test di integrazione, non dimostrano da sole un accesso illecito nel deployment corrente: dipende anche da come la story viene autorizzata e condivisa. Per Irrifarm non basta applicare lo scope solo alla query SQL della chat.

Requisiti del merge:

1. Comporre scope MBO e permessi upstream su file/tabelle/RLS nel servizio warehouse comune e in FastAPI, preservando `null` distinto da `[]`, limiti, timeout e `applied_limit`.
2. Esplicitare l'identità d'esecuzione per query salvate, custom SQL, opzioni dei filtri, ricerca opzioni, preview, refresh, condivisioni e automazioni.
3. Per opzioni dipendenti dall'utente, progettare una cache che separi gli scope effettivi o disabilitarne il riuso tra scope differenti. Prevedere invalidazione al cambio dei permessi e comportamento sicuro dei refresh asincroni.
4. Testare due utenti con MBO disgiunti, cache fredda/calda, revoca di permessi e uso concorrente della stessa story. Includere query semantiche, filtri a cascata e dati già salvati/locali.

## Priorità 1: nuovo Context Hub e profili dell'agente

Il 13–15 novembre upstream amplia l'editor del contesto e introduce il Context Hub: navigazione dei documenti, chat di modifica, riferimenti cliccabili ai file e raccomandazioni. Cambiano anche sidebar, menu personalizzabili e pagine Inbox/Automations.

- Rivedere accesso ai file e alle operazioni di modifica insieme agli endpoint locali context assets/PDF: mantenere isolamento tra progetti e vincoli sui percorsi, senza reintrodurre letture tramite symlink.
- Preservare la correzione upstream `ffad5a5c` sui symlink e `5e4f1a34` sugli archivi deploy contenenti metadata Git.
- Il guard locale di pertinenza va applicato ai profili pertinenti al prodotto. Evitare di inserirlo indistintamente su flussi amministrativi/editor del contesto senza verificare il comportamento desiderato.
- Le custom story possono ora chiamare modelli tramite `useModel`/`useModels`. Il profilo `storyModelAgent` non dispone di tool e può usare un system prompt della story: testare default, reasoning, budget e corretta composizione delle regole locali anche in questo percorso, senza assumere che si comporti come la chat standard.

## Priorità 1: MCP, autenticazione, modelli e integrazioni

Le priorità precedenti restano valide: SSO Irrifarm e membership, identità/email sintetiche, scoping MBO, modelli Azure e priorità delle sorgenti, citazioni e branding.

Nuove verifiche specifiche:

- Conservare `ed8ad1e6` (#2428): `runAgentTool` accetta il contesto chat richiesto dal client solo se appartiene al chiamante e al progetto MCP; altrimenti esegue fuori dalla chat. Testare questo controllo anche dopo il porting dello scope Irrifarm.
- Conservare `eea7a3c6` (#2451), che restituisce gli errori SQL ai chiamanti MCP, e verificare che timeout/negazioni Irrifarm arrivino come errori utili.
- Integrare i nuovi flussi Entra ID per MSSQL/Azure SQL e le relative dipendenze/driver solo dove necessari, mantenendo il supporto MySQL/SSL locale.
- Rivedere il passaggio upstream a token GitHub condiviso (`8b1d8673` e migrazione 0104): verificare l'effetto sulle configurazioni e sui flussi Git esistenti.

## Toolchain e test: cambia anche la struttura

L'upstream ha riorganizzato i test (`bf6be79f`, #1931): backend in sottodirectory per area; molti test frontend sono spostati da `src/` a `tests/`. Il nuovo Vitest backend usa setup SQLite globale, fixture condivise e `isolate: false` con pulizia di mock, timer e ambiente.

I test locali aggiunti vanno collocati nelle directory coerenti e adattati al nuovo setup; un merge senza conflitto o una selezione col vecchio percorso non garantiscono che siano eseguiti. Verificare la raccolta dei test e l'assenza di dipendenze dall'ordine di esecuzione.

Il pin Node resta divergente: fork `24.22.1`, upstream `22.23.4`, Docker upstream ancora `node:24-slim`. npm dichiarato resta `11.10.1`. Per l'integrazione mantenere inizialmente il pin esplicito del fork, verificandolo contro le nuove dipendenze; rigenerare entrambi i lockfile con le versioni concordate e provare l'installazione production Docker.

Restano da decidere il destino dell'esempio Jaffle Shop e le feature upstream effettivamente attive nel deployment; mantenere i relativi controlli descritti nel rapporto precedente.

## Strategia operativa aggiornata

Il merge diretto rimane la prima opzione: l'incremento di otto conflitti non giustifica da solo due integrazioni complete. Il nuovo rischio principale riguarda i percorsi applicativi e la compatibilità dati, non il mero numero di marker.

1. Usare `integration/upstream-november-2026` da `e15ecc06`, fissando il target a `08f1a42b`. Non partire dai vecchi SHA del 5 novembre.
2. Definire strategia migrazioni e matrice identità/scope/cache prima del merge reale. Aggiungere test di contratto mancanti in commit preparatori separati.
3. Avviare `git merge --no-commit --no-ff 08f1a42b` sul branch dedicato; risolvere prima migrazioni/schema, contesti/warehouse/FastAPI e cache, poi auth/modelli/profili, assets/frontend e packaging.
4. Adattare i test al setup upstream e validare l'intero risultato prima del merge commit. Non scegliere interi file `ours`/`theirs` per evitare la revisione semantica.
5. PR verso `dev/aiknow`, staging su copia DB e prove di ripristino. Ogni fetch successivo richiede di verificare nuovamente il delta rispetto al target fissato.

## Verifiche del 15 novembre sulla baseline del fork

- 125 test backend passati in 6 file: `irrifarm-agent-context`, `answer-quality`, `inference-options`, `project-available-models`, `nao-config`, `project-scope-guard`.
- 16 test FastAPI/Python passati sullo scoping Irrifarm, eseguiti senza cache pytest.
- `npm.cmd run -w @nao/backend db:check-migrations`: passato.
- `npm.cmd run lint`: passato; restano i due warning backend già presenti su import `Link` inutilizzato e ordine degli import del migratore.

I test mirati Vitest sono stati eseguiti fuori dalla sandbox, necessaria a esbuild. Questi controlli riguardano esclusivamente `dev/aiknow`, non il merge simulato ancora conflittuale. Non sono stati eseguiti suite completa, build Docker, upgrade DB reale o verifiche GUI.
