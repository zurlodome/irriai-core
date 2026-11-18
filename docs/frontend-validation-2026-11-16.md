# Verifica frontend del merge upstream

Data: 16 novembre 2026. Branch: `integration/upstream-november-2026`.

## Risultati

| Verifica                                                  | Passati   | Falliti | Saltati |
| --------------------------------------------------------- | --------- | ------- | ------- |
| Suite Windows iniziale, 222 file                          | 1.653     | 6       | 0       |
| Suite Linux completa, 222 file                            | 1.659     | 0       | 0       |
| Billing e valuta Windows dopo adattamento fixture, 4 file | 46        | 0       | 0       |
| Suite Windows finale, 222 file                            | **1.659** | **0**   | **0**   |
| Billing e valuta Linux con fixture aggiornato, 4 file     | 46        | 0       | 0       |

TypeScript frontend (`tsc --noEmit`, heap 8 GB) passa. Prettier e controllo whitespace dei file modificati passano. Il lint completo ha individuato anche un import fuori ordine nel test della tabella chat e un formatter inutilizzato: entrambi corretti. **La ripetizione completa di ESLint passa senza errori né warning.**

## Causa e correzione

I sei fallimenti iniziali sono concentrati nei test delle impostazioni billing e del wallet. Cercano numeri formattati in inglese americano, per esempio `$2,000` e `16.67%`, mentre `Intl.NumberFormat(undefined, ...)` usa la locale Windows dell'host. La suite Linux passa già prima di modificare il fixture.

Il helper condiviso `stubNumberFormatLocale` imposta il default `en-US` soltanto nei due file che asseriscono quelle stringhe. Una locale passata esplicitamente al formatter viene rispettata. Ogni test ripristina il costruttore originale in `afterEach`, evitando contaminazione dei worker condivisi.

La correzione della locale interessa soltanto tre file di test. La formattazione e la scelta della valuta nell'applicazione restano invariate. I test della selezione valuta per le diverse regioni e degli stati billing sono inclusi nelle 46 verifiche mirate.

La pulizia finale del lint riordina un import nel test della tabella chat ed elimina la vecchia costante `costFormatter`, che non veniva usata. La funzione attiva `formatCost` resta invariata; i tre test della tabella, inclusa la precisione dei costi inferiori a un centesimo, passano dopo la pulizia.

Una prima ripetizione Linux mirata ha superato il timeout in due casi mentre giravano anche TypeScript e l'intera suite Windows. La ripetizione isolata con un worker passa: 46 test, senza aumentare i timeout o modificare il codice.

## Ambiente e limiti

Suite Windows sull'ambiente locale; suite Linux nello stesso container isolato della verifica backend, con Node 24.22.1 e Vitest 4.1.12. Test Linux senza rete, senza `.env` locale e come utente non privilegiato. Il container `irriai-backend-validation-20261116` è nuovamente arrestato e disponibile per gli step successivi.

Nessuna verifica GUI manuale eseguita, secondo `AGENTS.md`. Restano separati i residui CLI, le build production e l'upgrade su copie dei database distribuiti. Nessun commit di merge o push eseguito.
