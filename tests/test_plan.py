"""Plan de localisation : dessin -> PDF vectoriel d'une page, avec position GPS et code QR."""
import subprocess

import pytest

import plan

ELEMENTS = [
    {"type": "route", "points": [[60, 60], [940, 60]]},
    {"type": "route", "points": [[500, 60], [500, 480], [300, 480]], "lisse": True, "largeur": 30},
    {"type": "carrefour", "x": 500, "y": 60, "nom": "Carrefour Vogt", "style": "point"},
    {"type": "carrefour", "x": 500, "y": 300, "nom": "Carrefour CRADAT"},
    {"type": "batiment", "icone": "eglise", "x": 600, "y": 200, "nom": "Église Don Bosco"},
    {"type": "ici", "x": 300, "y": 420, "nom": "ICI DOMICILE"},
    {"type": "fleche", "points": [[480, 400], [480, 340]]},
    {"type": "fleche", "points": [[800, 400], [760, 300]], "epaisse": True, "couleur": "bleu"},
    {"type": "interdit", "x": 900, "y": 60},
    {"type": "texte", "x": 700, "y": 100, "nom": "Venant de Bastos", "angle": 30, "gras": True},
]


def texte(pdf, tmp_path):
    (tmp_path / "p.pdf").write_bytes(pdf)
    infos = subprocess.run(["pdfinfo", str(tmp_path / "p.pdf")], capture_output=True, text=True).stdout
    return subprocess.run(["pdftotext", str(tmp_path / "p.pdf"), "-"], capture_output=True, text=True).stdout, infos


@pytest.mark.parametrize("orientation", ["paysage", "portrait"])
def test_plan_complet_sur_une_page(client, tmp_path, orientation):
    r = client.post("/api/pdf", json={"type": "plan", "plan": {
        "elements": ELEMENTS, "orientation": orientation, "cadre": True, "sous_titre": "Domicile de Awa Exemple",
        "description": "Portail bleu, à côté de l'école.\nDeuxième maison.", "contact": "Awa Exemple – +237 699 00 00 00",
        "gps": {"lat": 3.8667, "lon": 11.5167}}})
    assert r.status_code == 200 and r.data[:5] == b"%PDF-"
    assert 'filename="Plan_de_localisation.pdf"' in r.headers["Content-Disposition"]
    contenu, infos = texte(r.data, tmp_path)
    assert "Pages:           1" in infos
    sans_espaces = "".join(contenu.split())          # un texte incliné est extrait par morceaux
    assert all(mot in sans_espaces for mot in ("Venant", "Bastos"))    # texte incliné : mots dans le désordre
    for attendu in ("PLAN DE LOCALISATION", "Carrefour Vogt", "Église Don Bosco", "ICI DOMICILE",
                    "Portail bleu", "+237 699 00 00 00", "3.866700, 11.516700", "Scanner pour ouvrir la carte"):
        assert "".join(attendu.split()) in sans_espaces, attendu


def test_sans_gps_pas_de_code_qr(client, tmp_path):
    r = client.post("/api/pdf", json={"type": "plan", "plan": {"elements": ELEMENTS[:3], "gps": {"lat": 200, "lon": "x"}}})
    contenu, _ = texte(r.data, tmp_path)
    assert r.status_code == 200 and "Scanner" not in contenu and "Position GPS" not in contenu


def test_plan_vide_refuse(client):
    for p in (None, {}, {"elements": []}, {"elements": [{"type": "texte", "nom": ""}, {"type": "route", "points": [[1, 1]]}]}):
        r = client.post("/api/pdf", json={"type": "plan", "plan": p})
        assert r.status_code == 400 and "vide" in r.get_json()["erreur"]


@pytest.mark.parametrize("element", [
    {"type": "route", "points": "abc"}, {"type": "route", "points": [[1e308, -1e308], ["a", None], [float("nan"), 1]]},
    {"type": "route", "points": [[0, 0]] * 5000, "largeur": 1e9},
    {"type": "carrefour", "x": None, "y": [], "nom": {"a": 1}, "r": -5, "style": "\\input", "position": "x"},
    {"type": "batiment", "icone": "../../etc/passwd", "x": 1, "y": 1, "nom": "\\write18{rm -rf /} $ & % # _ ^ ~"},
    {"type": "texte", "x": 10, "y": 10, "nom": "}\\end{tikzpicture}\\input{/etc/passwd}", "angle": "90", "taille": 1e6},
    {"type": "fleche", "points": [[1, 1], [1, 1]]}, {"type": "fleche", "points": [[1, 1]]}, {"type": "inconnu"}, "texte", 42, None,
])
def test_elements_hostiles_jamais_d_erreur_500(client, element):
    r = client.post("/api/pdf", json={"type": "plan", "plan": {"elements": [ELEMENTS[0], element],
                                                                "titre": "\\def\\x{}", "contact": "%$&#_{}",
                                                                "gps": {"lat": True, "lon": False}}})
    assert r.status_code == 200, r.get_json()


def test_trop_d_elements_coupes():
    fmt = plan.FORMATS["paysage"]
    assert len(plan.lire_elements([{"type": "interdit", "x": 1, "y": 1}] * 5000, fmt)) == plan.ELEMENTS_MAX
    route = plan.lire_elements([{"type": "route", "points": [[i, i] for i in range(500)]}], fmt)[0]
    assert len(route["points"]) == plan.POINTS_MAX


def test_les_pictogrammes_sont_ceux_de_l_editeur():
    # Une seule source pour l'écran et le PDF : web/plan-icones.json.
    assert {"maison", "immeuble", "eglise", "mosquee", "ecole", "hopital", "station", "magasin", "bloc", "ici"} <= set(plan.ICONES)
    for forme in (f for formes in plan.ICONES.values() for f in formes):
        couleurs = [c for c in forme[1:] if isinstance(c, str) and c in plan.COULEURS or c == "aucun"]
        assert forme[0] in ("poly", "rect", "ligne", "texte") and (forme[0] == "texte" or couleurs)
