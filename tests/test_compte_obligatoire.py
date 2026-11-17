"""Télécharger un document demande un compte ; l'aperçu, l'éditeur et les pages publiques restent libres."""
import pytest

import app as application

CV = {"nom": "Awa Exemple", "titre": "Assistante comptable"}


@pytest.fixture
def obligatoire(monkeypatch):
    monkeypatch.setitem(application.app.config, "COMPTE_POUR_PDF", True)


def test_pdf_refuse_sans_compte(obligatoire, client):
    r = client.post("/api/pdf", json={"type": "cv", "cv": CV})
    assert r.status_code == 401 and r.get_json()["compte_requis"] is True


def test_pdf_accepte_avec_un_compte(obligatoire, inscrire):
    c = inscrire("awa@exemple.org")
    r = c.post("/api/pdf", json={"type": "cv", "cv": CV})
    assert r.status_code == 200 and r.data[:5] == b"%PDF-"


def test_ce_qui_reste_libre(obligatoire, client):
    assert client.post("/api/apercu", json={"type": "cv", "cv": CV}).status_code == 200
    for adresse in ("/", "/creer", "/cv-ats", "/contact", "/exemple/moderne.pdf"):
        assert client.get(adresse).status_code == 200, adresse
