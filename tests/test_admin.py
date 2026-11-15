"""Tableau de bord de l'administrateur : réservé aux adresses du réglage ADMINS, sans
jamais montrer le contenu des documents."""
import pytest

import comptes

API = "/api/compte"
ADMIN = "/api/admin"


@pytest.fixture
def admin(inscrire, monkeypatch):
    monkeypatch.setenv("ADMINS", " Chef@Exemple.org , autre@exemple.org")
    return inscrire("chef@exemple.org", "Mot-de-passe-chef")


def test_invisible_pour_les_visiteurs_et_les_autres_comptes(inscrire, client, monkeypatch):
    monkeypatch.setenv("ADMINS", "chef@exemple.org")
    for c in (client, inscrire("awa@exemple.org")):
        assert c.get("/admin").status_code == 404
        assert c.get(f"{ADMIN}/resume").status_code == 404
        assert c.get(f"{ADMIN}/comptes").status_code == 404
        assert c.delete(f"{ADMIN}/comptes/1", json={"mot_de_passe": "x"}).status_code == 404


def test_sans_reglage_admins_personne_n_est_administrateur(inscrire, monkeypatch):
    monkeypatch.delenv("ADMINS", raising=False)
    assert inscrire("chef@exemple.org").get(f"{ADMIN}/resume").status_code == 404


def test_chiffres_et_liste_sans_contenu_des_documents(admin, inscrire):
    awa = inscrire("awa@exemple.org")
    awa.put(f"{API}/donnees", json={"donnees": {"cv": {"nom": "Awa Secret", "photo": "data:image/png;base64,AAA"}}})
    assert admin.get("/admin").status_code == 200
    resume = admin.get(f"{ADMIN}/resume").get_json()
    assert resume["comptes"] == 2 and resume["documents"] == 1 and resume["inscrits_7j"] == 2
    assert resume["taille_base"] > 0 and len(resume["inscriptions"]) == 30
    assert resume["inscriptions"][-1]["nombre"] == 2
    r = admin.get(f"{ADMIN}/comptes")
    assert "Secret" not in r.get_data(as_text=True) and "base64" not in r.get_data(as_text=True)
    lignes = {c["email"]: c for c in r.get_json()["comptes"]}
    assert lignes["awa@exemple.org"]["documents"] == 1 and lignes["awa@exemple.org"]["volume"] > 0
    assert lignes["chef@exemple.org"]["admin"] is True and lignes["awa@exemple.org"]["admin"] is False


def test_recherche_litterale_et_pagination(admin, inscrire):
    inscrire("a_b@exemple.org")
    inscrire("axb@exemple.org")
    emails = lambda q: [c["email"] for c in admin.get(f"{ADMIN}/comptes", query_string={"q": q}).get_json()["comptes"]]  # noqa: E731
    assert emails("A_B") == ["a_b@exemple.org"]          # « _ » n'est pas un joker
    assert emails("%") == [] and emails("\\") == []
    assert admin.get(f"{ADMIN}/comptes?page=abc").get_json()["page"] == 1
    assert admin.get(f"{ADMIN}/comptes?page=999").get_json()["comptes"] == []


def test_suppression_d_un_compte(admin, inscrire, nouveau_client):
    awa = inscrire("awa@exemple.org", "Mot-de-passe-awa")
    awa.put(f"{API}/donnees", json={"donnees": {"cv": {"nom": "Awa"}}})
    cible = next(c for c in admin.get(f"{ADMIN}/comptes").get_json()["comptes"] if c["email"] == "awa@exemple.org")
    assert admin.delete(f"{ADMIN}/comptes/{cible['id']}", json={"mot_de_passe": "faux-faux-faux"}).status_code == 401
    assert admin.delete(f"{ADMIN}/comptes/{cible['id']}", json={}).status_code == 401
    assert admin.delete(f"{ADMIN}/comptes/{cible['id']}", json={"mot_de_passe": "Mot-de-passe-chef"}).status_code == 200
    assert awa.get(API).get_json()["connecte"] is False                        # déconnectée partout
    with comptes._base() as b:
        assert b.execute("SELECT COUNT(*) FROM documents").fetchone()[0] == 0  # documents effacés avec
    assert admin.delete(f"{ADMIN}/comptes/{cible['id']}", json={"mot_de_passe": "Mot-de-passe-chef"}).status_code == 404
    assert admin.delete(f"{ADMIN}/comptes/{2 ** 80}", json={"mot_de_passe": "Mot-de-passe-chef"}).status_code == 404


