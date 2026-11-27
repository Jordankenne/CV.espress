"""Confirmation de l'adresse e-mail (lien de l'e-mail de bienvenue) et copie complète des données du compte."""
import json
import re

import comptes
from conftest import _FilImmediat
from test_securite_comptes import API, inscription


def _bienvenue(client, monkeypatch, **champs):
    envoyes = []
    monkeypatch.setattr(comptes, "envoyer_email", lambda *a: envoyes.append(a))
    monkeypatch.setattr(comptes.threading, "Thread", _FilImmediat)
    assert inscription(client, **champs).status_code == 201
    return envoyes


def _jeton(texte):
    return re.search(r"/compte\?confirmer=(\S+)", texte).group(1)


def test_le_lien_de_bienvenue_confirme_l_adresse(client, nouveau_client, monkeypatch):
    envoyes = _bienvenue(client, monkeypatch, langue="it")
    texte = envoyes[0][2]
    assert "/it/compte?confirmer=" in texte and "7 giorni" in texte
    assert client.get(API).get_json()["adresse_confirmee"] is False
    # Ouvert sur un autre appareil, sans être connecté : ça marche aussi.
    r = nouveau_client().post(f"{API}/confirmer", json={"jeton": _jeton(texte)})
    assert r.get_json() == {"adresse_confirmee": True, "deja": False}
    assert client.get(API).get_json()["adresse_confirmee"] is True
    assert nouveau_client().post(f"{API}/confirmer", json={"jeton": _jeton(texte)}).get_json()["deja"] is True


def test_lien_de_confirmation_falsifie_ou_d_une_autre_adresse(client, nouveau_client, monkeypatch):
    texte = _bienvenue(client, monkeypatch)[0][2]
    jeton = _jeton(texte)
    assert client.post(f"{API}/confirmer", json={"jeton": jeton[:-3] + "abc"}).status_code == 400
    assert client.post(f"{API}/confirmer", json={"jeton": 42}).status_code == 400
    with comptes._base() as b:                  # l'adresse du compte a changé : l'ancien lien ne vaut plus rien
        b.execute("UPDATE comptes SET email = 'autre@exemple.org'")
    assert client.post(f"{API}/confirmer", json={"jeton": jeton}).status_code == 400


def test_renvoyer_le_lien_de_confirmation(client, monkeypatch):
    envoyes = _bienvenue(client, monkeypatch)
    for _ in range(3):
        assert client.post(f"{API}/confirmation", json={"langue": "en"}).get_json() == {"envoye": True}
    assert client.post(f"{API}/confirmation", json={}).status_code == 429          # au plus 3 par quart d'heure
    sujet, texte = envoyes[-1][1:3]
    assert sujet == "MonCVexpress.com: confirm your e-mail address" and "/en/compte?confirmer=" in texte
    comptes._echecs.clear()
    client.post(f"{API}/confirmer", json={"jeton": _jeton(texte)})
    assert client.post(f"{API}/confirmation", json={}).get_json() == {"adresse_confirmee": True}
    client.post(f"{API}/deconnexion", json={})
    assert client.post(f"{API}/confirmation", json={}).status_code == 401


def test_copie_complete_des_donnees(client, monkeypatch):
    _bienvenue(client, monkeypatch)
    cv = {"cv": {"nom": "Awa Exemple", "photo": "data:image/jpeg;base64,AAAA"}, "options": {"modele": "moderne"}}
    doc = client.put(f"{API}/donnees", json={"donnees": cv}).get_json()["doc"]
    client.post(f"{API}/documents/{doc}/partage", json={})
    client.post(f"{API}/candidatures", json={"entreprise": "Orange", "poste": "Comptable"})
    r = client.get(f"{API}/export")
    assert r.status_code == 200 and "attachment" in r.headers["Content-Disposition"]
    copie = json.loads(r.data)
    assert copie["compte"]["email"] == "awa@exemple.org" and copie["compte"]["prenom"] == "Awa"
    assert copie["documents"][0]["contenu"] == cv                               # photo comprise
    assert copie["documents"][0]["lien_public"]["adresse"].startswith("http://localhost/cv/")
    assert copie["candidatures"][0]["entreprise"] == "Orange"
    texte = r.get_data(as_text=True)
    with comptes._base() as b:
        empreinte, jeton = b.execute("SELECT empreinte, jeton FROM comptes").fetchone()
    assert empreinte not in texte and jeton not in texte                         # jamais les secrets du compte
    client.post(f"{API}/deconnexion", json={})
    assert client.get(f"{API}/export").status_code == 401
