"""Hébergement gratuit : base PostgreSQL en ligne (Neon), e-mails par l'API de Brevo.
Ces tests tournent sur SQLite et, avec CV_TESTS_POSTGRES=…, sur PostgreSQL (voir conftest)."""
import json
import logging
import sqlite3
import urllib.error

import pytest

import comptes

API = "/api/compte"


# ---------------------------------------------------------------------------
# Sauvegarde et restauration
# ---------------------------------------------------------------------------
def test_sauvegarde_lisible_meme_depuis_postgres(inscrire):
    c = inscrire("awa@exemple.org")
    c.put(f"{API}/donnees", json={"donnees": {"cv": {"nom": "Awa"}}})
    copie = comptes.sauvegarder_base()
    b = sqlite3.connect(copie)
    try:
        assert b.execute("SELECT email FROM comptes").fetchall() == [("awa@exemple.org",)]
        assert json.loads(b.execute("SELECT contenu FROM documents").fetchone()[0])["cv"]["nom"] == "Awa"
        assert b.execute("SELECT version FROM documents").fetchone()[0] == 1
    finally:
        b.close()


@pytest.mark.skipif(not comptes.POSTGRES, reason="restauration : base PostgreSQL seulement")
def test_restauration_complete_puis_le_site_continue(inscrire, nouveau_client):
    c = inscrire("awa@exemple.org", "Mot-de-passe-42")
    numero = c.put(f"{API}/donnees", json={"donnees": {"cv": {"nom": "Awa"}}}).get_json()["doc"]
    copie = comptes.sauvegarder_base()
    with pytest.raises(RuntimeError, match="déjà des comptes"):     # jamais par-dessus des comptes
        comptes.restaurer_base(copie)
    with comptes._base() as b:
        for table in reversed(comptes.TABLES):                         # toutes les tables, enfants d'abord
            b.execute(f"DELETE FROM {table}")
    bilan = comptes.restaurer_base(copie)
    assert set(bilan) == set(comptes.TABLES)                           # chaque table est restaurée
    assert bilan["comptes"] == 1 and bilan["documents"] == 1
    assert comptes.verifier_restauration(copie)["comptes"] == 1
    # Le compte restauré fonctionne : connexion, document retrouvé, nouveaux numéros sans collision.
    d = nouveau_client()
    assert d.post(f"{API}/connexion", json={"email": "awa@exemple.org", "mot_de_passe": "Mot-de-passe-42"}).status_code == 200
    assert d.get(f"{API}/donnees?doc={numero}").get_json()["donnees"]["cv"]["nom"] == "Awa"
    assert d.post(f"{API}/documents", json={"nom": "Autre"}).get_json()["doc"] > numero
    inscrire("bea@exemple.org")


@pytest.mark.skipif(comptes.POSTGRES, reason="base SQLite seulement")
def test_restauration_sqlite_explique_quoi_faire(tmp_path):
    with pytest.raises(RuntimeError, match="remettre le fichier"):
        comptes.restaurer_base(tmp_path / "copie.sqlite3")


# ---------------------------------------------------------------------------
# Données hostiles propres à PostgreSQL
# ---------------------------------------------------------------------------
def test_caractere_nul_jamais_d_erreur_500(inscrire, client):
    c = inscrire("awa@exemple.org")
    assert client.post(f"{API}/connexion", json={"email": "a\x00@b.c", "mot_de_passe": "x"}).status_code == 401
    assert client.post(f"{API}/inscription", json={"email": "a\x00@b.c"}).status_code == 400
    numero = c.post(f"{API}/documents", json={"nom": "CV\x00 Paris"}).get_json()["doc"]
    assert c.patch(f"{API}/documents/{numero}", json={"nom": "\x00Lyon"}).status_code == 200
    assert c.put(f"{API}/donnees?doc={numero}", json={"donnees": {"cv": {"nom": "A\x00B"}}}).status_code == 200
    assert c.get(f"{API}/donnees?doc={numero}").get_json()["donnees"]["cv"]["nom"] == "A\x00B"
    noms = [d["nom"] for d in c.get(f"{API}/documents").get_json()["documents"]]
    assert "Lyon" in noms


def test_numeros_geants_jamais_d_erreur_500(inscrire):
    c = inscrire("awa@exemple.org")
    numero = c.put(f"{API}/donnees", json={"donnees": {"cv": {}}}).get_json()["doc"]
    geant = 2 ** 80
    assert c.patch(f"{API}/documents/{geant}", json={"nom": "X"}).status_code == 404
    assert c.delete(f"{API}/documents/{geant}", json={}).status_code == 404
    assert c.get(f"{API}/donnees?doc={geant}").status_code == 404
    assert c.put(f"{API}/donnees?doc={geant}", json={"donnees": {}, "version": 1}).status_code == 404
    assert c.put(f"{API}/donnees?doc={numero}", json={"donnees": {}, "version": geant}).status_code == 400
    assert c.put(f"{API}/donnees?doc={numero}", json={"donnees": {}, "version": -geant}).status_code == 400


