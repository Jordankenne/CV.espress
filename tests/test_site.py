"""Page d'erreur, cache et compression, page Contact, compteurs d'usage."""
import re
import gzip

import app as application
import comptes
import contact
import statistiques
from conftest import _FilImmediat


def test_page_404_dans_la_langue_de_l_adresse(client):
    r = client.get("/it/pagina-che-non-esiste")
    assert r.status_code == 404 and "Questa pagina non esiste" in r.get_data(as_text=True)
    r = client.get("/fichier-inconnu.js")
    assert r.status_code == 404 and "Cette page n&#39;existe pas" in r.get_data(as_text=True)
    assert client.get("/api/inconnue").get_json() == {"erreur": "Introuvable."}


def test_versions_des_fichiers_et_compression(client):
    html = gzip.decompress(client.get("/", headers={"Accept-Encoding": "gzip"}).data).decode()
    assert f'/style.css?v={application.VERSION}"' in html
    r = client.get("/editeur-apercu.js", headers={"Accept-Encoding": "gzip"})
    assert r.headers["Content-Encoding"] == "gzip" and b"use strict" in gzip.decompress(r.data)
    assert client.get("/editeur-apercu.js", headers={"If-None-Match": r.headers["ETag"], "Accept-Encoding": "gzip"}).status_code == 304
    assert "Content-Encoding" not in client.get("/editeur-apercu.js").headers          # navigateur sans gzip
    assert client.get("/sante").get_data(as_text=True) == "ok"
    assert client.get("/site.webmanifest").mimetype == "application/manifest+json"


def test_contact(client, monkeypatch):
    envoyes = []
    monkeypatch.setattr(comptes, "envoyer_email", lambda *a: envoyes.append(a))
    monkeypatch.setattr(contact.threading, "Thread", _FilImmediat)
    monkeypatch.setenv("ADMINS", "admin@example.com")
    assert client.post("/api/contact", json={"message": "court"}).status_code == 400
    r = client.post("/api/contact", json={"message": "Le PDF ne s'ouvre pas sur mon téléphone.", "email": "awa@example.com",
                                          "nom": "Awa", "sujet": "probleme"})
    assert r.get_json() == {"envoye": True}
    destinataire, sujet, texte, _, _, repondre_a = envoyes[-1]
    assert destinataire == "admin@example.com" and repondre_a == "awa@example.com" and "Le PDF" in texte
    # Robot (champ piège rempli) : rien n'est envoyé, mais la réponse est la même.
    assert client.post("/api/contact", json={"message": "achetez mes produits", "site_web": "x"}).get_json() == {"envoye": True}
    assert len(envoyes) == 1
    assert client.post("/api/contact", json={"message": "message depuis un autre site"},
                       headers={"Origin": "https://pirate.example"}).status_code == 403


def test_compteurs_d_usage(client):
    statistiques.vider()
    client.get("/")
    client.get("/en/cv-ats")
    statistiques.compter("pdf:plan", 2)
    donnees = statistiques.lire(30)
    assert donnees["cles"]["page:accueil"][-1] >= 1 and donnees["cles"]["langue_site:en"][-1] >= 1
    assert donnees["cles"]["pdf:plan"][-1] == 2
    statistiques.compter("pdf:plan")                       # s'ajoute à ce qui est déjà en base
    assert statistiques.lire(30)["cles"]["pdf:plan"][-1] == 3


def test_une_seule_adresse_publique(client, monkeypatch):
    monkeypatch.setattr(comptes, "ADRESSE_SITE", "https://moncvexpress.com")
    monkeypatch.setenv("RENDER_EXTERNAL_HOSTNAME", "cv-espress.onrender.com")
    for hote in ("www.moncvexpress.com", "cv-espress.onrender.com"):
        r = client.get("/cv-ats?x=1", headers={"Host": hote})
        assert r.status_code == 301 and r.headers["Location"] == "https://moncvexpress.com/cv-ats?x=1"
    assert client.get("/sante", headers={"Host": "cv-espress.onrender.com"}).status_code == 200
    assert client.get("/", headers={"Host": "moncvexpress.com"}).status_code == 200
    assert client.post("/api/contact", json={}, headers={"Host": "www.moncvexpress.com"}).status_code != 301


def test_les_robots_ne_comptent_pas_comme_des_visites(client):
    statistiques.vider()
    client.get("/", headers={"User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"})
    client.get("/contact", headers={"User-Agent": "Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)"})
    client.get("/", headers={"User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36"})
    cles = statistiques.lire(1)["cles"]
    assert cles["page:accueil"] == [1] and "page:contact" not in cles
    assert cles["robot:Google"] == [1] and cles["robot:UptimeRobot"] == [1]


def test_chaque_page_recoit_seulement_le_dictionnaire_de_sa_langue(client):
    """traductions.js est découpé par langue : une page française ne télécharge aucun dictionnaire."""
    tailles = {}
    for langue, adresse in (("fr", "/creer"), ("en", "/en/creer"), ("it", "/it/")):
        page = client.get(adresse).get_data(as_text=True)
        lien = re.search(r'src="(/traductions\.js\?[^"]+)"', page).group(1).replace("&amp;", "&")
        assert lien.endswith(f"langue={langue}")
        script = client.get(lien).get_data(as_text=True)
        tailles[langue] = len(script)
        assert "function tr(" in script
    assert tailles["fr"] < 10_000 < tailles["en"] and tailles["it"] > 10_000
    en = client.get("/traductions.js?langue=en").get_data(as_text=True)
    assert '"Ouvrir le PDF": "Open the PDF"' in en and "Apri il PDF" not in en
