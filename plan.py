"""
Plan de localisation : dessin (routes, carrefours, bâtiments, flèches, textes) -> PDF vectoriel.

L'éditeur du navigateur (web/plan.js) envoie la liste des éléments dessinés ; on la vérifie
(nombres bornés, textes courts, types connus), puis on la traduit en TikZ, que LaTeX met en
page avec le titre, la description, le contact et, si on la connaît, la position GPS avec un
code QR. Les pictogrammes viennent de web/plan-icones.json, partagé avec l'éditeur : le PDF
ressemble ainsi exactement à ce qui est dessiné à l'écran.

Coordonnées : celles de l'éditeur (largeur 1000 en paysage, 700 en portrait), y vers le bas.
"""
import json
import math
from pathlib import Path

from moteur import ErreurDonnees, Tex, echapper, _dico, _lignes, _paragraphes, _texte

RACINE = Path(__file__).parent
ICONES = {k: v for k, v in json.loads((RACINE / "web" / "plan-icones.json").read_text(encoding="utf-8")).items()
          if not k.startswith("_")}

# Taille de la zone de dessin (unités de l'éditeur) et place qu'elle occupe sur la page A4 (cm).
FORMATS = {"paysage": {"largeur": 1000, "hauteur": 500, "cm": 26.0},
           "portrait": {"largeur": 700, "hauteur": 820, "cm": 17.6}}
COULEURS = {"noir": "1A1A1A", "gris": "8A8A8A", "gris_clair": "D9D9D9", "rouge": "D62828", "bleu": "3D6FB6",
            "vert": "2E8B57", "orange": "F28C28", "jaune_clair": "FFF3C4", "fond": "FFFFFF"}
ELEMENTS_MAX, POINTS_MAX, TEXTE_MAX = 300, 60, 80
TRAIT = 2.2               # épaisseur des bords d'une route et des contours (unités de l'éditeur)


def _nombre(v, mini, maxi, defaut):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return defaut
    return min(maxi, max(mini, float(v)))


def _point(v, fmt):
    if not isinstance(v, (list, tuple)) or len(v) != 2:
        return None
    return (_nombre(v[0], -200, fmt["largeur"] + 200, 0), _nombre(v[1], -200, fmt["hauteur"] + 200, 0))


def _couleur(v, defaut="noir"):
    return v if v in COULEURS and v != "fond" else defaut


def lire_elements(brut, fmt):
    """Liste d'éléments reçue du navigateur -> éléments vérifiés (ce qui est invalide est ignoré)."""
    elements = []
    for e in (brut if isinstance(brut, list) else [])[:ELEMENTS_MAX]:
        if not isinstance(e, dict):
            continue
        genre = e.get("type")
        x, y = _nombre(e.get("x"), -200, fmt["largeur"] + 200, 0), _nombre(e.get("y"), -200, fmt["hauteur"] + 200, 0)
        nom = _texte(e.get("nom"), TEXTE_MAX)
        if genre == "route":
            points = [p for p in (_point(p, fmt) for p in (e.get("points") or [])[:POINTS_MAX]
                                  if isinstance(e.get("points"), list)) if p]
            if len(points) >= 2:
                elements.append({"type": "route", "points": points, "largeur": _nombre(e.get("largeur"), 12, 90, 36),
                                 "lisse": e.get("lisse") is True})
        elif genre == "carrefour":
            elements.append({"type": "carrefour", "x": x, "y": y, "r": _nombre(e.get("r"), 6, 80, 24), "nom": nom,
                             "style": "point" if e.get("style") == "point" else "rond",
                             "position": e.get("position") if e.get("position") in ("dessus", "dessous", "gauche", "droite") else "droite"})
        elif genre in ("batiment", "ici"):
            icone = "ici" if genre == "ici" else (e.get("icone") if e.get("icone") in ICONES and e.get("icone") != "ici" else "maison")
            elements.append({"type": genre, "icone": icone, "x": x, "y": y, "taille": _nombre(e.get("taille"), 0.5, 3, 1),
                             "nom": nom, "position": e.get("position") if e.get("position") in ("dessus", "dessous", "gauche", "droite") else "dessous"})
        elif genre == "fleche":
            points = [p for p in (_point(p, fmt) for p in (e.get("points") or [])[:2]
                                  if isinstance(e.get("points"), list)) if p]
            if len(points) == 2 and points[0] != points[1]:
                elements.append({"type": "fleche", "points": points, "couleur": _couleur(e.get("couleur")),
                                 "epaisse": e.get("epaisse") is True})
        elif genre == "interdit":
            elements.append({"type": "interdit", "x": x, "y": y})
        elif genre == "texte" and nom:
            elements.append({"type": "texte", "x": x, "y": y, "nom": nom, "taille": _nombre(e.get("taille"), 8, 40, 14),
                             "angle": _nombre(e.get("angle"), -180, 180, 0), "gras": e.get("gras") is True,
                             "couleur": _couleur(e.get("couleur"))})
    return elements