def test_base_injoignable_donne_503_et_pas_500(inscrire, monkeypatch):
    c = inscrire("awa@exemple.org")

    def en_panne():
        raise comptes.ERREURS_BASE[-1]("base en veille")
    monkeypatch.setattr(comptes, "_base", en_panne)
    r = c.get(f"{API}/documents")
    assert r.status_code == 503 and r.headers["Retry-After"] == "10"
    assert "Réessaie" in r.get_json()["erreur"]


# ---------------------------------------------------------------------------
# E-mails par l'API de Brevo
# ---------------------------------------------------------------------------
class _Reponse:
    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return b'{"messageId":"1"}'


def test_e_mail_envoye_par_brevo(monkeypatch):
    envoyes = []
    monkeypatch.setattr(comptes, "BREVO_CLE_API", "cle-de-test")
    monkeypatch.setattr(comptes, "SMTP_HOTE", "")
    monkeypatch.setattr(comptes, "EMAIL_EXPEDITEUR", "CV.express <bonjour@cv.exemple>")
    monkeypatch.setattr(comptes.urllib.request, "urlopen",
                        lambda demande, timeout: envoyes.append((demande, timeout)) or _Reponse())
    comptes._envoyer_lien("awa@exemple.org", "invitation", "it", "https://cv.exemple/it/compte?jeton=abc",
                          logging.getLogger("essai"))
    demande, delai = envoyes[0]
    corps = json.loads(demande.data)
    assert demande.full_url == "https://api.brevo.com/v3/smtp/email" and demande.get_method() == "POST"
    assert demande.get_header("Api-key") == "cle-de-test" and delai == 20
    assert corps["sender"] == {"email": "bonjour@cv.exemple", "name": "CV.express"}
    assert corps["to"] == [{"email": "awa@exemple.org"}]
    assert corps["subject"].startswith("CV.express: conferma")
    assert "https://cv.exemple/it/compte?jeton=abc" in corps["textContent"] and "24 ore" in corps["textContent"]


def test_echec_brevo_note_sans_adresse_ni_plantage(monkeypatch, caplog):
    def refus(demande, timeout):
        raise urllib.error.HTTPError(demande.full_url, 401, "Unauthorized", {}, None)
    monkeypatch.setattr(comptes, "BREVO_CLE_API", "mauvaise-cle")
    monkeypatch.setattr(comptes, "EMAIL_EXPEDITEUR", "bonjour@cv.exemple")
    monkeypatch.setattr(comptes.urllib.request, "urlopen", refus)
    with caplog.at_level(logging.ERROR):
        comptes._envoyer_lien("awa@exemple.org", "oubli", "fr", "https://cv.exemple/compte?jeton=abc",
                              logging.getLogger("essai"))
    assert "Brevo" in caplog.text and "401" in caplog.text
    assert "awa@exemple.org" not in caplog.text and "jeton" not in caplog.text


def test_la_production_accepte_brevo_a_la_place_du_smtp(monkeypatch):
    monkeypatch.setattr(comptes, "PRODUCTION", True)
    monkeypatch.setattr(comptes, "ADRESSE_SITE", "https://cv-express.onrender.com")
    monkeypatch.setattr(comptes, "SMTP_HOTE", "")
    monkeypatch.setattr(comptes, "BREVO_CLE_API", "cle")
    monkeypatch.setattr(comptes, "EMAIL_EXPEDITEUR", "bonjour@cv.exemple")
    monkeypatch.setenv("CLE_SECRETE", "k" * 40)
    comptes._verifier_configuration()
    monkeypatch.setattr(comptes, "BREVO_CLE_API", "")
    with pytest.raises(RuntimeError, match="BREVO_CLE_API"):
        comptes._verifier_configuration()


def test_la_production_refuse_une_adresse_de_base_invalide(monkeypatch):
    monkeypatch.setattr(comptes, "PRODUCTION", True)
    monkeypatch.setattr(comptes, "ADRESSE_SITE", "https://cv-express.onrender.com")
    monkeypatch.setattr(comptes, "BREVO_CLE_API", "cle")
    monkeypatch.setattr(comptes, "EMAIL_EXPEDITEUR", "bonjour@cv.exemple")
    monkeypatch.setattr(comptes, "ADRESSE_BASE", "mysql://x")
    monkeypatch.setattr(comptes, "POSTGRES", False)
    monkeypatch.setenv("CLE_SECRETE", "k" * 40)
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        comptes._verifier_configuration()


def test_reglages_colles_avec_un_retour_a_la_ligne(monkeypatch):
    # Valeur copiée-collée dans l'hébergeur avec un retour à la ligne invisible à la fin :
    # les liens envoyés par e-mail étaient coupés en deux.
    monkeypatch.setenv("ADRESSE_SITE", "  https://cv-espress.onrender.com/\n")
    monkeypatch.setenv("BREVO_CLE_API", "xkeysib-abc\r\n")
    assert comptes._reglage("ADRESSE_SITE").rstrip("/") == "https://cv-espress.onrender.com"
    assert comptes._reglage("BREVO_CLE_API") == "xkeysib-abc"
