# Dashboard PV ECharts — pipeline automatica

Questa versione non usa Flourish. La dashboard si aggiorna da due file sorgenti:

1. `Fotovoltaico_Aggregatore.xlsx`, lasciato nella sua cartella originale.
2. `input/report_salesforce.xlsx`, esportato da Salesforce e sostituito quando serve.

## Percorsi

Il file di configurazione è:

```text
config/paths.json
```

Contenuto principale:

```json
{
  "aggregatore_path": "C:/Users/anzillotti/OneDrive - Alayan Italia/Alayan Fotovoltaico/Aggregatori/Fotovoltaico_Aggregatore.xlsx",
  "report_salesforce_path": "input/report_salesforce.xlsx",
  "output_master_path": "output/Mappa_progetti_clienti_filiali.xlsx",
  "output_audit_path": "output/audit_abbinamenti.xlsx",
  "dashboard_json_path": "data/dashboard.json"
}
```

Se il percorso reale dell'aggregatore è diverso, modifica solo `aggregatore_path`.
Usa `/` anche su Windows: evita problemi di escape nei file JSON.

## Uso operativo

1. Aggiorna normalmente l'aggregatore nella sua cartella originale.
2. Esporta il report Salesforce.
3. Copialo in:

```text
input/report_salesforce.xlsx
```

4. Lancia:

```text
aggiorna_dashboard.bat
```

5. Controlla `index.html`.
6. Fai commit/push con GitHub Desktop.

## Cosa genera il BAT

Il BAT esegue due script:

```text
scripts/build_master_from_sources.py
scripts/build_dashboard_data.py
```

Output generati:

```text
output/Mappa_progetti_clienti_filiali.xlsx
output/audit_abbinamenti.xlsx
data/dashboard.json
```

## File master generato

`output/Mappa_progetti_clienti_filiali.xlsx` contiene:

- `Mappa progetto-cliente`
- `Filiali diverse`
- `Stessa filiale`
- `Flussi filiali`
- `Sintesi`
- `Province cantieri`
- `Province clienti`

## Audit matching

`output/audit_abbinamenti.xlsx` serve a verificare il matching tra:

```text
Aggregatore[Cliente]
Salesforce[Nome account]
```

Se un cliente non viene trovato, compare nel foglio `Da verificare`.

## Alias manuali

Gli alias sono nel file `config/paths.json`:

```json
"manual_aliases": {
  "ECOGREEN": "ECO GREEN",
  "ENERGY4U": "ENERGY4U ABBREVIATO E4U"
}
```

Se in futuro trovi un falso mancato match, aggiungi qui la coppia di nomi.

## Clienti esclusi

Nel file `config/paths.json` è presente:

```json
"excluded_clients": ["skynrg srl", "t.e.a.. gest srl"]
```

Questi clienti/progetti vengono esclusi dal master e dalla dashboard.

## OneDrive

Assicurati che l'aggregatore sia disponibile localmente, non solo online.
In Esplora File deve avere la spunta verde. Se vedi solo la nuvoletta:

```text
Tasto destro sul file → Conserva sempre su questo dispositivo
```

## Pubblicazione GitHub Pages

Dopo il BAT, fai commit/push di:

```text
index.html
assets/
data/dashboard.json
scripts/
config/
output/   opzionale, utile per controllo e audit
```

La dashboard legge `data/dashboard.json`.

<!-- MAINTENANCE-STANDARD:START -->
## Manutenzione repository

- Stato operativo: `CURRENT_STATE.md`
- Istruzioni per ChatGPT/Codex: `AGENTS.md`
- Storico modifiche: `CHANGELOG.md`
- Controllo pre-pubblicazione: `.\scripts\check_before_publish.ps1`

Comando consigliato prima del commit:

`powershell
.\scripts\check_before_publish.ps1
git status
git diff --check
`
<!-- MAINTENANCE-STANDARD:END -->
