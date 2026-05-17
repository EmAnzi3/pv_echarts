from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

LEGAL_STOPWORDS = {
    "SRL", "S", "R", "L", "SPA", "SAPA", "SAS", "SNC", "COOP", "SOC", "SOCIETA",
    "RESPONSABILITA", "LIMITATA", "PER", "AZIONI", "UNIPERSONALE", "UNIP", "ITALIA",
    "ITALY", "IN", "FORMA", "ABBREVIATA", "ABBREVIATO", "E", "THE", "COMPANY", "ENERGIA",
}


def strip_accents(value: str) -> str:
    return unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode("ascii")


def normalize_company_name(value: str) -> str:
    """Normalize company names for deterministic matching.

    The goal is not to create a legal-name parser; it is to remove the common noise
    that usually blocks matches between the PV aggregator and Salesforce export.
    """
    if value is None:
        return ""
    s = strip_accents(str(value)).upper().strip()
    s = re.sub(r"[’'`´]", " ", s)
    s = re.sub(r"[^A-Z0-9]+", " ", s)
    tokens = [t for t in s.split() if t and t not in LEGAL_STOPWORDS]
    return " ".join(tokens)


def similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def yes_no_same(a: str, b: str) -> str:
    return "STESSA FILIALE" if str(a).strip().lower() == str(b).strip().lower() else "FILIALE DIVERSA"


def clean_text(value) -> str:
    if value is None:
        return ""
    s = str(value).strip()
    if s.lower() in {"nan", "none", "nat"}:
        return ""
    return re.sub(r"\s+", " ", s)
