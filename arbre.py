"""
Arbre généalogique : la descendance d'un ancêtre, sur plusieurs générations -> PDF vectoriel.

Chaque personne peut avoir plusieurs unions (plusieurs conjoints), chacune avec ses enfants :
    personne = {nom, sexe ("h", "f" ou ""), naissance, deces, lieu, unions: [union…]}
    union    = {conjoint: {nom, sexe, naissance, deces, lieu}, enfants: [personne…]}
Un enfant dont l'autre parent n'est pas connu est rangé dans une union sans conjoint.

Disposition (calculée ici, dessinée en TikZ) : une génération par rangée ; chaque personne est
suivie à sa droite de ses conjoints ; les enfants d'une union sont groupés sous elle, reliés au
milieu du couple. Chaque sous-arbre prend la largeur qu'il lui faut, les sous-arbres frères
sont posés côte à côte : les traits ne se croisent jamais. Le tout est ensuite réduit pour
tenir sur la page.
"""
from moteur import ErreurDonnees, Tex, _dico, _lignes, _options, _paragraphes, _texte, compiler, echapper, rendre_latex

PERSONNES_MAX, GENERATIONS_MAX, UNIONS_MAX, ENFANTS_MAX = 250, 7, 6, 20
# Dimensions en millimètres.
BOITE_L, BOITE_H = 36, 15          # case d'une personne
ECART_CONJOINT = 6                 # entre une personne et son conjoint
ECART_FRERES = 6                   # entre deux sous-arbres voisins
ETAGE = 34                         # d'une génération à la suivante


def _personne(brut, profondeur, compteur):
    p = _dico(brut)
    compteur[0] += 1
    if compteur[0] > PERSONNES_MAX:
        raise ErreurDonnees(f"L'arbre est trop grand ({PERSONNES_MAX} personnes au maximum).")
    personne = {
        "nom": _texte(p.get("nom"), 80),
        "sexe": p.get("sexe") if p.get("sexe") in ("h", "f") else "",
        "naissance": _texte(p.get("naissance"), 40),
        "deces": _texte(p.get("deces"), 40),
        "decede": p.get("decede") is True or bool(_texte(p.get("deces"), 40)),
        "lieu": _texte(p.get("lieu"), 60),
        "unions": [],
    }
    if profondeur >= GENERATIONS_MAX:
        return personne
    for u in (p.get("unions") if isinstance(p.get("unions"), list) else [])[:UNIONS_MAX]:
        u = _dico(u)
        c = _dico(u.get("conjoint"))
        conjoint = None
        if _texte(c.get("nom"), 80):
            compteur[0] += 1
            conjoint = {"nom": _texte(c.get("nom"), 80), "sexe": c.get("sexe") if c.get("sexe") in ("h", "f") else "",
                        "naissance": _texte(c.get("naissance"), 40), "deces": _texte(c.get("deces"), 40),
                        "decede": c.get("decede") is True or bool(_texte(c.get("deces"), 40)),
                        "lieu": _texte(c.get("lieu"), 60)}
        enfants = [_personne(e, profondeur + 1, compteur)
                   for e in (u.get("enfants") if isinstance(u.get("enfants"), list) else [])[:ENFANTS_MAX]]
        enfants = [e for e in enfants if e["nom"] or e["unions"]]
        if conjoint or enfants:
            personne["unions"].append({"conjoint": conjoint, "enfants": enfants})
    return personne


# --------------------------------------------------------------------------
# Disposition
# --------------------------------------------------------------------------
def _largeur_couple(p):
    return BOITE_L + len(p["unions"]) * (ECART_CONJOINT + BOITE_L) if any(u["conjoint"] for u in p["unions"]) \
        else BOITE_L


def _mesurer(p):
    """Largeur du sous-arbre (mm), mémorisée dans p["_l"]."""
    for u in p["unions"]:
        for e in u["enfants"]:
            _mesurer(e)
        u["_l"] = sum(e["_l"] for e in u["enfants"]) + ECART_FRERES * max(0, len(u["enfants"]) - 1)
    enfants = sum(u["_l"] for u in p["unions"] if u["enfants"]) \
        + ECART_FRERES * max(0, sum(1 for u in p["unions"] if u["enfants"]) - 1)
    p["_l"] = max(_largeur_couple(p), enfants)
    return p["_l"]


