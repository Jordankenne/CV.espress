"""Export Word (.docx), suivi anonyme du parcours dans l'éditeur, échecs de fabrication comptés."""
import io
import json
import zipfile
from pathlib import Path
from xml.dom import minidom

import pytest

import app as application
import moteur
import statistiques
import word

RACINE = Path(__file__).resolve().parent.parent
CV = {"nom": "Awa Exemple", "titre": "Assistante comptable", "email": "awa@exemple.org", "ville": "Dakar",
      "liens": [{"label": "Mon site", "url": "exemple.org"}, {"label": "piège", "url": "javascript:alert(1)"}],
      "experiences": [{"poste": "Comptable", "entreprise": "A & B <SARL>", "dates": "2020 -- 2024",
                       "points": ["Saisie \"rapide\"", r"\input{/etc/passwd}"]}],
      "formations": [{"diplome": "BTS", "ecole": "Lycée", "dates": "2018"}],
      "competences": [{"categorie": "Outils", "liste": "Excel, Sage"}],
      "langues": [{"langue": "Wolof", "niveau": "maternelle"}]}


def ouvrir(octets):
    """Le .docx est un zip valide dont chaque partie XML se lit ; renvoie {nom: texte}."""
    z = zipfile.ZipFile(io.BytesIO(octets))
    parties = {}
    for nom in z.namelist():
        contenu = z.read(nom)
        if nom.endswith((".xml", ".rels")):
            minidom.parseString(contenu)
            parties[nom] = contenu.decode("utf-8")
        else:
            parties[nom] = contenu
    return parties


def test_cv_word_complet_et_texte_echappe():
    parties = ouvrir(word.generer_cv(CV, {"langue": "fr", "couleur": "#1F4E79"}))
    doc = parties["word/document.xml"]
    for attendu in ("Awa Exemple", "A &amp; B &lt;SARL&gt;", "2020 – 2024", r"\input{/etc/passwd}",
                    "EXPÉRIENCES PROFESSIONNELLES", "Wolof"):
        assert attendu in doc, attendu
    liens = parties["word/_rels/document.xml.rels"]
    assert 'Target="https://exemple.org"' in liens and "mailto:awa@exemple.org" in liens
    assert "javascript" not in liens                       # lien douteux : simple texte
    assert "1F4E79" in parties["word/styles.xml"]


def test_rubriques_dans_la_langue_du_document():
    doc = ouvrir(word.generer_cv(CV, {"langue": "it"}))["word/document.xml"]
    assert "ESPERIENZE PROFESSIONALI" in doc and "COMPETENZE" in doc


def test_photo_incluse():
    import miniatures
    parties = ouvrir(word.generer_cv({**CV, "photo": miniatures.avatar()}))
    assert any(n.startswith("word/media/photo.") for n in parties)
    assert 'r:embed="photo"' in parties["word/document.xml"]


def test_lettre_et_document_administratif():
    lettre = json.loads((RACINE / "web" / "exemple_lettre.json").read_text(encoding="utf-8"))
    doc = ouvrir(word.generer_lettre(CV, lettre))["word/document.xml"]
    assert "Awa Exemple" in doc and "Assistante comptable" in doc
    admin = {"titre": "Attestation sur l'honneur", "corps": "Je soussignée…", "lieu": "Dakar", "date": "1er mars"}
    doc = ouvrir(word.fabriquer({"type": "admin", "cv": CV, "admin": admin})[0])["word/document.xml"]
    assert "ATTESTATION SUR L&apos;HONNEUR" in doc or "ATTESTATION SUR L'HONNEUR" in doc
    assert "Fait à Dakar, le 1er mars" in doc
    assert "Assistante comptable" not in doc               # pas de poste visé sur un document administratif


@pytest.mark.parametrize("corps, message", [
    ({"type": "cv", "cv": {"titre": "sans nom"}}, "nom est obligatoire"),
    ({"type": "lettre", "cv": CV, "lettre": {}}, "lettre est vide"),
    ({"type": "plan", "cv": CV}, "qu'en PDF"),
    ({"type": "cv", "cv": {**CV, "photo": "data:image/gif;base64,R0lGOD"}}, "Photo"),
])
def test_donnees_refusees(client, corps, message):
    r = client.post("/api/docx", json=corps)
    assert r.status_code == 400 and message in r.get_json()["erreur"]


def test_route_word(client):
    r = client.post("/api/docx", json={"type": "cv", "cv": CV})
    assert r.status_code == 200 and r.mimetype == word.MIME
    assert 'filename="CV_Awa_Exemple.docx"' in r.headers["Content-Disposition"]
    ouvrir(r.data)


def test_word_demande_un_compte(client, monkeypatch, inscrire):
    monkeypatch.setitem(application.app.config, "COMPTE_POUR_PDF", True)
    r = client.post("/api/docx", json={"type": "cv", "cv": CV})
    assert r.status_code == 401 and r.get_json()["compte_requis"] is True
    assert inscrire("awa@exemple.org").post("/api/docx", json={"type": "cv", "cv": CV}).status_code == 200


def _compteurs():
    return {cle: sum(v) for cle, v in statistiques.lire(1)["cles"].items()}


def test_parcours_compte_les_etapes_connues_seulement(client):
    navigateur = {"HTTP_USER_AGENT": "Mozilla/5.0 (Windows NT 10.0) Firefox/130.0"}
    assert client.post("/api/evenement", json={"etape": "commence"}, environ_base=navigateur).status_code == 204
    assert client.post("/api/evenement", json={"etape": "pirate"}, environ_base=navigateur).status_code == 400
    assert client.post("/api/evenement", json={"etape": "apercu"},
                       environ_base={"HTTP_USER_AGENT": "Googlebot/2.1"}).status_code == 204
    assert client.post("/api/evenement", json={"etape": "commence"}, environ_base=navigateur,
                       headers={"Origin": "https://ailleurs.example"}).status_code == 403
    compteurs = _compteurs()
    assert compteurs.get("parcours:commence") == 1
    assert "parcours:apercu" not in compteurs              # robot : pas compté
    assert not any("pirate" in c for c in compteurs)


def test_parcours_limite_par_adresse_ip(client):
    navigateur = {"HTTP_USER_AGENT": "Mozilla/5.0 Firefox/130.0", "REMOTE_ADDR": "9.9.9.9"}
    for _ in range(80):
        client.post("/api/evenement", json={"etape": "editeur"}, environ_base=navigateur)
    assert _compteurs()["parcours:editeur"] == 60


def test_echecs_de_fabrication_comptes(client, monkeypatch):
    def echoue(*a, **k):
        raise moteur.ErreurCompilation("log LaTeX")
    monkeypatch.setattr(moteur, "generer_cv", echoue)
    r = client.post("/api/pdf", json={"type": "cv", "cv": CV})
    assert r.status_code == 500 and "log LaTeX" not in r.get_data(as_text=True)

    def plante(*a, **k):
        raise KeyError("bogue")
    monkeypatch.setattr(word, "generer_cv", plante)
    r = client.post("/api/docx", json={"type": "cv", "cv": CV})
    assert r.status_code == 500 and r.is_json
    compteurs = _compteurs()
    assert compteurs["echec:fabriquer_le_pdf:compilation"] == 1
    assert compteurs["echec:fabriquer_le_docx:imprevue"] == 1


def test_bouton_word_dans_l_editeur(client):
    page = client.get("/creer").get_data(as_text=True)
    assert 'id="btn-word"' in page
