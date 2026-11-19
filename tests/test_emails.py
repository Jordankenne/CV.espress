"""Contenu des e-mails envoyés aux visiteurs : la bonne langue, les bons liens, jamais de mot de passe."""
import pytest

import comptes
from conftest import _FilImmediat
from test_securite_comptes import API, inscription

SUJETS = {"fr": "Bienvenue sur CV.express", "en": "Welcome to CV.express", "it": "Benvenuto su CV.express"}


@pytest.mark.parametrize("langue, prefixe", [("fr", ""), ("en", "/en"), ("it", "/it")])
def test_e_mail_de_bienvenue_dans_la_langue_du_site(client, monkeypatch, langue, prefixe):
    monkeypatch.setattr(comptes, "ADRESSE_SITE", "https://www.moncvexpress.com")
    envoyes = []
    monkeypatch.setattr(comptes, "envoyer_email", lambda *a: envoyes.append(a))
    monkeypatch.setattr(comptes.threading, "Thread", _FilImmediat)
    assert inscription(client, langue=langue, prenom="Awa").status_code == 201
    email, sujet, texte, genre = envoyes[0][:4]
    assert (email, genre) == ("awa@exemple.org", "bienvenue")
    assert sujet.startswith(SUJETS[langue])
    assert "Awa" in texte and "awa@exemple.org" in texte
    assert f"https://www.moncvexpress.com{prefixe}/compte" in texte                  # lien vers « Mon espace »
    assert f"https://www.moncvexpress.com{prefixe}/compte?oubli=1" in texte          # reprendre le compte
    assert "Mot-de-passe-42" not in texte                                              # jamais le mot de passe


def test_lien_mot_de_passe_oublie_pointe_vers_le_site(inscrire, liens, nouveau_client, monkeypatch):
    monkeypatch.setattr(comptes, "ADRESSE_SITE", "https://www.moncvexpress.com")
    inscrire("bea@exemple.org")
    nouveau_client().post(f"{API}/mot-de-passe-oublie", json={"email": "bea@exemple.org", "langue": "it"})
    email, genre, langue, lien = liens[-1]
    assert (email, genre) == ("bea@exemple.org", "oubli")
    assert lien.startswith("https://www.moncvexpress.com/") and "jeton=" in lien