# --------------------------------------------------------------------------
# Éléments -> TikZ
# --------------------------------------------------------------------------
class _Dessin:
    def __init__(self, fmt):
        self.fmt = fmt
        self.s = fmt["cm"] / fmt["largeur"]                 # cm par unité de l'éditeur
        self.lignes = []

    def p(self, x, y):
        return f"({x * self.s:.3f},{-y * self.s:.3f})"

    def epaisseur(self, unites):
        return f"{unites * self.s * 28.4528:.2f}pt"         # 1 cm = 28,45 pt

    def taille_police(self, unites):
        pt = unites * self.s * 28.4528
        return f"\\fontsize{{{pt:.1f}}}{{{pt * 1.15:.1f}}}\\selectfont"

    def chemin(self, points, lisse):
        """Ligne brisée, ou courbe passant par les points (la même que dans l'éditeur)."""
        if not lisse or len(points) < 3:
            return " -- ".join(self.p(*q) for q in points)
        morceaux = [self.p(*points[0])]
        for i in range(len(points) - 1):
            p0, p1, p2 = points[max(i - 1, 0)], points[i], points[i + 1]
            p3 = points[min(i + 2, len(points) - 1)]
            c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
            c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
            morceaux.append(f".. controls {self.p(*c1)} and {self.p(*c2)} .. {self.p(*p2)}")
        return " ".join(morceaux)

    def etiquette(self, x, y, texte, taille=13, position="droite", ecart=0, couleur="noir", gras=False, angle=0):
        ancres = {"droite": "west", "gauche": "east", "dessus": "south", "dessous": "north", "centre": "center"}
        dx, dy = {"droite": (ecart, 0), "gauche": (-ecart, 0), "dessus": (0, -ecart), "dessous": (0, ecart),
                  "centre": (0, 0)}[position]
        gras = "\\bfseries" if gras else ""
        # Fond blanc légèrement transparent : un nom posé sur une route reste lisible.
        self.lignes.append(
            f"\\node[anchor={ancres[position]}, rotate={-angle:.1f}, inner sep=1.5pt, align=center, "
            f"fill=white, fill opacity=0.85, text opacity=1, "
            f"text=c{couleur}, font={{{self.taille_police(taille)}{gras}}}] at {self.p(x + dx, y + dy)} {{{texte}}};")

    def icone(self, nom, x, y, taille):
        """Pictogramme de plan-icones.json, centré sur (x, y)."""
        k = taille

        def q(a, b):
            return self.p(x + (a - 30) * k, y + (b - 30) * k)
        for forme in ICONES[nom]:
            if forme[0] == "texte":
                _, a, b, texte, t, couleur = forme
                self.lignes.append(f"\\node[text=c{couleur}, font={{{self.taille_police(t * k)}\\bfseries}}] at {q(a, b)} {{{texte}}};")
                continue
            remplissage, contour = forme[-2], forme[-1]
            style = f"line width={self.epaisseur(1.6 * k)}, line join=round, draw=c{contour}"
            if remplissage != "aucun":
                style += f", fill=c{remplissage}"
            if forme[0] == "poly":
                self.lignes.append(f"\\filldraw[{style}] " + " -- ".join(q(a, b) for a, b in forme[1]) + " -- cycle;")
            elif forme[0] == "rect":
                _, a, b, l, h = forme[:5]
                self.lignes.append(f"\\filldraw[{style}] {q(a, b)} rectangle {q(a + l, b + h)};")
            elif forme[0] == "ligne":
                _, a, b, c, d, couleur = forme
                self.lignes.append(f"\\draw[line width={self.epaisseur(1.6 * k)}, draw=c{couleur}] {q(a, b)} -- {q(c, d)};")


