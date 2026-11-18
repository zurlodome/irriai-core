# Upgrade su copie dei database applicativi locali

Data: 18 novembre 2026. Branch: `integration/upstream-november-2026`.

## Esito

Upgrade, conservazione dati, riesecuzione, ripristino e confronto dello schema passati per entrambe le sorgenti applicative locali disponibili. Nessuna modifica al codice applicativo o alle migrazioni è stata necessaria in questo step.

| Controllo                                             | SQLite                   | PostgreSQL 16                          |
| ----------------------------------------------------- | ------------------------ | -------------------------------------- |
| Sorgente                                              | `apps/backend/db.sqlite` | Volume `irriai-core_nao_postgres_data` |
| Storia iniziale registrata                            | 69 migrazioni            | 51 migrazioni                          |
| Nuove migrazioni applicate                            | 40                       | 57                                     |
| Storia finale registrata                              | 109 migrazioni           | 108 migrazioni                         |
| Conservazione righe e valori esistenti                | Passata                  | Passata                                |
| Conversione citazione singola in lista                | Passata                  | Passata                                |
| Riesecuzione senza modifiche                          | Passata                  | Passata                                |
| Schema equivalente a installazione nuova              | Passata                  | Passata                                |
| Ripristino backup verificato                          | Passato                  | Passato                                |
| Sessione autenticata e lettura progetti/chat via HTTP | Passate                  | Passate                                |
| Lettura chat senza autenticazione                     | HTTP 401                 | HTTP 401                               |
| Risoluzione via API di una story storica              | Passata                  | Nessuna story nella sorgente           |
| Originale invariato dopo tutte le prove               | Verificato               | Verificato                             |

Le sorgenti hanno versioni differenti. SQLite conserva quattro utenti, un'organizzazione, un progetto, 607 chat, 1.862 messaggi, 11.750 parti messaggio, 333 asset, due identità Irrifarm, cinque story e sei versioni. PostgreSQL conserva un utente, un'organizzazione, un progetto, due chat, 14 messaggi, 47 parti messaggio, 23 asset e nessuna story. Il confronto copre tutte le tabelle esistenti, comprese configurazioni, account e sessioni; il report riporta soltanto conteggi ed esiti.

## Storia migrazioni effettivamente distribuita

Il journal corrente contiene 107 migrazioni canoniche. I database locali conservano anche registrazioni storiche aggiuntive: i totali finali 109 e 108 sono quindi corretti. Le registrazioni precedenti non sono state eliminate o riscritte.

- SQLite contiene l'intera baseline canonica `0000..0066` e due registrazioni storiche degli asset: timestamp `1782146400000`, identificato dal contenuto Git di `0050_context_assets.sql` (blob `89bfa08f27d689b9b3762b7863e1e844dab4db6f`), e timestamp `1784990439409`, con lo stesso SQL della migrazione canonica `0064_context_assets`.
- PostgreSQL contiene le migrazioni canoniche `0000..0049` e la vecchia `0050_context_assets.sql`, timestamp `1782146400000`, identificata dal blob Git `4011d598986284cb2bce369fd8609a6da8b90865`. Sono applicate le canoniche `0050..0106`, per un totale di 57 nuove registrazioni. La successiva creazione degli asset usa già istruzioni idempotenti e non richiede interventi manuali.
- Tutti gli hash delle migrazioni riconosciute per timestamp coincidono con i file correnti, accettando esclusivamente la differenza LF/CRLF.

Non è necessario forzare questi database a contenere esattamente 107 righe nella tabella delle migrazioni. Il controllo corretto considera la storia iniziale, le migrazioni canoniche mancanti e le registrazioni storiche identificate.

## Copie, isolamento e ripristino

SQLite è stato aperto in sola lettura e copiato tramite l'API backup di SQLite. L'upgrade usa un'ulteriore copia del backup. Un ripristino separato è stato confrontato con il backup, includendo la storia migrazioni e tutti i valori delle tabelle. `integrity_check` passa; nessuna violazione delle chiavi esterne prima o dopo l'upgrade.

