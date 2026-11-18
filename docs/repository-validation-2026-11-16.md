# Controlli finali del repository

Data: 16 novembre 2026. Branch: `integration/upstream-november-2026`.

Conferma finale del formato e dello stato Git: 17 novembre 2026. Il tentativo precedente era rimasto ineseguito per il limite di utilizzo della revisione automatica; la ripetizione è passata. Il motore Docker non è disponibile nella sessione del 17 novembre: le verifiche Linux e Compose riportate sotto sono quelle completate il giorno precedente.

## Esito dei controlli

| Controllo                                                      | Risultato                                 |
| -------------------------------------------------------------- | ----------------------------------------- |
| `npm run lint` globale, TypeScript ed ESLint dei tre workspace | Passato, senza warning                    |
| `npm run format:check` globale                                 | Passato                                   |
| CLI: ty, Ruff, ordinamento import e formato                    | Passati, 210 file                         |
| Forma canonica `package-lock.json`, npm 11.10.1                | Passata e stabile alla seconda esecuzione |
| Lockfile Bun congelato con Bun 1.4.4, Windows e Linux          | Passato, lock invariato                   |
| Integrità migrazioni SQLite/PostgreSQL                         | Passata                                   |
| Test backend dei moduli riformattati                           | 147 passati                               |
| Test integrazione system prompt Linux dopo formattazione       | 6 passati                                 |
| Configurazione Compose applicativa e PostgreSQL sviluppo       | Valida                                    |
| Conflitti Git e nuovi problemi whitespace rispetto a upstream  | Nessuno                                   |

Le verifiche Python equivalgono ai comandi del target `make lint`, eseguiti direttamente dagli strumenti della venv Windows. La forma canonica npm è verificata con la versione fissata, senza aggiornare npm globale. Non è stato eseguito un commit né l'hook come parte di un commit.

## Correzioni applicate

- I comandi Prettier escludono cache pytest e venv anche dalla scansione: ignorarle solo in `.prettierignore` non evitava l'errore di accesso alla directory cache su Windows.
- `endOfLine: auto` permette di controllare lo stile anche nel checkout CRLF Windows, senza riscrivere migliaia di file né alterare SQL e snapshot. Gli otto file con differenze effettive di stile sono stati formattati; rimossi anche due warning nei test backend.
- Corretti i tab non validi nel blocco ambiente di `docker-compose.yml`, conservando i valori configurati.
- Fissato Bun 1.4.4 in `engines`, Docker, CI e documentazione. Docker e pubblicazione installano ora con lock congelato. Bun 1.3.14 locale proponeva una risoluzione differente di alcuni SDK; Bun 1.4.4, già usato nelle build, accetta il lock esistente. La verifica Windows usa una copia temporanea del tool, senza aggiornare Bun globale.
- `package-lock.json` cambia soltanto per `engines.bun`: verificata l'identità di tutte le altre proprietà, versioni e integrità delle dipendenze. `bun.lock` non è stato modificato.
- Ripristinato il Compose PostgreSQL di sviluppo referenziato dagli alias `pg:*` ma assente anche nel target upstream. Gli alias fissano il progetto `irriai-postgres-dev`; volume `irriai-postgres-dev_postgres_dev_data` e porta predefinita 5433 sono distinti dalla configurazione applicativa. Validata anche la precedenza del progetto esplicito rispetto a `COMPOSE_PROJECT_NAME`. Nessun comando start, stop o reset dei database è stato eseguito.

## Stato Git e conservazione della storia

Il merge resta aperto sul target `08f1a42b620889b87d2222a77c5f700adefa43b5`. Nessuna voce non risolta nell'indice. Lo stash preparatorio `276d2bb7` è conservato.

I **268 file SQL e snapshot** delle prime 67 migrazioni di SQLite e PostgreSQL hanno gli stessi blob Git della base del fork `e15ecc06`, verificati senza normalizzare i contenuti. I test coprono anche la continuità dei journal.

Il controllo whitespace rispetto alla base del fork segnala 25 file importati da upstream, tutti identici al relativo blob del target: comprendono hard break Markdown e licenze. Non sono stati riscritti. Il controllo rispetto al target upstream e quello sulle correzioni di questo step non introducono nuovi errori whitespace.

Il piano storico di integrazione conserva il testo preesistente. Non sono stati aggiunti log, cache, binari compilati o database agli artefatti versionati di questo step.

## Lavoro successivo

Restano la build dell'immagine Docker completa con sidecar Python e la prova di aggiornamento su copie dei database effettivamente distribuiti. Rimangono le esclusioni già documentate nelle suite: screenshot senza Chrome, integrazioni esterne non configurate e casi specifici di piattaforma/provider. Nessun database applicativo aggiornato, commit di merge o push eseguito.