def dessiner(elements, fmt):
    d = _Dessin(fmt)
    L = d.lignes
    for nom, valeur in COULEURS.items():
        L.append(f"\\definecolor{{c{nom}}}{{HTML}}{{{valeur}}}")
    L.append(f"\\useasboundingbox {d.p(0, 0)} rectangle {d.p(fmt['largeur'], fmt['hauteur'])};")
    routes = [e for e in elements if e["type"] == "route"]
    # Routes : toutes en noir, puis toutes en blanc par-dessus (un peu plus étroit). Les
    # croisements se fondent ainsi les uns dans les autres, comme sur un plan dessiné à la main.
    for couche, retrait, couleur in (("bord", 0, "cnoir"), ("chaussee", 2 * TRAIT, "cfond")):
        for e in routes:
            L.append(f"\\draw[line width={d.epaisseur(e['largeur'] - retrait)}, line join=round, line cap=butt, "
                     f"draw={couleur}] {d.chemin(e['points'], e['lisse'])};")
    for e in elements:
        t = e["type"]
        if t == "carrefour":
            if e["style"] == "point":
                L.append(f"\\fill[cbleu] {d.p(e['x'], e['y'])} circle ({e['r'] * 0.5 * d.s:.3f});")
                rayon = e["r"] * 0.5
            else:
                L.append(f"\\filldraw[fill=cfond, draw=cnoir, line width={d.epaisseur(TRAIT)}] "
                         f"{d.p(e['x'], e['y'])} circle ({e['r'] * d.s:.3f});")
                rayon = e["r"]
            if e["nom"]:
                d.etiquette(e["x"], e["y"], echapper(e["nom"]), 13, e["position"], rayon + 6, gras=True)
        elif t in ("batiment", "ici"):
            d.icone(e["icone"], e["x"], e["y"], e["taille"])
            if e["nom"]:
                d.etiquette(e["x"], e["y"], echapper(e["nom"]), 14 if t == "ici" else 12, e["position"],
                            31 * e["taille"], couleur="rouge" if t == "ici" else "noir", gras=t == "ici")
        elif t == "fleche":
            (x1, y1), (x2, y2) = e["points"]
            if e["epaisse"]:
                L.append(f"\\draw[-{{Stealth[length={d.epaisseur(22)}, width={d.epaisseur(26)}]}}, "
                         f"line width={d.epaisseur(9)}, draw=c{e['couleur']}] {d.p(x1, y1)} -- {d.p(x2, y2)};")
            else:
                L.append(f"\\draw[-{{Stealth[length={d.epaisseur(11)}, width={d.epaisseur(8)}]}}, "
                         f"line width={d.epaisseur(1.6)}, draw=c{e['couleur']}] {d.p(x1, y1)} -- {d.p(x2, y2)};")
        elif t == "interdit":
            for a, b in (((-9, -9), (9, 9)), ((-9, 9), (9, -9))):
                L.append(f"\\draw[line width={d.epaisseur(4.5)}, line cap=round, draw=crouge] "
                         f"{d.p(e['x'] + a[0], e['y'] + a[1])} -- {d.p(e['x'] + b[0], e['y'] + b[1])};")
        elif t == "texte":
            d.etiquette(e["x"], e["y"], echapper(e["nom"]), e["taille"], "centre", couleur=e["couleur"],
                        gras=e["gras"], angle=e["angle"])
    return Tex("\n".join(L))


def preparer_plan(brut, options):
    """{elements, titre, sous_titre, description, contact, orientation, cadre, gps} -> contexte LaTeX."""
    p = _dico(brut)
    orientation = "portrait" if p.get("orientation") == "portrait" else "paysage"
    fmt = FORMATS[orientation]
    elements = lire_elements(p.get("elements"), fmt)
    if not elements:
        raise ErreurDonnees("Le plan est vide : dessine au moins une route ou un repère.")
    gps = _dico(p.get("gps"))
    lat, lon = gps.get("lat"), gps.get("lon")
    position = None
    if all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (lat, lon)) \
            and -90 <= lat <= 90 and -180 <= lon <= 180:
        position = {"texte": Tex(f"{lat:.6f}, {lon:.6f}"),
                    # Lien lisible par n'importe quel téléphone (application de cartes ou navigateur).
                    "lien": Tex(f"https://www.google.com/maps?q={lat:.6f},{lon:.6f}")}
    return {"plan": {
        "titre": echapper(_texte(p.get("titre"), 120) or "PLAN DE LOCALISATION"),
        "sous_titre": echapper(_texte(p.get("sous_titre"), 200)),
        "description": _paragraphes(_lignes(p.get("description"), 6, 400)),
        "contact": echapper(_texte(p.get("contact"), 200)),
        "orientation": orientation,
        "cadre": p.get("cadre") is True,
        "dessin": dessiner(elements, fmt),
        "gps": position,
    }, "o": options}


def generer_plan(brut, options=None):
    from moteur import _options, compiler, rendre_latex
    contexte = preparer_plan(brut, _options(options))
    return compiler(rendre_latex("plan.tex.j2", contexte), {}, "lettre")