Il volume PostgreSQL originale non era utilizzato da container in esecuzione. È stato montato in sola lettura, copiato preservando i permessi in un volume temporaneo e soltanto il clone è stato avviato con PostgreSQL 16. Dal clone è stato prodotto un dump custom, ripristinato in database distinti per upgrade e rollback. Il database di rollback coincide con la sorgente clonata per tutte le tabelle, inclusa la storia migrazioni. Il ripristino del database di upgrade è stato anche ripetuto prima della conferma finale.

I confronti dei contenuti usano fingerprint delle righe e verifiche mirate delle trasformazioni previste. Le colonne esistenti conservano i valori; la vecchia `chat_message.citation` viene convertita semanticamente in `citations`, come previsto dalla migrazione upstream. Per PostgreSQL il parser Drizzle è inizializzato prima di entrambe le letture, evitando di confrontare date JavaScript con stringhe timestamp.

Gli schemi finali sono stati confrontati con nuove installazioni delle 107 migrazioni correnti. SQLite coincide per colonne, indici e chiavi esterne di 95 tabelle applicative. PostgreSQL coincide per colonne/default, vincoli e indici; tutti i vincoli risultano validati.

Le prove hanno usato container senza porte pubblicate e senza accesso alla rete esterna. L'immagine locale `irriai-upstream-runtime-assets-check:20261117` fornisce Bun 1.4.4 e le dipendenze production già collaudate; le migrazioni del repository corrente sono montate in sola lettura. Le risorse Docker temporanee sono state rimosse e la loro assenza verificata. I backup e i risultati restano fuori dal repository.

## Verifiche applicative automatiche

Il backend è stato avviato su ulteriori copie aggiornate, separate da quelle usate per il confronto dei dati. Le sessioni temporanee sono create dall'adapter Better Auth esclusivamente su queste copie.

- Health HTTP 200 su entrambi i motori.
- Recupero della sessione autenticata e lista dei progetti dell'utente.
- Lettura via tRPC di una chat già presente, compresi i messaggi.
- Rifiuto HTTP 401 della lettura senza sessione.
- SQLite: risoluzione di una story storica con proprietario ricavato dalla chat; le story precedenti hanno `user_id` nullo, previsto dal resolver corrente.

Per questa prova è stato mantenuto il `BETTER_AUTH_SECRET` già configurato, senza stamparlo o copiarlo nel report. Il tentativo con un secret sostitutivo produceva HTTP 500 nel recupero della sessione; con il secret configurato, il recupero passa su entrambi i motori. Il rollout deve conservare tale configurazione insieme ai dati di autenticazione.

Le query warehouse con MBO/RLS e il sidecar sono già verificati nel report Docker del 17 novembre. In questo step le credenziali dei warehouse esterni non sono state utilizzate. Il login sul provider Irrifarm esterno e la verifica visiva dell'interfaccia restano prove dell'ambiente di rilascio, secondo le preferenze dei manutentori.

## Artefatti e limiti

Directory privata temporanea locale:

```text
C:\Users\zurlo\AppData\Local\Temp\irriai-real-db-check-7aa76b89-63c4-4c72-b82e-bdd4d65188e5
```

Contiene `sqlite-backup.sqlite`, `postgres-before.dump`, copie di ripristino, harness e risultati JSON. Contiene dati applicativi: non va aggiunta al repository o a un contesto di build Docker.

Impronte delle sorgenti verificate invariate prima e dopo le prove:

```text
SQLite SHA-256: e1e8633aeff16c80400a11197c5a59c455399b098564d2de5cf48a7f73ac187a
Volume PostgreSQL, fingerprint aggregato dei file: dbc0132b8aeb517101c3f3c48fcb8c8d028c56583b1367655cb8ed00d62bcbd5
Dump PostgreSQL SHA-256: 98ee018f1f685bf8eb07b17eb97798fd34f5a5b10c1a31ba8a0f79d5f4c8d63a
```

Il collaudo copre i database locali disponibili, non certifica la storia di eventuali installazioni esterne differenti. Per questo step l'immagine Docker è assunta valida come richiesto dall'utente; il limite della ricompilazione frontend documentato il 17 novembre non viene riaperto come requisito.

Resta la revisione finale del merge e il relativo commit. Nessun aggiornamento degli originali, deploy, commit di merge o push eseguito in questo step.
