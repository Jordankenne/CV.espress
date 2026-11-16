"""
CV en ligne (lien de partage, QR code) et suivi des candidatures : chaque compte ne voit et ne
modifie que les siens, un lien désactivé ne montre plus rien, et le QR code n'est imprimé
que pour un lien qui existe vraiment.
"""
import app as application
import comptes

CV = {"nom": "Awa Exemple", "titre": "Assistante comptable", "email": "awa@example.com",
      "experiences": [{"poste": "Comptable", "entreprise": "Cabinet <b>Exemple</b>", "points": "Saisie\nTVA"}]}


def creer_document(c, cv=CV):
    r = c.put("/api/compte/donnees", json={"donnees": {"cv": cv, "options": {"langue": "fr"}}, "nouveau": True})
    assert r.status_code == 201, r.get_json()
    return r.get_json()["doc"]


def test_lien_de_partage_cree_une_seule_fois_et_page_publique(inscrire):
    c = inscrire("awa@example.com")
    doc = creer_document(c)
    assert c.get(f"/api/compte/documents/{doc}/partage").get_json() == {"partage": None}
    p1 = c.post(f"/api/compte/documents/{doc}/partage", json={}).get_json()["partage"]
    p2 = c.post(f"/api/compte/documents/{doc}/partage", json={}).get_json()["partage"]
    assert p1["code"] == p2["code"] and comptes.CODE_OK.match(p1["code"])
    assert p1["url"].endswith("/cv/" + p1["code"])

    visiteur = application.app.test_client()          # un recruteur, sans compte
    r = visiteur.get(f"/cv/{p1['code']}")
    assert r.status_code == 200
    assert "noindex" in r.headers["X-Robots-Tag"]
    page = r.get_data(as_text=True)
    assert "Awa Exemple" in page
    assert "<b>Exemple</b>" not in page and "&lt;b&gt;Exemple&lt;/b&gt;" in page      # texte échappé
    assert c.get("/api/compte/documents").get_json()["documents"][0]["partage"]["vues"] == 1
    assert "Disallow: /cv/" in visiteur.get("/robots.txt").get_data(as_text=True)


def test_lien_desactive_ou_document_supprime(inscrire):
    c = inscrire("awa@example.com")
    doc = creer_document(c)
    code = c.post(f"/api/compte/documents/{doc}/partage", json={}).get_json()["partage"]["code"]
    c.delete(f"/api/compte/documents/{doc}/partage", json={})
    assert application.app.test_client().get(f"/cv/{code}").status_code == 404
    code = c.post(f"/api/compte/documents/{doc}/partage", json={}).get_json()["partage"]["code"]
    c.delete(f"/api/compte/documents/{doc}", json={})
    assert application.app.test_client().get(f"/cv/{code}").status_code == 404


def test_codes_invalides_et_inconnus(client):
    for code in ("x", "abcdefghijk0", "../../etc", "ABCDEFGHJKMN"):
        assert client.get(f"/cv/{code}").status_code == 404


def test_on_ne_partage_pas_le_document_d_un_autre(inscrire):
    awa = inscrire("awa@example.com", ip="10.0.0.1")
    doc = creer_document(awa)
    intrus = inscrire("intrus@example.com", ip="10.0.0.2")
    assert intrus.post(f"/api/compte/documents/{doc}/partage", json={}).status_code == 404
    code = awa.post(f"/api/compte/documents/{doc}/partage", json={}).get_json()["partage"]["code"]
    intrus.delete(f"/api/compte/documents/{doc}/partage", json={})
    assert intrus.get(f"/api/compte/documents/{doc}/partage").status_code == 404
    assert application.app.test_client().get(f"/cv/{code}").status_code == 200      # toujours en ligne


def test_qr_seulement_pour_un_lien_existant(inscrire):
    c = inscrire("awa@example.com")
    doc = creer_document(c)
    code = c.post(f"/api/compte/documents/{doc}/partage", json={}).get_json()["partage"]["code"]
    with application.app.test_request_context():
        avec = application.options_avec_qr({"qr": True, "partage": code})
        assert avec["lien_qr"].endswith("/cv/" + code)
        # Adresse imposée par le navigateur, code inconnu, case non cochée : pas de QR code.
        assert application.options_avec_qr({"qr": True, "partage": code, "lien_qr": "https://pirate.example/x"}
                                           )["lien_qr"].endswith("/cv/" + code)
        assert "lien_qr" not in application.options_avec_qr({"qr": True, "partage": "abcdefghijkm"})
        assert "lien_qr" not in application.options_avec_qr({"qr": False, "partage": code})
        assert "lien_qr" not in application.options_avec_qr({"lien_qr": "https://pirate.example/x"})


def test_candidatures_ajout_modification_suppression(inscrire):
    c = inscrire("awa@example.com")
    doc = creer_document(c)
    r = c.post("/api/compte/candidatures", json={"entreprise": "Orange", "poste": "Comptable", "envoye_le": "2026-11-10",
                                                   "relance_le": "2026-11-17", "statut": "envoyee", "doc_id": doc,
                                                   "lien": "emploi.example/offre/1"})
    assert r.status_code == 201
    cand = r.get_json()["candidature"]
    assert cand["doc_id"] == doc and cand["lien"] == "https://emploi.example/offre/1"
    r = c.put(f"/api/compte/candidatures/{cand['id']}", json={**cand, "statut": "entretien"})
    assert r.get_json()["candidature"]["statut"] == "entretien"
    # Le document envoyé est supprimé : la candidature reste, sans document.
    c.delete(f"/api/compte/documents/{doc}", json={})
    assert c.get("/api/compte/candidatures").get_json()["candidatures"][0]["doc_id"] is None
    assert c.delete(f"/api/compte/candidatures/{cand['id']}", json={}).status_code == 200
    assert c.get("/api/compte/candidatures").get_json()["candidatures"] == []


def test_candidatures_valeurs_refusees(inscrire):
    c = inscrire("awa@example.com")
    assert c.post("/api/compte/candidatures", json={"notes": "rien d'autre"}).status_code == 400
    assert c.post("/api/compte/candidatures", json={"poste": "x", "envoye_le": "10/11/2026"}).status_code == 400
    assert c.post("/api/compte/candidatures", json={"poste": "x", "doc_id": 999999}).status_code == 400
    r = c.post("/api/compte/candidatures", json={"poste": "x", "statut": "n'importe quoi"})
    assert r.get_json()["candidature"]["statut"] == "envoyee"


def test_candidatures_isolees_entre_comptes(inscrire, client):
    awa = inscrire("awa@example.com", ip="10.0.0.1")
    cand = awa.post("/api/compte/candidatures", json={"entreprise": "Orange"}).get_json()["candidature"]
    intrus = inscrire("intrus@example.com", ip="10.0.0.2")
    doc_intrus = creer_document(intrus)
    assert intrus.get("/api/compte/candidatures").get_json()["candidatures"] == []
    assert intrus.put(f"/api/compte/candidatures/{cand['id']}", json={"entreprise": "Pirate"}).status_code == 404
    assert intrus.delete(f"/api/compte/candidatures/{cand['id']}", json={}).status_code == 404
    # Ni rattacher le document d'un autre compte à sa propre candidature.
    assert awa.post("/api/compte/candidatures", json={"poste": "x", "doc_id": doc_intrus}).status_code == 400
    assert client.get("/api/compte/candidatures").status_code == 401
    assert awa.get("/api/compte/candidatures").get_json()["candidatures"][0]["entreprise"] == "Orange"
