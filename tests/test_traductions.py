"""Traductions anglais et italien (web/traductions.js) : complètes, sans doublon, et appliquées
aux messages du serveur et aux fenêtres confirm()/alert()/prompt() (que le traducteur de la page
ne voit pas : leur texte doit passer par tr()).

En cas d'échec : ajouter la ligne « "texte français": "traduction" » dans DICO.en ET DICO.it,
ou une ligne dans MOTIFS si le texte contient un nombre ou un nom variable."""
import ast
import importlib
import json
import re
from pathlib import Path

import pytest

RACINE = Path(__file__).resolve().parent.parent
SOURCE = (RACINE / "web" / "traductions.js").read_text(encoding="utf-8")
_PAIRE = re.compile(r'("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*")')
_MOTIF = re.compile(r'^\s+\[/(.+)/,\s*"')


def _bloc(debut, fin):
    return SOURCE[SOURCE.index(debut):SOURCE.index(fin)]


def _paires(bloc):
    """Toutes les paires "clé": "valeur" du bloc (il y en a parfois plusieurs par ligne)."""
    return [(json.loads(m.group(1)), json.loads(m.group(2))) for m in _PAIRE.finditer(bloc)]


DICO_EN = _paires(_bloc("const DICO = { en: {", "\n  }, it: {"))
DICO_IT = _paires(_bloc("\n  }, it: {", "} }[LANGUE] || {};"))
MOTIFS = {langue: [re.compile(m.group(1).replace("\\/", "/")) for l in bloc.split("\n") if (m := _MOTIF.match(l))]
          for langue, bloc in (("en", _bloc("const MOTIFS = { en: [", "], it: [")),
                               ("it", _bloc("], it: [", "] }[LANGUE]")))}
CLES = {"en": {k for k, _ in DICO_EN}, "it": {k for k, _ in DICO_IT}}


def traduit(texte, langue):
    texte = " ".join(texte.split())
    return (texte in CLES[langue] or texte[:1].upper() + texte[1:] in CLES[langue]
            or any(m.search(texte) for m in MOTIFS[langue]))


def test_dictionnaire_lu_en_entier():
    # Une fois les paires et les commentaires retirés, il ne doit rester que la ponctuation :
    # sinon une ligne mal écrite serait ignorée par ce test.
    reste = _PAIRE.sub("", _bloc("const DICO = { en: {", "} }[LANGUE] || {};"))
    reste = re.sub(r"//[^\n]*|const DICO = \{ en: \{|\}, it: \{|[\s,]", "", reste)
    assert reste == "" and len(DICO_EN) > 500
    assert MOTIFS["en"] and MOTIFS["it"]


@pytest.mark.parametrize("langue, paires", [("en", DICO_EN), ("it", DICO_IT)])
def test_pas_de_doublon_ni_de_traduction_vide(langue, paires):
    cles = [k for k, _ in paires]
    assert sorted({k for k in cles if cles.count(k) > 1}) == []
    assert [k for k, v in paires if not v.strip()] == []


def test_anglais_et_italien_ont_les_memes_textes():
    assert sorted(CLES["en"] - CLES["it"]) == [] and sorted(CLES["it"] - CLES["en"]) == []
    assert len(MOTIFS["en"]) == len(MOTIFS["it"])


# --------------------------------------------------------------------------
# Messages du serveur affichés au visiteur
# --------------------------------------------------------------------------
NON_AFFICHES = ("admin.py", "generer.py", "publier_hf.py", "miniatures.py")   # admin : page non traduite


def _messages_du_serveur():
    for fichier in sorted(RACINE.glob("*.py")):
        if fichier.name in NON_AFFICHES:
            continue
        for n in ast.walk(ast.parse(fichier.read_text(encoding="utf-8"))):
            if not isinstance(n, ast.Call):
                continue
            nom = getattr(n.func, "id", getattr(n.func, "attr", ""))
            if nom == "jsonify":
                textes = [k.value for k in n.keywords if k.arg == "erreur"]
            elif nom in ("ErreurDonnees", "CaractereInconnu", "ErreurIA"):     # ErreurCompilation : journal seulement
                textes = n.args[:1]
            else:
                continue
            for t in textes:
                if isinstance(t, ast.Constant) and isinstance(t.value, str):
                    yield f"{fichier.name}:{n.lineno}", t.value
                elif isinstance(t, ast.JoinedStr):              # f"… {MAXI} …" : la vraie valeur du module
                    yield f"{fichier.name}:{n.lineno}", "".join(
                        v.value if isinstance(v, ast.Constant) else _valeur(fichier.stem, v.value) for v in t.values)


def _valeur(module, expression):
    """Valeur d'une constante du module (MDP_MIN…) ; « 12 » pour une variable locale."""
    try:
        return str(eval(ast.unparse(expression), vars(importlib.import_module(module))))
    except Exception:
        return "12"


INTERNES = re.compile(r"introuvable : installe|^Étape inconnue\.$")       # installation du serveur, balise


@pytest.mark.parametrize("langue", ["en", "it"])
def test_messages_du_serveur_traduits(langue):
    manquants = [f"{ou}  {texte}" for ou, texte in _messages_du_serveur()
                 if not INTERNES.search(texte) and not traduit(texte, langue)]
    assert manquants == []


# --------------------------------------------------------------------------
# Fenêtres du navigateur : confirm(), alert(), prompt()
# --------------------------------------------------------------------------
SCRIPTS = sorted(f for f in (RACINE / "web").glob("*.js") if f.name != "admin.js")   # admin : non traduit


def test_fenetres_du_navigateur_passent_par_la_traduction():
    brutes = [f"{f.name}:{s.count(chr(10), 0, m.start()) + 1}" for f in SCRIPTS
              for s in [f.read_text(encoding="utf-8")]
              for m in re.finditer(r"\b(confirm|alert|prompt)\(\s*[\"'`]", s)]
    assert brutes == []


@pytest.mark.parametrize("langue", ["en", "it"])
def test_textes_passes_a_tr_sont_dans_le_dictionnaire(langue):
    appel = re.compile(r'(?:\(window\.tr \|\| \(\w => \w\)\)|\btraduit|\bt)\(\s*"((?:[^"\\]|\\.)*)"\s*[),]')
    manquants = [f"{f.name}  {json.loads(chr(34) + m.group(1) + chr(34))}" for f in SCRIPTS if f.name != "traductions.js"
                 for m in appel.finditer(f.read_text(encoding="utf-8"))
                 if not traduit(json.loads('"' + m.group(1) + '"'), langue)]
    assert manquants == []
