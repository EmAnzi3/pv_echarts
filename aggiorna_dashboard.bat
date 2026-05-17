@echo off
setlocal
cd /d "%~dp0"

echo.
echo === Aggiornamento dashboard PV ECharts ===
echo.

if not exist ".venv\Scripts\python.exe" (
    echo Creo ambiente virtuale Python...
    python -m venv .venv
)

if not exist ".venv\Scripts\python.exe" (
    echo.
    echo ERRORE: ambiente virtuale non creato.
    echo Verifica che Python sia installato e richiamabile con il comando python.
    pause
    exit /b 1
)

set "PYTHON_EXE=.venv\Scripts\python.exe"

echo.
echo Aggiorno pip e dipendenze...
"%PYTHON_EXE%" -m pip install --upgrade pip
"%PYTHON_EXE%" -m pip install -r requirements.txt

echo.
echo 1/2 - Genero file master da Aggregatore + Report Salesforce...
"%PYTHON_EXE%" scripts\build_master_from_sources.py

if errorlevel 1 (
    echo.
    echo ERRORE: generazione file master non riuscita.
    echo Controlla il messaggio sopra, soprattutto percorso aggregatore e colonne dei file.
    pause
    exit /b 1
)

echo.
echo 2/2 - Genero dati dashboard...
"%PYTHON_EXE%" scripts\build_dashboard_data.py

if errorlevel 1 (
    echo.
    echo ERRORE: generazione dashboard.json non riuscita.
    pause
    exit /b 1
)

echo.
echo Dashboard aggiornata correttamente.
echo Controlla index.html e poi fai commit/push con GitHub Desktop.
echo.

pause