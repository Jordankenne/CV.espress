"""Arbre généalogique : descendance d'un ancêtre, unions multiples, sur une page."""
import subprocess

import pytest

import arbre


def P(nom, sexe="h", naissance="", deces="", unions=None):
    return {"nom": nom, "sexe": sexe, "naissance": naissance, "deces": deces, "unions": unions or []}


FAMILLE = P("Mbarga Jean", "h", "1930", "2004", [
    {"conjoint": P("Ngo Marie", "f", "1935"), "enfants": [
        P("Mbarga Paul", "h", "1955", "", [{"conjoint": P("Fouda Anne", "f"), "enfants": [P("Mbarga Luc", "h", "1985")]}]),
        P("Mbarga Rose", "f", "1958")]},
    {"conjoint": P("Essomba Claire", "f", "1940"), "enfants": [P("Mbarga Alice", "f", "1965")]},
    {"conjoint": None, "enfants": [P("Mbarga Léa", "f", "1999")]},
])


def lire(pdf, tmp_path):
    (tmp_path / "a.pdf").write_bytes(pdf)
    infos = subprocess.run(["pdfinfo", str(tmp_path / "a.pdf")], capture_output=True, text=True).stdout
    return subprocess.run(["pdftotext", str(tmp_path / "a.pdf"), "-"], capture_output=True, text=True).stdout, infos


def test_arbre_complet(client, tmp_path):
    r = client.post("/api/pdf", json={"type": "arbre", "arbre": {"racine": FAMILLE, "sous_titre": "Famille Mbarga",
                                                                 "note": "Établi en 2026."}})
    assert r.status_code == 200 and 'filename="Arbre_genealogique.pdf"' in r.headers["Content-Disposition"]
    texte, infos = lire(r.data, tmp_path)
    assert "Pages:           1" in infos
    for nom in ("ARBRE GÉNÉALOGIQUE", "Famille Mbarga", "Mbarga Jean", "Ngo Marie", "Essomba Claire", "Mbarga Luc",
                "Mbarga Léa", "1930", "2004", "Établi en 2026."):
        assert nom in texte, nom


def test_disposition_sans_chevauchement():
    racine = arbre._personne(FAMILLE, 0, [0])
    arbre._mesurer(racine)
    cases, liens = [], []
    arbre._placer(racine, 0, 0, cases, liens)
    assert len(cases) == 9      # Jean, ses 2 épouses, Paul et Fouda, Luc, Rose, Alice, Léa
    par_rangee = {}
    for c in cases:
        par_rangee.setdefault(c["y"], []).append(c["x"])
    for xs in par_rangee.values():                       # aucune case sur une autre, dans chaque génération
        xs.sort()
        assert all(b - a >= arbre.BOITE_L for a, b in zip(xs, xs[1:]))
    # Les enfants de chaque union sont sous leur propre chemin : un lien de descendance par union avec enfants.
    assert sum(1 for l in liens if l[0] == "descendance") == 4


def test_ancetre_sans_nom_refuse(client):
    for a in (None, {}, {"racine": {"nom": ""}}, {"racine": "x"}):
        r = client.post("/api/pdf", json={"type": "arbre", "arbre": a})
        assert r.status_code == 400 and "ancêtre" in r.get_json()["erreur"]


def test_trop_de_personnes_refuse(client):
    racine = P("Ancêtre", unions=[{"conjoint": None, "enfants": [P(f"Enfant {i}", unions=[{"conjoint": None,
              "enfants": [P(f"Petit {i}-{k}") for k in range(20)]}]) for i in range(20)]}])
    r = client.post("/api/pdf", json={"type": "arbre", "arbre": {"racine": racine}})
    assert r.status_code == 400 and "trop grand" in r.get_json()["erreur"]


def test_generations_limitees():
    p = P("Génération 0")
    for i in range(1, 15):
        p = P(f"Génération {i}", unions=[{"conjoint": None, "enfants": [p]}])
    racine = arbre._personne(p, 0, [0])
    profondeur, q = 0, racine
    while q["unions"]:
        q, profondeur = q["unions"][0]["enfants"][0], profondeur + 1
    assert profondeur == arbre.GENERATIONS_MAX


@pytest.mark.parametrize("racine", [
    {"nom": "\\input{/etc/passwd} & % $ # _ { } ~ ^", "sexe": "x", "naissance": ["a"], "unions": "abc"},
    {"nom": "A", "unions": [None, 1, "x", {"conjoint": "x", "enfants": "y"}, {"conjoint": {"nom": "\\write18{id}"}, "enfants": [None, {}, {"nom": "B"}]}]},
    {"nom": "A", "decede": "oui", "deces": {"a": 1}, "lieu": 5},
])
def test_donnees_hostiles_jamais_d_erreur_500(client, racine):
    r = client.post("/api/pdf", json={"type": "arbre", "arbre": {"racine": racine, "titre": "\\def\\x{}", "papier": "A0",
                                                                 "options": {"dates": "non", "lieux": True}}})
    assert r.status_code == 200, r.get_json()


def test_grande_famille_reduite_sur_une_page_a3(client, tmp_path):
    racine = P("Ancêtre", unions=[{"conjoint": P("Épouse", "f"), "enfants": [
        P(f"Enfant {i}", unions=[{"conjoint": P(f"Conjoint {i}"), "enfants": [P(f"Petit {i}-{k}") for k in range(4)]}])
        for i in range(10)]}])
    r = client.post("/api/pdf", json={"type": "arbre", "arbre": {"racine": racine, "papier": "A3"}})
    texte, infos = lire(r.data, tmp_path)
    assert r.status_code == 200 and "Pages:           1" in infos and "Petit 9-3" in texte
    assert "1190.55 x 841.89" in infos                    # A3 paysage
