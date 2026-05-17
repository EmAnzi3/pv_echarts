from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "config" / "paths.json"

CODE_TO_NAME = {
    'AG':'Agrigento','AL':'Alessandria','AN':'Ancona','AO':"Valle d'Aosta/Vallée d'Aoste",'AR':'Arezzo','AP':'Ascoli Piceno','AT':'Asti','AV':'Avellino','BA':'Bari','BT':'Barletta-Andria-Trani','BL':'Belluno','BN':'Benevento','BG':'Bergamo','BI':'Biella','BO':'Bologna','BZ':'Bolzano/Bozen','BS':'Brescia','BR':'Brindisi','CA':'Cagliari','CL':'Caltanissetta','CB':'Campobasso','CE':'Caserta','CT':'Catania','CZ':'Catanzaro','CH':'Chieti','CO':'Como','CS':'Cosenza','CR':'Cremona','KR':'Crotone','CN':'Cuneo','EN':'Enna','FM':'Fermo','FE':'Ferrara','FI':'Firenze','FG':'Foggia','FC':'Forlì-Cesena','FR':'Frosinone','GE':'Genova','GO':'Gorizia','GR':'Grosseto','IM':'Imperia','IS':'Isernia','AQ':"L'Aquila",'SP':'La Spezia','LT':'Latina','LE':'Lecce','LC':'Lecco','LI':'Livorno','LO':'Lodi','LU':'Lucca','MC':'Macerata','MN':'Mantova','MS':'Massa-Carrara','MT':'Matera','ME':'Messina','MI':'Milano','MO':'Modena','MB':'Monza e della Brianza','NA':'Napoli','NO':'Novara','NU':'Nuoro','OR':'Oristano','PD':'Padova','PA':'Palermo','PR':'Parma','PV':'Pavia','PG':'Perugia','PU':'Pesaro e Urbino','PE':'Pescara','PC':'Piacenza','PI':'Pisa','PT':'Pistoia','PN':'Pordenone','PZ':'Potenza','PO':'Prato','RG':'Ragusa','RA':'Ravenna','RC':'Reggio Calabria','RE':"Reggio nell'Emilia",'RI':'Rieti','RN':'Rimini','RM':'Roma','RO':'Rovigo','SA':'Salerno','SS':'Sassari','SV':'Savona','SI':'Siena','SR':'Siracusa','SO':'Sondrio','SU':'Sud Sardegna','TA':'Taranto','TE':'Teramo','TR':'Terni','TO':'Torino','TP':'Trapani','TN':'Trento','TV':'Treviso','TS':'Trieste','UD':'Udine','VA':'Varese','VE':'Venezia','VB':'Verbano-Cusio-Ossola','VC':'Vercelli','VR':'Verona','VV':'Vibo Valentia','VI':'Vicenza','VT':'Viterbo'
}

REQUIRED_MASTER_COLS = [
    'Cliente progetto','Cliente report abbinato','Progetto','Regione cantiere','Provincia cantiere',
    'Comune cantiere','Area cantiere','Filiale cantiere','Potenza MWp','Stato progetto','Fase attuale',
    'Indirizzo sede','Comune sede','Provincia sede','Filiale cliente','Tipo account','Esito filiale'
]


def resolve_path(path_value: str) -> Path:
    p = Path(path_value)
    if not p.is_absolute():
        p = ROOT / p
    return p


def load_config(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding='utf-8'))


def recs(frame: pd.DataFrame):
    frame = frame.copy()
    for c in frame.columns:
        if frame[c].dtype.kind in 'f':
            frame[c] = frame[c].round(3)
    return frame.fillna('').to_dict(orient='records')


def province_name(value: str) -> str:
    v = str(value).strip()
    return CODE_TO_NAME.get(v.upper(), v)