def test_l_administrateur_ne_se_supprime_pas_ici(admin):
    moi = next(c for c in admin.get(f"{ADMIN}/comptes").get_json()["comptes"] if c["admin"])
    assert admin.delete(f"{ADMIN}/comptes/{moi['id']}", json={"mot_de_passe": "Mot-de-passe-chef"}).status_code == 400


def test_mots_de_passe_essayes_au_hasard_bloques(admin):
    codes = [admin.delete(f"{ADMIN}/comptes/1", json={"mot_de_passe": f"faux-{n}"}).status_code for n in range(10)]
    assert codes[:8] == [401] * 8 and codes[-1] == 429


def test_requete_venue_d_un_autre_site_refusee(admin):
    r = admin.delete(f"{ADMIN}/comptes/1", json={"mot_de_passe": "Mot-de-passe-chef"},
                     headers={"Origin": "https://pirate.exemple"})
    assert r.status_code == 403


def test_robots_interdit_l_administration(client):
    assert "Disallow: /admin" in client.get("/robots.txt").get_data(as_text=True)


# ---------------------------------------------------------------------------
# Fiche d'un compte, documents, vue brute
# ---------------------------------------------------------------------------
def _compte_et_document(admin, inscrire):
    awa = inscrire("awa@exemple.org", "Mot-de-passe-awa")
    doc = awa.put(f"{API}/donnees", json={"donnees": {"cv": {"nom": "Awa", "interets": "Lecture"}}}).get_json()["doc"]
    cible = next(c for c in admin.get(f"{ADMIN}/comptes").get_json()["comptes"] if c["email"] == "awa@exemple.org")
    return awa, cible["id"], doc


def test_fiche_et_lecture_d_un_document(admin, inscrire, caplog):
    _, compte, doc = _compte_et_document(admin, inscrire)
    fiche = admin.get(f"{ADMIN}/comptes/{compte}").get_json()
    assert fiche["email"] == "awa@exemple.org" and [d["doc"] for d in fiche["documents"]] == [doc]
    with caplog.at_level("INFO"):
        lu = admin.get(f"{ADMIN}/documents/{doc}").get_json()
    assert lu["donnees"]["cv"]["nom"] == "Awa" and lu["email"] == "awa@exemple.org"
    assert f"document n°{doc}" in caplog.text and "awa@exemple.org" not in caplog.text   # tracé, sans l'adresse
    assert admin.get(f"{ADMIN}/comptes/999999").status_code == 404
    assert admin.get(f"{ADMIN}/documents/999999").status_code == 404


def test_correction_d_un_document_sans_ecraser_le_titulaire(admin, inscrire):
    awa, _, doc = _compte_et_document(admin, inscrire)
    version = admin.get(f"{ADMIN}/documents/{doc}").get_json()["version"]
    r = admin.put(f"{ADMIN}/documents/{doc}", json={"donnees": {"cv": {"nom": "Awa Diop"}}, "nom": "CV corrigé",
                                                     "version": version})
    assert r.status_code == 200 and r.get_json()["version"] == version + 1
    vu = awa.get(f"{API}/donnees?doc={doc}").get_json()
    assert vu["donnees"]["cv"]["nom"] == "Awa Diop" and vu["nom"] == "CV corrigé"
    # Version périmée (le titulaire a enregistré entre-temps) : refus, rien d'écrasé.
    assert admin.put(f"{ADMIN}/documents/{doc}", json={"donnees": {"cv": {}}, "version": version}).status_code == 409
    for invalide in ({"donnees": "x", "version": version + 1}, {"donnees": {}}, {"donnees": {}, "version": True}):
        assert admin.put(f"{ADMIN}/documents/{doc}", json=invalide).status_code == 400
    assert awa.get(f"{API}/donnees?doc={doc}").get_json()["donnees"]["cv"]["nom"] == "Awa Diop"


