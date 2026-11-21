"""Import d'un CV : un CV fabriqué par le site (chaque modèle, chaque langue) puis réimporté
doit remplir chaque champ du formulaire à la bonne place, sans rien mélanger."""
import json
import shutil
from pathlib import Path

import pytest

import importer
import moteur

RACINE = Path(__file__).resolve().parent.parent
CV = json.loads((RACINE / "web" / "exemple.json").read_text(encoding="utf-8"))
CV["certifications"] = [{"titre": "Certificat Sage Comptabilité", "organisme": "Sage Academy", "date": "2025"}]
CV["projets"] = [{"titre": "Tableau de bord de trésorerie", "dates": "2024", "details": "Suivi mensuel sous Excel pour 3 PME"}]
LISTES = {"experiences": ["poste", "entreprise", "lieu", "dates", "points"],
          "formations": ["diplome", "ecole", "dates", "details"],
          "competences": ["categorie", "liste"], "langues": ["langue", "niveau"],
          "certifications": ["titre", "organisme", "date"], "projets": ["titre", "dates", "details"],
          "references": ["nom", "fonction", "contact"]}

pytestmark = pytest.mark.skipif(not (shutil.which("pdflatex") and shutil.which("pdftotext")),
                                reason="LaTeX ou poppler absent")


def plat(valeur):
    return " ".join(str(valeur).replace("’", "'").split()).lower()


@pytest.mark.parametrize("langue", ["fr", "en", "it"])
@pytest.mark.parametrize("modele", ["moderne", "classique", "europeen", "africain", "elegant", "compact"])
def test_cv_du_site_reimporte_a_l_identique(modele, langue):
    lu = importer.importer(moteur.generer_cv(CV, {"modele": modele, "langue": langue}), "cv")["cv"]
    ecarts = [champ for champ in ("nom", "titre", "email", "telephone", "ville", "profil", "interets")
              if plat(lu[champ]) != plat(CV[champ])]
    ecarts += [f"etat_civil.{c}" for c, v in CV["etat_civil"].items() if plat(lu["etat_civil"].get(c, "")) != plat(v)]
    for liste, cles in LISTES.items():
        if len(lu[liste]) != len(CV[liste]):
            ecarts.append(f"{liste} : {len(lu[liste])} au lieu de {len(CV[liste])}")
            continue
        ecarts += [f"{liste}[{i}].{k} = {o.get(k)!r}" for i, (a, o) in enumerate(zip(CV[liste], lu[liste]))
                   for k in cles if plat(o.get(k, "")) != plat(a[k])]
    assert not ecarts, ecarts


# ---------------------------------------------------------------------------
# Cas rencontrés dans des CV d'autres sources
# ---------------------------------------------------------------------------
def test_titre_de_rubrique_suivi_d_une_date_garde_la_date():
    cv = importer.analyser_cv("Awa Exemple\nFORMATION\n2020 – 2023\nLicence en gestion\nUniversité Exemple")
    assert cv["formations"] == [{"diplome": "Licence en gestion", "ecole": "Université Exemple",
                                 "dates": "2020 – 2023", "details": ""}]


def test_categorie_de_competences_qui_ressemble_a_un_titre():
    cv = importer.analyser_cv("COMPÉTENCES\nComptabilité\nSYSCOHADA, TVA\nInformatique\nExcel, Sage")
    assert cv["competences"] == [{"categorie": "Comptabilité", "liste": "SYSCOHADA, TVA"},
                                 {"categorie": "Informatique", "liste": "Excel, Sage"}]


def test_telephone_des_references_pas_pris_pour_celui_du_candidat():
    cv = importer.analyser_cv("RÉFÉRENCES\nM. Diop, directeur – +221 77 111 11 11\n"
                              "CONTACT\n+221 70 222 22 22\nawa@exemple.org")
    assert cv["telephone"] == "+221 70 222 22 22"


@pytest.mark.parametrize("texte, attendu", [
    ("Cabinet Exemple, Dakar", {"entreprise": "Cabinet Exemple", "lieu": "Dakar"}),
    ("Orange Côte d'Ivoire, Abidjan", {"entreprise": "Orange Côte d'Ivoire", "lieu": "Abidjan"}),
    ("Société Exemple, SARL", {"entreprise": "Société Exemple, SARL", "lieu": ""}),
    ("Cabinet Exemple", {"entreprise": "Cabinet Exemple", "lieu": ""}),
    ("Banque, 12 rue Exemple", {"entreprise": "Banque, 12 rue Exemple", "lieu": ""}),
])
def test_employeur_et_lieu(texte, attendu):
    assert importer._employeur_et_lieu(texte) == attendu


def test_etat_civil_coupe_en_fin_de_ligne():
    cv = importer.analyser_cv("Awa Exemple\nNationalité : Sénégalaise | Situation matrimoniale\n"
                              ": Célibataire | Permis de conduire : B |\nDate de naissance : 12 mars 1999")
    assert cv["etat_civil"] == {"date_naissance": "12 mars 1999", "nationalite": "Sénégalaise",
                                "situation": "Célibataire", "permis": "B"}


# ---------------------------------------------------------------------------
# PDF LaTeX à polices « Type 3 » : ligatures, tirets et puces sans table Unicode
# ---------------------------------------------------------------------------
def test_ligatures_tirets_et_puces_latex_retrouves():
    import importer
    brut = ("intelligenza arti\x1cciale, per de\x1cnire, Classi\x1cer, e\x1ecace, \x1dusso, di\x1eciles, sta\x1b team\n"
            "08/2026 \x15 10/2026\n\x88 Applicazione web\nfin de page\x0c")
    t = importer._nettoyer(brut)
    for mot in ("artificiale", "definire", "Classifier", "efficace", "flusso", "difficiles", "staff team", "08/2026 – 10/2026",
                "• Applicazione web", "fin de page"):
        assert mot in t, mot
    assert "pagefi" not in t
    assert not any(ord(c) < 32 and c not in "\n\t" for c in t)          # saut de page retiré, pas changé en « fi »


def test_colonne_de_gauche_statut_lieu_et_lignes_recollees():
    import importer
    lignes = ["08/2026 – 10/2026 : Tirocinante Sviluppatore Python, Azienda Esempio S.r.l.",
              "(in corso) :  Sviluppo di un agente in Python per la contabilizzazione di",
              "Lombardia, Italia",
              "fatture elettroniche.",
              "• Analisi delle regole contabili per definire la logica",
              "del modulo.",
              "• Test del processo end-to-end."]
    e = importer._entrees(lignes)
    assert len(e) == 1
    assert e[0]["dates"] == "08/2026 – 10/2026 (in corso)" and e[0]["lieu"] == "Lombardia, Italia"
    assert e[0]["details"] == ["Sviluppo di un agente in Python per la contabilizzazione di fatture elettroniche.",
                               "Analisi delle regole contabili per definire la logica del modulo.",
                               "Test del processo end-to-end."]


def test_projets_sans_dates_avec_libelle_repete():
    import importer
    lignes = ["Progetto : Sistema di Monitoraggio", "Universitario :  Applicazione con backend in Flask.",
              "Progetto : Diabetes Classifier", "Universitario :  Modello di classificazione, sviluppato in",
              "Python con scikit-learn.", "Stack: Python · pandas", "Progetto : Agenda", "Universitario :  Applicazione web."]
    titres = [x["titre"] for x in importer._entrees(lignes)]
    assert titres == ["Sistema di Monitoraggio", "Diabetes Classifier", "Agenda"]