def build_data(xlsx_path: Path, omitted_clients=None):
    if not xlsx_path.exists():
        raise FileNotFoundError(f"File master non trovato: {xlsx_path}")
    df = pd.read_excel(xlsx_path, sheet_name='Mappa progetto-cliente')
    missing = [c for c in REQUIRED_MASTER_COLS if c not in df.columns]
    if missing:
        raise ValueError(f"Colonne mancanti nel file master: {missing}")

    df = df[df['Cliente progetto'].notna()].copy()
    df['Potenza MWp'] = pd.to_numeric(df['Potenza MWp'], errors='coerce').fillna(0)
    for c in df.columns:
        if df[c].dtype == 'object':
            df[c] = df[c].fillna('').astype(str).str.strip()

    same = int((df['Esito filiale'] == 'STESSA FILIALE').sum())
    diff = int((df['Esito filiale'] == 'FILIALE DIVERSA').sum())
    summary = {
        'projects': int(len(df)),
        'mwp': round(float(df['Potenza MWp'].sum()), 3),
        'same_branch': same,
        'different_branch': diff,
        'different_pct': round(float(diff / len(df) * 100), 1) if len(df) else 0,
        'omitted_clients': omitted_clients or []
    }

    flows = df.groupby(['Filiale cliente','Filiale cantiere'], dropna=False).agg(**{
        'N. progetti':('Progetto','count'),
        'MWp':('Potenza MWp','sum'),
        'Clienti unici':('Cliente progetto','nunique')
    }).reset_index().sort_values(['MWp','N. progetti'], ascending=False)

    prov_c = df.groupby(['Provincia cantiere','Regione cantiere'], dropna=False).agg(**{
        'N. progetti':('Progetto','count'), 'MWp':('Potenza MWp','sum'), 'Clienti unici':('Cliente progetto','nunique')
    }).reset_index().sort_values(['MWp','N. progetti'], ascending=False)

    df['Provincia sede nome'] = df['Provincia sede'].map(province_name)
    prov_s = df.groupby('Provincia sede nome', dropna=False).agg(**{
        'Clienti':('Cliente report abbinato','nunique'), 'Progetti':('Progetto','count'), 'MWp':('Potenza MWp','sum')
    }).reset_index().rename(columns={'Provincia sede nome':'Provincia'}).sort_values(['Clienti','MWp'], ascending=False)

    top_c = df.groupby('Filiale cantiere').agg(**{
        'N. progetti':('Progetto','count'), 'MWp':('Potenza MWp','sum'), 'Clienti unici':('Cliente progetto','nunique')
    }).reset_index().sort_values(['N. progetti','MWp'], ascending=False)

    top_cl = df.groupby('Filiale cliente').agg(**{
        'N. progetti':('Progetto','count'), 'MWp':('Potenza MWp','sum'), 'Clienti unici':('Cliente progetto','nunique')
    }).reset_index().sort_values(['N. progetti','MWp'], ascending=False)

    details = pd.DataFrame({
        'Cliente':df['Cliente progetto'], 'Cliente report':df['Cliente report abbinato'], 'Progetto':df['Progetto'],
        'Regione cantiere':df['Regione cantiere'], 'Provincia cantiere':df['Provincia cantiere'], 'Comune cantiere':df['Comune cantiere'],
        'Area cantiere':df['Area cantiere'], 'Filiale cantiere':df['Filiale cantiere'], 'Filiale cliente':df['Filiale cliente'],
        'Provincia sede':df['Provincia sede nome'], 'Comune sede':df['Comune sede'], 'Indirizzo sede':df['Indirizzo sede'],
        'Tipo account':df['Tipo account'], 'MWp':df['Potenza MWp'].round(3), 'Stato progetto':df['Stato progetto'],
        'Fase attuale':df['Fase attuale'], 'Esito':df['Esito filiale']
    })

    return {
        'summary': summary,
        'flows': recs(flows),
        'province_cantieri': recs(prov_c),
        'province_clienti': recs(prov_s),
        'top_cantiere': recs(top_c),
        'top_cliente': recs(top_cl),
        'heatmap_filiali': recs(flows),
        'treemap_geografica': recs(df[['Regione cantiere','Provincia cantiere','Comune cantiere','Cliente progetto','Progetto','Potenza MWp']]),
        'treemap_filiali': recs(df[['Filiale cliente','Filiale cantiere','Cliente progetto','Progetto','Potenza MWp']]),
        'details': recs(details)
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--config', default=str(DEFAULT_CONFIG))
    ap.add_argument('--input', default=None)
    ap.add_argument('--output', default=None)
    args = ap.parse_args()

    cfg = load_config(resolve_path(args.config))
    input_path = resolve_path(args.input or cfg.get('output_master_path', 'output/Mappa_progetti_clienti_filiali.xlsx'))
    output_path = resolve_path(args.output or cfg.get('dashboard_json_path', 'data/dashboard.json'))
    omitted = cfg.get('excluded_clients', []) or []

    data = build_data(input_path, omitted_clients=omitted)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"OK: scritto {output_path} con {data['summary']['projects']} progetti")
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERRORE: {exc}", file=sys.stderr)
        raise