def test_suppression_d_un_document(admin, inscrire):
    awa, _, doc = _compte_et_document(admin, inscrire)
    assert admin.delete(f"{ADMIN}/documents/{doc}", json={}).status_code == 200
    assert awa.get(f"{API}/donnees?doc={doc}").status_code == 404
    assert admin.delete(f"{ADMIN}/documents/{doc}", json={}).status_code == 404


def test_changement_d_adresse(admin, inscrire, nouveau_client):
    _, compte, _ = _compte_et_document(admin, inscrire)
    assert admin.patch(f"{ADMIN}/comptes/{compte}", json={"email": "pas-une-adresse"}).status_code == 400
    assert admin.patch(f"{ADMIN}/comptes/{compte}", json={"email": "chef@exemple.org"}).status_code == 409
    assert admin.patch(f"{ADMIN}/comptes/{compte}", json={"email": " Awa.Diop@Exemple.org "}).status_code == 200
    c = nouveau_client()
    r = c.post(f"{API}/connexion", json={"email": "awa.diop@exemple.org", "mot_de_passe": "Mot-de-passe-awa"})
    assert r.status_code == 200


def test_lien_de_mot_de_passe_envoye_au_titulaire(admin, inscrire, liens, nouveau_client):
    _, compte, _ = _compte_et_document(admin, inscrire)
    assert admin.post(f"{ADMIN}/comptes/{compte}/lien", json={}).status_code == 200
    email, genre, _, lien = liens[-1]
    assert email == "awa@exemple.org" and genre == "oubli"
    c = nouveau_client()
    jeton = lien.split("jeton=")[1]
    assert c.post(f"{API}/nouveau-mot-de-passe", json={"jeton": jeton, "mot_de_passe": "Nouveau-mdp-awa"}).status_code == 200


def test_vue_brute_masque_les_secrets(admin, inscrire, client, liens):
    _compte_et_document(admin, inscrire)
    client.post(f"{API}/inscription", json={"email": "attente@exemple.org"})
    for table in comptes.TABLES:
        r = admin.get(f"{ADMIN}/tables/{table}")
        assert r.status_code == 200, table
        t = r.get_json()
        for colonne in ("empreinte", "jeton"):
            if colonne in t["colonnes"]:
                i = t["colonnes"].index(colonne)
                assert all(ligne[i] == "••••••" for ligne in t["lignes"])
    assert [l[0] for l in admin.get(f"{ADMIN}/tables/invitations").get_json()["lignes"]] == ["attente@exemple.org"]
    assert admin.get(f"{ADMIN}/tables/sqlite_master").status_code == 404
    assert admin.get(f"{ADMIN}/tables/comptes;DROP").status_code == 404


def test_nouvelles_routes_invisibles_pour_les_autres(inscrire, monkeypatch):
    monkeypatch.setenv("ADMINS", "chef@exemple.org")
    awa = inscrire("awa@exemple.org")
    for methode, chemin in (("get", "/comptes/1"), ("patch", "/comptes/1"), ("post", "/comptes/1/lien"),
                            ("get", "/documents/1"), ("put", "/documents/1"), ("delete", "/documents/1"),
                            ("get", "/tables/comptes")):
        assert getattr(awa, methode)(f"{ADMIN}{chemin}", json={}).status_code == 404, chemin


def test_les_actions_de_l_administration_sont_journalisees_par_defaut():
    import logging
    import app as application
    assert application.app.logger.getEffectiveLevel() <= logging.INFO
