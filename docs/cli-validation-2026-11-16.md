# Verifica CLI del merge upstream

Data: 16 novembre 2026. Branch: `integration/upstream-november-2026`.

## Risultati

- Suite CLI completa su Windows: **1.608 passati, zero fallimenti, zero errori, 262 saltati**, 1.870 casi, 34,47 secondi.
- Tre moduli interessati dalla diagnosi: 72 passati e un controllo POSIX saltato su Windows.
- `ty check`, `ruff check`, ordinamento import e `ruff format --check`: passati sull'intera CLI, 210 file controllati dal formatter.
- Prova POSIX separata su Linux: passata sul codice corrente, utente non privilegiato UID 1000, senza rete.

## Tre problemi risolti

### Resa Rich del messaggio di dipendenza mancante

Il terminale dell'ambiente dichiara `TERM=dumb`. Rich forza 80 colonne quando il fixture specifica solo la larghezza: il comando `uv pip install 'nao-core[anthropic]'` viene spezzato su due righe. Il messaggio non perde l'extra del provider.

Il test ora specifica entrambe le dimensioni del buffer, 200 per 25, e disabilita la modalità legacy Windows. Le asserzioni sui comandi restano invariate. Nessuna modifica alla resa del comando nell'applicazione.

### Permessi del file token

Il controllo dei bit POSIX `0600` è esplicitamente escluso su Windows, dove quei bit non descrivono le ACL. Il codice di salvataggio delle credenziali resta invariato.

La verifica Linux usa il file `auth.py` corrente montato in sola lettura, Python 3.12.13 nell'immagine locale e UID 1000. Con umask zero controlla creazione a `0600`, lettura del token, riscrittura di un file precedentemente permissivo (`0644`) riportandolo a `0600`, sostituzione del token e cancellazione. Tutte le asserzioni passano. Questa prova non verifica le ACL Windows.

### Metadata della dipendenza packaging

`packaging>=21.3` era già presente nel `pyproject.toml`, ma mancava nei metadata della vecchia installazione locale. Rigenerata l'installazione editable della CLI nella venv con `--no-deps`; nessun aggiornamento delle dipendenze applicative e nessuna modifica al lockfile. Il controllo sui metadata ora passa.

## Casi esclusi e limiti

Il report JUnit distingue:

- 256 casi per database esterni o stack locali non configurati.
- 3 casi per funzionalità non supportate dal provider.
- 2 casi symlink esclusi dalla piattaforma Windows.
- 1 controllo POSIX escluso su Windows e verificato separatamente su Linux.

Restano 24 warning di deprecazione nelle dipendenze, senza errori. Non sono state contattate le integrazioni esterne escluse né aggiornati database applicativi.

Le modifiche al repository di questo step riguardano soltanto due file di test. Restano separati build production, controlli finali del repository e upgrade su copie dei database distribuiti. Nessun commit di merge o push eseguito.