def _placer(p, gauche, niveau, cases, liens):
    """Pose le sous-arbre de p à partir de l'abscisse « gauche » ; remplit cases et liens."""
    y = niveau * ETAGE
    couple = _largeur_couple(p)
    blocs = [u for u in p["unions"] if u["enfants"]]
    largeur_enfants = sum(u["_l"] for u in blocs) + ECART_FRERES * max(0, len(blocs) - 1)
    # Le couple est centré au-dessus de tous ses enfants (ou l'inverse s'il est plus large).
    x0 = gauche + (p["_l"] - couple) / 2
    debut_enfants = gauche + (p["_l"] - largeur_enfants) / 2
    cases.append({"p": p, "x": x0, "y": y, "conjoint": False})
    x_conjoint = x0 + BOITE_L + ECART_CONJOINT
    rang = 0
    for u in p["unions"]:
        if u["conjoint"]:
            cases.append({"p": u["conjoint"], "x": x_conjoint, "y": y, "conjoint": True})
            # Premier conjoint : double trait entre les deux cases. Les suivants : un trait qui passe
            # AU-DESSUS des cases, depuis la personne, sinon on croirait les conjoints unis entre eux.
            liens.append(("mariage", x0 + BOITE_L, x_conjoint, y + BOITE_H / 2, rang, x0 + BOITE_L / 2, y))
            rang += 1
            # Enfants du premier couple : depuis le milieu du double trait ; des couples suivants :
            # depuis le bas de la case de ce conjoint (on voit tout de suite qui est l'autre parent).
            u["_depart"] = ((x_conjoint - ECART_CONJOINT / 2, y + BOITE_H / 2) if rang == 1
                            else (x_conjoint + BOITE_L / 2, y + BOITE_H))
            x_conjoint += BOITE_L + ECART_CONJOINT
        else:
            # Enfants sans autre parent connu : depuis le bas de la case, un peu à gauche du milieu
            # (le milieu peut déjà servir au chemin des enfants du premier couple).
            u["_depart"] = (x0 + BOITE_L * 0.3, y + BOITE_H)
    x = debut_enfants
    for k, u in enumerate(blocs):
        centres = []
        for e in u["enfants"]:
            _placer(e, x, niveau + 1, cases, liens)
            centres.append(x + (e["_l"] - _largeur_couple(e)) / 2 + BOITE_L / 2)
            x += e["_l"] + ECART_FRERES
        y_enfants = (niveau + 1) * ETAGE
        # Chaque union a son propre chemin : descente depuis le couple jusqu'à un palier (plus bas
        # pour chaque union suivante, pour que les chemins ne se confondent pas), puis jusqu'au-dessus
        # de ses enfants, puis une barre qui ne couvre que ses enfants.
        palier = y + BOITE_H + 3 + 2.5 * k
        barre = y_enfants - 3
        liens.append(("descendance", u["_depart"], palier, barre, centres, y_enfants))


# --------------------------------------------------------------------------
# Dessin TikZ
# --------------------------------------------------------------------------
def _p(x, y):
    return f"({x:.1f}mm,{-y:.1f}mm)"


