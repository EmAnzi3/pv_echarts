from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, Tuple

import pandas as pd

from utils_matching import clean_text, normalize_company_name, similarity, yes_no_same

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "config" / "paths.json"

PROJECT_REQUIRED = [
    "Filiale", "Area", "Cliente", "Progetto", "Regione", "Provincia", "Comune",
    "Potenza MWp", "Stato progetto", "Fase attuale"
]
REPORT_REQUIRED = [
    "Nome account", "Stato/Provincia fatturazione", "Tipo",
    "Indirizzo fatturazione (riga 1)", "Città fatturazione", "CAP fatturazione",
    "Filiale di Riferimento"
]


def resolve_path(path_value: str) -> Path:
    p = Path(path_value)
    if not p.is_absolute():
        p = ROOT / p
    return p


def load_config(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Config non trovato: {path}")
    cfg = json.loads(path.read_text(encoding="utf-8"))
    return cfg


def check_file(path: Path, label: str) -> None:
    if not path.exists():
        raise FileNotFoundError(
            f"{label} non trovato: {path}\n"
            "Controlla config/paths.json oppure la disponibilità locale del file OneDrive."
        )


def read_aggregatore(path: Path) -> pd.DataFrame:
    # Foglio Progetti con intestazioni in riga 4, coerente con l'aggregatore creato finora.
    df = pd.read_excel(path, sheet_name="Progetti", header=3)
    missing = [c for c in PROJECT_REQUIRED if c not in df.columns]
    if missing:
        raise ValueError(f"Colonne mancanti nel foglio Progetti dell'aggregatore: {missing}")
    df = df[df["Cliente"].notna()].copy()
    # Pulisce righe vuote/placeholder
    df["Cliente"] = df["Cliente"].map(clean_text)
    df = df[df["Cliente"] != ""].copy()
    df["Potenza MWp"] = pd.to_numeric(df["Potenza MWp"], errors="coerce").fillna(0)
    for c in df.columns:
        if df[c].dtype == "object":
            df[c] = df[c].map(clean_text)
    return df


def read_report(path: Path) -> pd.DataFrame:
    df = pd.read_excel(path, sheet_name="Report")
    missing = [c for c in REPORT_REQUIRED if c not in df.columns]
    if missing:
        raise ValueError(f"Colonne mancanti nel foglio Report Salesforce: {missing}")
    df = df[df["Nome account"].notna()].copy()
    for c in df.columns:
        if df[c].dtype == "object":
            df[c] = df[c].map(clean_text)
    return df


def build_report_index(report: pd.DataFrame) -> Dict[str, int]:
    # Se ci sono duplicati normalizzati, prende il primo ma lo segnaleremo nell'audit.
    idx: Dict[str, int] = {}
    for i, row in report.iterrows():
        key = normalize_company_name(row["Nome account"])
        if key and key not in idx:
            idx[key] = i
    return idx


def find_match(client_name: str, report: pd.DataFrame, report_index: Dict[str, int], aliases: dict) -> Tuple[int | None, str, float, str]:
    raw_norm = normalize_company_name(client_name)
    alias_target = None
    for source, target in aliases.items():
        if normalize_company_name(source) == raw_norm:
            alias_target = normalize_company_name(target)
            break

    keys_to_try = []
    if alias_target:
        keys_to_try.append(alias_target)
    keys_to_try.append(raw_norm)

    for key in keys_to_try:
        if key in report_index:
            return report_index[key], "ALIAS" if key == alias_target else "ESATTO_NORMALIZZATO", 1.0, key

    # Match prudente: usa fuzzy solo sopra soglia alta, per evitare abbinamenti commercialmente sbagliati.
    best_i = None
    best_score = 0.0
    best_key = ""
    for rep_key, i in report_index.items():
        score = similarity(raw_norm, rep_key)
        if score > best_score:
            best_score = score
            best_i = i
            best_key = rep_key

    if best_i is not None and best_score >= 0.92:
        return best_i, "FUZZY_ALTO", round(best_score, 3), best_key

    return None, "NON_TROVATO", round(best_score, 3), best_key


def make_master(projects: pd.DataFrame, report: pd.DataFrame, cfg: dict) -> tuple[pd.DataFrame, pd.DataFrame]:
    aliases = cfg.get("manual_aliases", {}) or {}
    excluded = {normalize_company_name(x) for x in cfg.get("excluded_clients", []) or []}
    report_index = build_report_index(report)

    rows = []
    audit = []

    for _, p in projects.iterrows():
        cliente = clean_text(p.get("Cliente", ""))
        cliente_norm = normalize_company_name(cliente)
        is_excluded = cliente_norm in excluded
        match_i, match_type, score, best_key = find_match(cliente, report, report_index, aliases)

        if is_excluded:
            audit.append({
                "Cliente progetto": cliente, "Cliente normalizzato": cliente_norm,
                "Esito matching": "ESCLUSO_DA_CONFIG", "Score": "", "Miglior candidato": "",
                "Cliente report abbinato": ""
            })
            continue

        if match_i is None:
            audit.append({
                "Cliente progetto": cliente, "Cliente normalizzato": cliente_norm,
                "Esito matching": "NON_TROVATO", "Score": score, "Miglior candidato": best_key,
                "Cliente report abbinato": ""
            })
            continue

        r = report.loc[match_i]
        filiale_cantiere = clean_text(p.get("Filiale", ""))
        filiale_cliente = clean_text(r.get("Filiale di Riferimento", ""))

        rows.append({
            "Cliente progetto": cliente,
            "Cliente report abbinato": clean_text(r.get("Nome account", "")),
            "Tipo account": clean_text(r.get("Tipo", "")),
            "Progetto": clean_text(p.get("Progetto", "")),
            "Regione cantiere": clean_text(p.get("Regione", "")),
            "Provincia cantiere": clean_text(p.get("Provincia", "")),
            "Comune cantiere": clean_text(p.get("Comune", "")),
            "Area cantiere": clean_text(p.get("Area", "")),
            "Filiale cantiere": filiale_cantiere,
            "Potenza MWp": float(p.get("Potenza MWp", 0) or 0),
            "Probabilità": p.get("Probabilità", ""),
            "Stato progetto": clean_text(p.get("Stato progetto", "")),
            "Fase attuale": clean_text(p.get("Fase attuale", "")),
            "Indirizzo sede": clean_text(r.get("Indirizzo fatturazione (riga 1)", "")),
            "Comune sede": clean_text(r.get("Città fatturazione", "")),
            "CAP sede": clean_text(r.get("CAP fatturazione", "")),
            "Provincia sede": clean_text(r.get("Stato/Provincia fatturazione", "")),
            "Filiale cliente": filiale_cliente,
            "Esito filiale": yes_no_same(filiale_cantiere, filiale_cliente),
            "Tipo match": match_type,
            "Score match": score,
        })
        audit.append({
            "Cliente progetto": cliente, "Cliente normalizzato": cliente_norm,
            "Esito matching": match_type, "Score": score, "Miglior candidato": best_key,
            "Cliente report abbinato": clean_text(r.get("Nome account", "")),
            "Filiale cliente": filiale_cliente,
        })

    master = pd.DataFrame(rows)
    audit_df = pd.DataFrame(audit)
    return master, audit_df


def write_outputs(master: pd.DataFrame, audit: pd.DataFrame, master_path: Path, audit_path: Path) -> None:
    master_path.parent.mkdir(parents=True, exist_ok=True)
    audit_path.parent.mkdir(parents=True, exist_ok=True)

    with pd.ExcelWriter(master_path, engine="openpyxl") as writer:
        master.to_excel(writer, sheet_name="Mappa progetto-cliente", index=False)
        master[master["Esito filiale"] == "FILIALE DIVERSA"].to_excel(writer, sheet_name="Filiali diverse", index=False)
        master[master["Esito filiale"] == "STESSA FILIALE"].to_excel(writer, sheet_name="Stessa filiale", index=False)

        flows = master.groupby(["Filiale cliente", "Filiale cantiere"], dropna=False).agg(**{
            "N. progetti": ("Progetto", "count"),
            "MWp": ("Potenza MWp", "sum"),
            "Clienti unici": ("Cliente progetto", "nunique"),
        }).reset_index().sort_values(["MWp", "N. progetti"], ascending=False)
        flows.to_excel(writer, sheet_name="Flussi filiali", index=False)

        sintesi = pd.DataFrame([
            {"Voce": "Progetti/cantieri inclusi", "Valore": len(master)},
            {"Voce": "MWp totali", "Valore": master["Potenza MWp"].sum()},
            {"Voce": "Stessa filiale", "Valore": (master["Esito filiale"] == "STESSA FILIALE").sum()},
            {"Voce": "Filiale diversa", "Valore": (master["Esito filiale"] == "FILIALE DIVERSA").sum()},
        ])
        sintesi.to_excel(writer, sheet_name="Sintesi", index=False)

        master.groupby(["Provincia cantiere", "Regione cantiere"], dropna=False).agg(**{
            "N. progetti": ("Progetto", "count"),
            "MWp": ("Potenza MWp", "sum"),
            "Clienti unici": ("Cliente progetto", "nunique"),
        }).reset_index().sort_values(["MWp", "N. progetti"], ascending=False).to_excel(writer, sheet_name="Province cantieri", index=False)

        master.groupby(["Provincia sede"], dropna=False).agg(**{
            "Clienti": ("Cliente report abbinato", "nunique"),
            "Progetti": ("Progetto", "count"),
            "MWp": ("Potenza MWp", "sum"),
        }).reset_index().sort_values(["Clienti", "MWp"], ascending=False).to_excel(writer, sheet_name="Province clienti", index=False)

    with pd.ExcelWriter(audit_path, engine="openpyxl") as writer:
        audit.to_excel(writer, sheet_name="Audit matching", index=False)
        audit[audit["Esito matching"].isin(["NON_TROVATO", "ESCLUSO_DA_CONFIG"])].to_excel(writer, sheet_name="Da verificare", index=False)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    args = parser.parse_args()

    cfg_path = resolve_path(args.config)
    cfg = load_config(cfg_path)

    aggregatore_path = resolve_path(cfg["aggregatore_path"])
    report_path = resolve_path(cfg["report_salesforce_path"])
    master_path = resolve_path(cfg.get("output_master_path", "output/Mappa_progetti_clienti_filiali.xlsx"))
    audit_path = resolve_path(cfg.get("output_audit_path", "output/audit_abbinamenti.xlsx"))

    check_file(aggregatore_path, "Aggregatore")
    check_file(report_path, "Report Salesforce")

    projects = read_aggregatore(aggregatore_path)
    report = read_report(report_path)
    master, audit = make_master(projects, report, cfg)

    if master.empty:
        raise RuntimeError("Nessun progetto abbinato: controlla report, aggregatore o regole di matching.")

    write_outputs(master, audit, master_path, audit_path)

    total_projects = len(projects)
    included = len(master)
    not_found = int((audit["Esito matching"] == "NON_TROVATO").sum())
    excluded = int((audit["Esito matching"] == "ESCLUSO_DA_CONFIG").sum())
    same = int((master["Esito filiale"] == "STESSA FILIALE").sum())
    diff = int((master["Esito filiale"] == "FILIALE DIVERSA").sum())

    print("OK: file master generato")
    print(f"  Aggregatore: {aggregatore_path}")
    print(f"  Report Salesforce: {report_path}")
    print(f"  Progetti letti: {total_projects}")
    print(f"  Progetti inclusi/abbinati: {included}")
    print(f"  Clienti/progetti non trovati: {not_found}")
    print(f"  Esclusi da config: {excluded}")
    print(f"  Stessa filiale: {same}")
    print(f"  Filiale diversa: {diff}")
    print(f"  Output master: {master_path}")
    print(f"  Audit: {audit_path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERRORE: {exc}", file=sys.stderr)
        raise
