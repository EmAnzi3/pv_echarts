@echo off
setlocal
cd /d "%~dp0"

echo.
echo === Aggiornamento dashboard PV ECharts ===
echo.

if not exist ".venv" (
  echo Creo ambiente virtuale Python...
  py -m venv .venv
)

call ".venv\Scripts\activate.bat"

echo.
echo Installo/aggiorno dipendenze...
python -m pip install --upgrade pip
pip install -r requirements.txt

if not exist "config\paths.json" (
  echo ERRORE: manca config\paths.json
  pause
  exit /b 1
)

if not exist "input\report_salesforce.xlsx" (
  echo ERRORE: manca input\report_salesforce.xlsx
  echo Copia il report esportato da Salesforce nella cartella input e rinominalo report_salesforce.xlsx.
  pause
  exit /b 1
)

echo.
echo 1/2 - Genero file master da Aggregatore + Report Salesforce...
python scripts\build_master_from_sources.py --config "config\paths.json"

if errorlevel 1 (
  echo.
  echo ERRORE: generazione file master non riuscita.
  echo Controlla il messaggio sopra, soprattutto percorso aggregatore e colonne dei file.
  pause
  exit /b 1
)

echo.
echo 2/2 - Genero dati dashboard...
python scripts\build_dashboard_data.py --config "config\paths.json"

if errorlevel 1 (
  echo.
  echo ERRORE: generazione dati dashboard non riuscita.
  pause
  exit /b 1
)

echo.
echo Dashboard aggiornata correttamente.
echo Apri index.html per il controllo, poi fai commit/push con GitHub Desktop.
echo.

git status
pause