def dessiner(racine, afficher):
    _mesurer(racine)
    cases, liens = [], []
    _placer(racine, 0, 0, cases, liens)
    L = []
    for genre, *valeurs in liens:
        if genre == "mariage":
            x1, x2, y, rang, x_personne, y_haut = valeurs
            if rang == 0:
                L.append(f"\\draw[line width=0.7pt, cmariage] {_p(x1, y - 0.8)} -- {_p(x2, y - 0.8)};")
                L.append(f"\\draw[line width=0.7pt, cmariage] {_p(x1, y + 0.8)} -- {_p(x2, y + 0.8)};")
            else:
                haut = y_haut - 2.5 - 2.5 * rang
                x_conjoint = x2 + BOITE_L / 2
                L.append(f"\\draw[line width=0.9pt, cmariage, rounded corners=1mm] {_p(x_personne + 3 * rang, y_haut)} "
                         f"-- {_p(x_personne + 3 * rang, haut)} -- {_p(x_conjoint, haut)} -- {_p(x_conjoint, y_haut)};")
        else:
            (xd, yd), palier, barre, centres, y_enfants = valeurs
            milieu = (min(centres) + max(centres)) / 2
            if abs(milieu - xd) < 0.5 or len(centres) == 1 and min(centres) - 0.5 <= xd <= max(centres) + 0.5:
                L.append(f"\\draw[line width=0.6pt, clien] {_p(xd, yd)} -- {_p(xd, barre)};")
                milieu = xd
            else:
                L.append(f"\\draw[line width=0.6pt, clien, rounded corners=1mm] {_p(xd, yd)} -- {_p(xd, palier)} "
                         f"-- {_p(milieu, palier)} -- {_p(milieu, barre)};")
            gauche, droite = min(centres + [milieu]), max(centres + [milieu])
            if droite - gauche > 0.5:
                L.append(f"\\draw[line width=0.6pt, clien] {_p(gauche, barre)} -- {_p(droite, barre)};")
            for c in centres:
                L.append(f"\\draw[line width=0.6pt, clien] {_p(c, barre)} -- {_p(c, y_enfants)};")
    for c in cases:
        p = c["p"]
        couleur = {"h": "chomme", "f": "cfemme"}.get(p["sexe"], "cautre")
        lignes = [f"\\textbf{{{echapper(p['nom']) or '?'}}}"]
        dates = []
        if afficher["dates"]:
            if p["naissance"]:
                dates.append(f"° {echapper(p['naissance'])}")
            if p["decede"]:
                dates.append(f"† {echapper(p['deces'])}" if p["deces"] else "†")
        if dates:
            lignes.append("{\\scriptsize " + " -- ".join(dates) + "}")
        if afficher["lieux"] and p["lieu"]:
            lignes.append(f"{{\\scriptsize\\itshape {echapper(p['lieu'])}}}")
        contenu = "\\\\".join(lignes)
        style = "dashed" if c["conjoint"] else "solid"
        fond = "cdecede" if p["decede"] else "white"
        L.append(f"\\node[draw={couleur}, line width=0.9pt, {style}, fill={fond}, rounded corners=2mm, "
                 f"minimum width={BOITE_L}mm, minimum height={BOITE_H}mm, text width={BOITE_L - 3}mm, "
                 f"align=center, inner sep=1pt, font=\\footnotesize, anchor=north west] at {_p(c['x'], c['y'])} "
                 f"{{{contenu}}};")
    largeur = racine["_l"]
    hauteur = max(c["y"] for c in cases) + BOITE_H
    return Tex("\n".join(L)), largeur, hauteur, len(cases)


def preparer_arbre(brut, options):
    a = _dico(brut)
    compteur = [0]
    racine = _personne(a.get("racine"), 0, compteur)
    if not racine["nom"]:
        raise ErreurDonnees("Indique au moins le nom de l'ancêtre (la première personne de l'arbre).")
    o = _dico(a.get("options"))
    afficher = {"dates": o.get("dates") is not False, "lieux": o.get("lieux") is True}
    dessin, largeur, hauteur, nombre = dessiner(racine, afficher)
    # Format : A4 ou A3, orienté selon la forme de l'arbre.
    papier = "a3paper" if a.get("papier") == "A3" else "a4paper"
    paysage = largeur >= hauteur * 0.9
    # Place disponible (mm) : page moins les marges, le titre et la note ; l'arbre est réduit pour y tenir.
    cote_long, cote_court = (420, 297) if papier == "a3paper" else (297, 210)
    dispo_l, dispo_h = ((cote_long, cote_court) if paysage else (cote_court, cote_long))
    dispo_l, dispo_h = dispo_l - 24, dispo_h - 24 - 22 - (10 if _texte(a.get("note"), 10) else 0)
    echelle = min(1.0, dispo_l / largeur, dispo_h / hauteur)
    return {"arbre": {
        "titre": echapper(_texte(a.get("titre"), 120) or "ARBRE GÉNÉALOGIQUE"),
        "sous_titre": echapper(_texte(a.get("sous_titre"), 200)),
        "note": _paragraphes(_lignes(a.get("note"), 4, 400)),
        "dessin": dessin, "papier": Tex(papier), "paysage": paysage, "personnes": nombre,
        "echelle": Tex(f"{echelle:.3f}"),
        # Réduit au point d'être difficile à lire : on conseille le format A3 ou de couper l'arbre.
        "petit": echelle < 0.55,
    }, "o": options}


def generer_arbre(brut, options=None):
    contexte = preparer_arbre(brut, _options(options))
    return compiler(rendre_latex("arbre.tex.j2", contexte), {}, "lettre")
