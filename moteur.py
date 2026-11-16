"""
Moteur de génération : données (dict)  ->  template LaTeX (Jinja2)  ->  pdflatex  ->  PDF (bytes)

Utilisé par :
  - app.py      (le site web)
  - generer.py  (la ligne de commande)

Règle d'or : TOUT ce qui vient de l'utilisateur est considéré comme dangereux.
Chaque donnée passe donc par trois filtres, dans cet ordre :
  1. normalisation  (types, longueurs, caractères invisibles)   -> preparer_cv / preparer_lettre
  2. échappement    (les caractères spéciaux LaTeX deviennent du texte) -> echapper
  3. compilation en bac à sable (pas de shell, durée limitée)   -> compiler
"""
import base64
import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
import unicodedata
from pathlib import Path

import jinja2

RACINE = Path(__file__).parent
TEMPLATES = RACINE / "templates"

# Durée maximale d'une compilation. Sur une petite machine (offre gratuite de Render : 0,1
# processeur), la monter avec DUREE_COMPILATION_MAX=60.
TIMEOUT_S = int(os.environ.get("DUREE_COMPILATION_MAX") or 20)
# Au plus 2 compilations LaTeX en même temps (COMPILATIONS_SIMULTANEES ; 1 sur une machine à
# 512 Mo de mémoire) : évite qu'une rafale de requêtes ne sature
# la machine. Une demande n'attend jamais indéfiniment sa place (ATTENTE_MAX_S), et au-delà
# de EN_ATTENTE_MAX demandes qui attendent, les suivantes sont refusées tout de suite :
# ainsi les fils du serveur ne restent jamais tous bloqués, et les pages répondent toujours.
_COMPILATIONS = threading.Semaphore(int(os.environ.get("COMPILATIONS_SIMULTANEES") or 2))
ATTENTE_MAX_S = 15
EN_ATTENTE_MAX = 6
_en_attente = 0
_verrou_attente = threading.Lock()

# Ressources accordées à chaque programme externe (LaTeX, poppler) : mémoire, temps de
# calcul, taille des fichiers écrits, fichiers ouverts. Un document piégé ne peut donc ni
# épuiser la mémoire du serveur, ni remplir son disque.
MEMOIRE_PROCESSUS_MO = int(os.environ.get("MEMOIRE_PROCESSUS_MO") or 1500)
FICHIER_MAX_MO = 64

# Taille maximale d'un document : texte total (après nettoyage) et nombre de pages.
VOLUME_MAX = {"cv": 30_000, "lettre": 8_000}
PAGES_MAX = {"cv": 4, "lettre": 2}

_journal = logging.getLogger(__name__)
_PRLIMIT = shutil.which("prlimit")
if not _PRLIMIT:
    _journal.warning("prlimit introuvable (paquet util-linux) : les programmes externes ne sont pas bridés.")

MODELES_CV = {
    "moderne": "Moderne (bandeau de couleur, photo ronde)",
    "classique": "Classique (sobre, 1 colonne, compatible ATS)",
    "europeen": "Européen (style Europass)",
    "africain": "Africain (état civil, photo, références)",
    "elegant": "Élégant (empattements, dates dans une colonne à gauche)",
    "compact": "Compact (bandeau de couleur, tient sur une page)",
}
MODELES_LETTRE = {
    "moderne": "Moderne (bandeau de couleur en haut)",
    "classique": "Classique (présentation française traditionnelle)",
    "epure": "Épurée (en-tête centré, filet de couleur)",
    "elegante": "Élégante (empattements, assortie au CV Élégant)",
}
# Les quatre parties du texte d'une lettre, dans l'ordre où elles sont imprimées.
PARTIES_LETTRE = ("accroche", "parcours", "entreprise", "conclusion")
LANGUES = ("fr", "en", "it")
COULEUR_DEFAUT = "1F4E79"


class ErreurDonnees(Exception):
    """Les données envoyées sont invalides (faute de l'utilisateur -> HTTP 400)."""


class ErreurCompilation(Exception):
    """LaTeX n'a pas réussi à produire le PDF (-> HTTP 422 ou 500)."""


class ServeurOccupe(Exception):
    """Trop de documents en cours de fabrication : réessayer dans quelques secondes (-> HTTP 503)."""


def executer(commande, duree_max, **options):
    """subprocess.run, avec des limites de ressources posées par prlimit (util-linux).
    prlimit plutôt que preexec_fn : ce dernier n'est pas sûr dans un serveur à plusieurs fils."""
    if _PRLIMIT:
        commande = [_PRLIMIT, f"--as={MEMOIRE_PROCESSUS_MO * 1024 * 1024}", f"--cpu={int(duree_max) + 5}",
                    f"--fsize={FICHIER_MAX_MO * 1024 * 1024}", "--nofile=256", "--", *commande]
    return subprocess.run(commande, timeout=duree_max, **options)


# --------------------------------------------------------------------------
# Libellés des rubriques, par langue
# --------------------------------------------------------------------------
# Écrits par nous (donc sûrs) : ils ne passent pas par l'échappement.
# Ne pas y mettre de caractère spécial LaTeX (& % $ # _ { } ~ ^ \).
LIBELLES = {
    "fr": {
        "cv": "Curriculum Vitae",
        "contact": "Contact",
        "infos": "Informations personnelles",
        "etat_civil": "État civil",
        "nom": "Nom et prénoms",
        "adresse": "Adresse",
        "telephone": "Téléphone",
        "email": "E-mail",
        "liens": "Liens",
        "date_naissance": "Date de naissance",
        "lieu_naissance": "Lieu de naissance",
        "nationalite": "Nationalité",
        "situation": "Situation matrimoniale",
        "permis": "Permis de conduire",
        "poste_vise": "Poste visé",
        "profil": "Profil",
        "experiences": "Expériences professionnelles",
        "formations": "Formation",
        "competences": "Compétences",
        "langues": "Langues",
        "interets": "Centres d'intérêt",
        "references": "Références",
        "certifications": "Certifications",
        "projets": "Projets",
        "certif": "Je certifie sur l'honneur l'exactitude des informations ci-dessus.",
        "cv_en_ligne": "Mon CV en ligne",
        "objet": "Objet :",
        "pj": "P.J. :",
        "date_lettre": "{lieu}, le {date}",
        "fait_a": "Fait à {lieu}, le {date}",
    },
    "en": {
        "cv": "Curriculum Vitae",
        "contact": "Contact",
        "infos": "Personal information",
        "etat_civil": "Personal details",
        "nom": "Full name",
        "adresse": "Address",
        "telephone": "Phone",
        "email": "E-mail",
        "liens": "Links",
        "date_naissance": "Date of birth",
        "lieu_naissance": "Place of birth",
        "nationalite": "Nationality",
        "situation": "Marital status",
        "permis": "Driving licence",
        "poste_vise": "Position sought",
        "profil": "Profile",
        "experiences": "Work experience",
        "formations": "Education",
        "competences": "Skills",
        "langues": "Languages",
        "interets": "Interests",
        "references": "References",
        "certifications": "Certifications",
        "projets": "Projects",
        "certif": "I hereby certify that the above information is true and correct.",
        "cv_en_ligne": "My online CV",
        "objet": "Subject:",
        "pj": "Encl.:",
        "date_lettre": "{lieu}, {date}",
        "fait_a": "Done at {lieu}, on {date}",
    },
    "it": {
        "cv": "Curriculum Vitae",
        "contact": "Contatti",
        "infos": "Informazioni personali",
        "etat_civil": "Dati personali",
        "nom": "Nome e cognome",
        "adresse": "Indirizzo",
        "telephone": "Telefono",
        "email": "E-mail",
        "liens": "Link",
        "date_naissance": "Data di nascita",
        "lieu_naissance": "Luogo di nascita",
        "nationalite": "Nazionalità",
        "situation": "Stato civile",
        "permis": "Patente di guida",
        "poste_vise": "Posizione desiderata",
        "profil": "Profilo",
        "experiences": "Esperienze professionali",
        "formations": "Istruzione e formazione",
        "competences": "Competenze",
        "langues": "Lingue",
        "interets": "Interessi",
        "references": "Referenze",
        "certifications": "Certificazioni",
        "projets": "Progetti",
        "certif": "Dichiaro sotto la mia responsabilità che le informazioni sopra riportate sono veritiere.",
        "cv_en_ligne": "Il mio CV online",
        "objet": "Oggetto:",
        "pj": "Allegati:",
        "date_lettre": "{lieu}, {date}",
        "fait_a": "Fatto a {lieu}, il {date}",
    },
}


# --------------------------------------------------------------------------
# FILTRE 2 : échappement LaTeX
# --------------------------------------------------------------------------
class Tex(str):
    """Marqueur : cette chaîne est DÉJÀ du LaTeX sûr, fabriqué par nous.
    echapper() n'y touche pas. Ne jamais envelopper une donnée brute dedans."""


REMPLACEMENTS = {
    "\\": r"\textbackslash{}",
    "&": r"\&",
    "%": r"\%",
    "$": r"\$",
    "#": r"\#",
    "_": r"\_",
    "{": r"\{",
    "}": r"\}",
    "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}",
}
# Une seule passe : chaque caractère d'origine est traité exactement une fois
# (dix .replace() à la suite abîmeraient le résultat des précédents).
MOTIF = re.compile("|".join(re.escape(c) for c in REMPLACEMENTS))


def echapper(valeur):
    """Parcourt toute la structure (dict / list / str) et échappe chaque texte."""
    if isinstance(valeur, Tex):
        return valeur
    if isinstance(valeur, str):
        return MOTIF.sub(lambda m: REMPLACEMENTS[m.group()], valeur)
    if isinstance(valeur, list):
        return [echapper(v) for v in valeur]
    if isinstance(valeur, dict):
        return {cle: echapper(v) for cle, v in valeur.items()}
    return valeur


# --------------------------------------------------------------------------
# FILTRE 1 : normalisation des données reçues
# --------------------------------------------------------------------------
# Espaces « exotiques » (souvent collés depuis Word) que pdflatex ne connaît pas.
_ESPACES = {
    0x202F: " ",  # espace fine insécable -> insécable
    0x2009: " ", 0x200A: " ", 0x2002: " ", 0x2003: " ",
    0x2028: "\n", 0x2029: "\n",
    0x2022: "-",       # puce « • »
}


def _nettoyer(s):
    s = unicodedata.normalize("NFC", s).translate(_ESPACES)
    # On retire les caractères de contrôle et invisibles (catégories C*),
    # sauf le saut de ligne et la tabulation.
    return "".join(c for c in s if c in "\n\t" or unicodedata.category(c)[0] != "C")


def _texte(v, maxi=300):
    """Champ sur UNE ligne."""
    if isinstance(v, bool) or not isinstance(v, (str, int, float)):
        return ""
    return " ".join(_nettoyer(str(v)).split())[:maxi]


def _lignes(v, maxi_lignes=40, maxi=400):
    """Champ multi-lignes -> liste de lignes non vides."""
    if isinstance(v, list):
        v = "\n".join(x for x in v if isinstance(x, str))
    if not isinstance(v, str):
        return []
    lignes = (_texte(l, maxi) for l in _nettoyer(v).split("\n"))
    return [l for l in lignes if l][:maxi_lignes]


def _liste(v, maxi):
    return [x for x in v if isinstance(x, dict)][:maxi] if isinstance(v, list) else []


def _dico(v):
    return v if isinstance(v, dict) else {}


def _joindre_lignes(lignes):
    r"""Lignes échappées -> un bloc LaTeX avec retours à la ligne.
    Le {} après \\ empêche LaTeX de lire un « [ » ou « * » en début de ligne
    suivante comme une option de la commande \\."""
    return Tex(" \\\\{}\n".join(echapper(lignes)))


def _paragraphes(lignes):
    """Lignes échappées -> paragraphes LaTeX (séparés par une ligne vide)."""
    return Tex("\n\n".join(echapper(lignes)))


_URL_OK = re.compile(r"^https?://[A-Za-z0-9._~:/?#@!&'()*+,;=%-]+$")
_EMAIL_OK = re.compile(r"^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")
_URL_ECHAP = {"%": r"\%", "#": r"\#", "&": r"\&", "_": r"\_"}


def _secable(texte):
    """Autorise un retour à la ligne après @ / . dans un lien déjà échappé :
    indispensable dans une colonne étroite (modèle moderne)."""
    return re.sub(r"([@/.])", r"\1\\allowbreak{}", texte)


def _lien(url, label):
    """Fabrique un \\href sûr. Si l'URL est douteuse : simple texte, sans lien."""
    url, label = _texte(url, 300), _texte(label, 120)
    if url and not re.match(r"^[a-z]+://", url, re.I):
        url = "https://" + url
    texte = _secable(echapper(label or re.sub(r"^https?://", "", url)))
    if not _URL_OK.match(url):
        return Tex(texte)
    cible = re.sub(r"[%#&_]", lambda m: _URL_ECHAP[m.group()], url)
    return Tex(r"\href{%s}{%s}" % (cible, texte))


def _email(email):
    email = _texte(email, 120)
    if not _EMAIL_OK.match(email):
        return Tex(echapper(email))
    return Tex(r"\href{mailto:%s}{%s}" % (echapper(email), _secable(echapper(email))))


def _photo(data_url):
    """« data:image/jpeg;base64,... » -> (nom de fichier, octets) ou None.
    On ne fait pas confiance au type annoncé : on vérifie la signature du fichier."""
    if not isinstance(data_url, str) or not data_url.startswith("data:image/"):
        return None
    try:
        octets = base64.b64decode(data_url.split(",", 1)[1], validate=True)
    except (IndexError, ValueError):
        raise ErreurDonnees("Photo illisible.")
    if len(octets) > 2_000_000:
        raise ErreurDonnees("Photo trop lourde (2 Mo maximum).")
    if octets.startswith(b"\xff\xd8\xff"):
        nom, taille = "photo.jpg", _taille_jpeg(octets)
    elif octets.startswith(b"\x89PNG\r\n\x1a\n"):
        # Largeur et hauteur : octets 16 à 24 de l'en-tête PNG (bloc IHDR).
        nom = "photo.png"
        taille = ((int.from_bytes(octets[16:20], "big"), int.from_bytes(octets[20:24], "big"))
                  if octets[12:16] == b"IHDR" else None)
    else:
        raise ErreurDonnees("Format de photo non accepté (JPEG ou PNG uniquement).")
    # Un petit fichier peut annoncer une image gigantesque (« bombe de décompression »)
    # qui épuiserait la mémoire du serveur : on refuse avant de la donner à LaTeX.
    if not taille or not all(1 <= c <= PHOTO_COTE_MAX for c in taille):
        raise ErreurDonnees(f"Photo illisible ou trop grande ({PHOTO_COTE_MAX} pixels de côté maximum).")
    return nom, octets


PHOTO_COTE_MAX = 4096


def _taille_jpeg(octets):
    """(largeur, hauteur) lues dans l'en-tête JPEG, ou None si on ne les trouve pas."""
    i = 2
    while i + 9 < len(octets):
        if octets[i] != 0xFF:
            return None
        marqueur = octets[i + 1]
        if marqueur == 0xFF:                 # octet de remplissage
            i += 1
            continue
        # SOF0…SOF15 (sauf C4, C8, CC) : le bloc qui contient les dimensions.
        if 0xC0 <= marqueur <= 0xCF and marqueur not in (0xC4, 0xC8, 0xCC):
            return (int.from_bytes(octets[i + 7:i + 9], "big"),
                    int.from_bytes(octets[i + 5:i + 7], "big"))
        if marqueur == 0xDA:                 # début des données : plus d'en-tête après
            return None
        i += 2 + int.from_bytes(octets[i + 2:i + 4], "big")
    return None


def _options(brut):
    o = _dico(brut)
    langue = o.get("langue") if o.get("langue") in LANGUES else "fr"
    couleur = o.get("couleur") if isinstance(o.get("couleur"), str) else ""
    couleur = couleur.lstrip("#").upper()
    if not re.fullmatch(r"[0-9A-F]{6}", couleur):
        couleur = COULEUR_DEFAUT
    # QR code imprimé en bas de la première page : l'adresse du CV en ligne, fabriquée par le
    # serveur (app.py). Contrôle strict : aucun caractère spécial LaTeX ne peut passer.
    qr = o.get("lien_qr") if isinstance(o.get("lien_qr"), str) else ""
    return {
        "modele": o.get("modele") if o.get("modele") in MODELES_CV else "classique",
        "modele_lettre": o.get("modele_lettre") if o.get("modele_lettre") in MODELES_LETTRE else "classique",
        "langue": langue,
        "couleur": Tex(couleur),
        "certifier": o.get("certifier") is True,
        "lien_qr": Tex(qr if len(qr) <= 200 and _QR_OK.match(qr) else ""),
    }


_QR_OK = re.compile(r"^https?://[A-Za-z0-9.:-]+(/[A-Za-z0-9.-]+)*$")


def _identite(brut):
    """Partie commune au CV et à la lettre."""
    d = {
        "nom": _texte(brut.get("nom"), 120),
        "titre": _texte(brut.get("titre"), 160),
        "ville": _texte(brut.get("ville"), 200),
        "telephone": _texte(brut.get("telephone"), 60),
        "email": _texte(brut.get("email"), 120),
    }
    if not d["nom"]:
        raise ErreurDonnees("Le nom est obligatoire.")
    d["email_tex"] = _email(d["email"]) if d["email"] else Tex("")
    return d


def preparer_cv(brut, options=None):
    """Données brutes du formulaire -> (contexte prêt pour le template, fichiers annexes)."""
    brut = _dico(brut)
    o = _options(options)
    t = LIBELLES[o["langue"]]
    cv = _identite(brut)
    fichiers = {}

    cv["profil"] = _paragraphes(_lignes(brut.get("profil"), 12, 900))
    cv["interets"] = _texte(brut.get("interets"), 500)

    cv["liens"] = [
        _lien(l.get("url"), l.get("label"))
        for l in _liste(brut.get("liens"), 6)
        if _texte(l.get("url")) or _texte(l.get("label"))
    ]

    ec = _dico(brut.get("etat_civil"))
    # Liste de couples (libellé, valeur) : seules les lignes remplies sont gardées.
    cv["etat_civil"] = [
        [Tex(t[cle]), _texte(ec.get(cle), 120)]  # liste et non tuple : echapper() parcourt les listes
        for cle in ("date_naissance", "lieu_naissance", "nationalite", "situation", "permis")
        if _texte(ec.get(cle))
    ]

    cv["experiences"] = []
    for e in _liste(brut.get("experiences"), 25):
        exp = {
            "poste": _texte(e.get("poste"), 160),
            "entreprise": _texte(e.get("entreprise"), 160),
            "lieu": _texte(e.get("lieu"), 120),
            "dates": _texte(e.get("dates"), 60),
            "points": _lignes(e.get("points"), 12),
        }
        if exp["poste"] or exp["entreprise"] or exp["points"]:
            cv["experiences"].append(exp)

    cv["formations"] = []
    for f in _liste(brut.get("formations"), 20):
        form = {
            "diplome": _texte(f.get("diplome"), 200),
            "ecole": _texte(f.get("ecole"), 200),
            "dates": _texte(f.get("dates"), 60),
            "details": _texte(f.get("details"), 500),
        }
        if form["diplome"] or form["ecole"]:
            cv["formations"].append(form)

    cv["competences"] = [
        {"categorie": _texte(c.get("categorie"), 80), "liste": _texte(c.get("liste"), 500)}
        for c in _liste(brut.get("competences"), 15)
        if _texte(c.get("liste")) or _texte(c.get("categorie"))
    ]
    cv["langues"] = [
        {"langue": _texte(l.get("langue"), 60), "niveau": _texte(l.get("niveau"), 80)}
        for l in _liste(brut.get("langues"), 12)
        if _texte(l.get("langue"))
    ]
    cv["certifications"] = [
        {"titre": _texte(c.get("titre"), 200), "organisme": _texte(c.get("organisme"), 160),
         "date": _texte(c.get("date"), 60)}
        for c in _liste(brut.get("certifications"), 12)
        if _texte(c.get("titre"))
    ]
    cv["projets"] = [
        {"titre": _texte(pr.get("titre"), 200), "dates": _texte(pr.get("dates"), 60),
         "details": _texte(pr.get("details"), 600)}
        for pr in _liste(brut.get("projets"), 12)
        if _texte(pr.get("titre"))
    ]
    cv["references"] = [
        {"nom": _texte(r.get("nom"), 120), "fonction": _texte(r.get("fonction"), 200),
         "contact": _texte(r.get("contact"), 160)}
        for r in _liste(brut.get("references"), 6)
        if _texte(r.get("nom"))
    ]

    photo = _photo(brut.get("photo"))
    cv["photo"] = Tex("")
    if photo:
        fichiers[photo[0]] = photo[1]
        cv["photo"] = Tex(photo[0])

    cv = echapper(cv)
    # Ligne de contact toute prête pour les en-têtes compacts.
    morceaux = [cv["ville"], cv["telephone"], cv["email_tex"], *cv["liens"]]
    cv["contact_tex"] = Tex(" \\textbar{} ".join(m for m in morceaux if m))
    # Les mêmes informations, une par ligne (bandeau du modèle moderne).
    cv["contact_lignes"] = [m for m in morceaux if m]
    return {"cv": cv, "o": o, "t": t}, fichiers


def preparer_lettre(brut, lettre, options=None):
    """Lettre de motivation : identité de l'expéditeur + contenu de la lettre."""
    o = _options(options)
    t = LIBELLES[o["langue"]]
    exp = _identite(_dico(brut))
    l = _dico(lettre)
    dest = _dico(l.get("destinataire"))

    # Le texte arrive en quatre parties (formulaire guidé) et/ou en un seul bloc « corps »
    # (anciennes sauvegardes, ligne de commande) : on les met bout à bout, dans l'ordre.
    parties = _dico(l.get("parties"))
    corps = [ligne for cle in PARTIES_LETTRE for ligne in _lignes(parties.get(cle), 10, 2000)]
    corps = (corps + _lignes(l.get("corps"), 30, 2000))[:30]
    if not corps:
        raise ErreurDonnees("Le texte de la lettre est vide.")

    # Documents administratifs (attestation, procuration…) : un titre centré remplace l'objet,
    # « Fait à …, le … » passe en bas, et il peut y avoir deux signataires.
    titre = echapper(_texte(l.get("titre"), 80))
    lieu, date = echapper(_texte(l.get("lieu"), 80)), echapper(_texte(l.get("date"), 60))
    if lieu and date:
        lieu_date = t["fait_a" if titre else "date_lettre"].format(lieu=lieu, date=date)
    else:
        lieu_date = lieu or date
    signataires = []
    for s in _liste(l.get("signataires"), 2):
        s = _dico(s)
        signataire = {"role": echapper(_texte(s.get("role"), 60)), "nom": echapper(_texte(s.get("nom"), 120)),
                      "mention": echapper(_texte(s.get("mention"), 120))}
        if signataire["role"] or signataire["nom"]:
            signataires.append(signataire)

    exp = echapper(exp)
    ctx = {
        "exp": exp,
        # Les mêmes coordonnées sur une seule ligne (en-têtes des modèles moderne et épuré).
        "expediteur_ligne": Tex(" \\enspace\\textbullet\\enspace ".join(
            m for m in (exp["ville"], exp["telephone"], exp["email_tex"]) if m)),
        "expediteur_tex": Tex(" \\\\{}\n".join(
            m for m in (exp["ville"], exp["telephone"], exp["email_tex"]) if m)),
        "destinataire_tex": _joindre_lignes(
            [x for x in (_texte(dest.get("nom"), 120), _texte(dest.get("entreprise"), 160)) if x]
            + _lignes(dest.get("adresse"), 5, 160)),
        "lieu_date": Tex(lieu_date),
        "objet": echapper(_texte(l.get("objet"), 300)),
        "salutation": echapper(_texte(l.get("salutation"), 160)),
        "corps": _paragraphes(corps),
        "formule": _paragraphes(_lignes(l.get("formule"), 4, 600)),
        "pj": echapper(_texte(l.get("pj"), 300)),
        "titre": titre,
        "signataires": signataires,
    }
    return {"l": ctx, "o": o, "t": t}, {}


# --------------------------------------------------------------------------
# Rendu du template
# --------------------------------------------------------------------------
_ENV = jinja2.Environment(
    loader=jinja2.FileSystemLoader(TEMPLATES),
    # Délimiteurs changés : {{ }} et {% %} entrent en collision avec LaTeX.
    variable_start_string=r"\VAR{",
    variable_end_string="}",
    block_start_string=r"\BLOCK{",
    block_end_string="}",
    comment_start_string=r"\#{",
    comment_end_string="}",
    trim_blocks=True,
    lstrip_blocks=True,
    # Variable absente -> erreur claire tout de suite, pas un trou dans le CV.
    undefined=jinja2.StrictUndefined,
)


def rendre_latex(nom_template, contexte):
    # « polices » : dossier des polices DejaVu, utilisé seulement par lualatex.
    return _ENV.get_template(nom_template).render(polices=Tex(POLICES), **contexte)


# --------------------------------------------------------------------------
# FILTRE 3 : compilation
# --------------------------------------------------------------------------
# Deux moteurs LaTeX :
#   - pdflatex : rapide (0,5 s), mais ne connaît que l'alphabet latin courant ;
#   - lualatex : plus lent (2 s), mais affiche tout ce que contient la police DejaVu,
#     dont les lettres des langues africaines (ɛ ɔ ŋ ɓ ɗ ẹ ọ …).
# On essaie toujours pdflatex d'abord ; lualatex ne sert que si un caractère l'exige.
# Les modèles sont écrits pour fonctionner avec les deux (voir _preambule.tex.j2).

# Fichiers LuaTeX fournis avec le projet (dossier texmf-local/), pour ne pas dépendre
# de l'installation du paquet système « texlive-luatex ».
_ENV_TEX = {**os.environ, "openin_any": "p", "openout_any": "p"}
if (RACINE / "texmf-local").is_dir():
    _ENV_TEX["TEXMFHOME"] = str(RACINE / "texmf-local")


def _dossier_polices():
    """Dossier contenant les polices DejaVu, ou "" si elles ne sont pas installées."""
    for dossier in ("/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/dejavu",
                    "/usr/share/fonts/TTF", "/usr/share/fonts/dejavu-serif-fonts"):
        if (Path(dossier) / "DejaVuSerif.ttf").is_file() and (Path(dossier) / "DejaVuSans.ttf").is_file():
            return dossier
    return ""


POLICES = _dossier_polices()
_lua_dispo = None
_verrou_lua = threading.Lock()


def lualatex_disponible():
    """Vrai si lualatex, son chargeur de polices et les polices DejaVu sont présents."""
    global _lua_dispo
    # Verrou : sans lui, un second visiteur arrivant PENDANT la vérification lirait une
    # réponse provisoire « non » et recevrait à tort « caractère non pris en charge ».
    with _verrou_lua:
        if _lua_dispo is None:
            dispo = False
            if POLICES and shutil.which("lualatex") and shutil.which("kpsewhich"):
                try:
                    r = executer(["kpsewhich", "luaotfload.sty"], 10, capture_output=True, env=_ENV_TEX)
                    dispo = r.returncode == 0
                except (OSError, subprocess.TimeoutExpired):
                    pass
            _lua_dispo = dispo
        return _lua_dispo


class CaractereInconnu(ErreurDonnees):
    """Le moteur LaTeX utilisé ne sait pas afficher un des caractères du texte."""


def _resume_erreur(log):
    """Ce qu'on garde du log LaTeX pour les journaux du serveur : le type d'erreur
    (lignes « ! … ») et le numéro de ligne du modèle, SANS le texte saisi par
    l'utilisateur (que LaTeX recopie après « l.42 »). Promis dans la page Confidentialité."""
    messages, lignes = [], []
    for ligne in log.splitlines():
        if ligne.startswith("! ") and len(messages) < 5:
            messages.append(ligne[:120])
        elif m := re.match(r"l\.(\d+) ", ligne):
            lignes.append(m.group(1))
    resume = "\n".join(messages) or "(pas de message d'erreur LaTeX)"
    if lignes:
        resume += "\nligne(s) du fichier .tex : " + ", ".join(lignes[:5])
    return resume


def _erreur_caractere(caractere):
    return CaractereInconnu(
        f"Le caractère « {caractere} » n'est pas pris en charge. "
        "Retire-le ou remplace-le, puis réessaie.")


def _compiler_avec(moteur_tex, source_latex, fichiers, duree_max):
    if shutil.which(moteur_tex) is None:
        raise ErreurCompilation(f"{moteur_tex} introuvable : installe TeX Live ou MiKTeX.")

    # Dossier temporaire : chaque compilation est isolée des autres.
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "doc.tex").write_text(source_latex, encoding="utf-8")
        for nom, octets in (fichiers or {}).items():
            (tmp / nom).write_bytes(octets)

        commande = [
            moteur_tex,
            "-no-shell-escape",          # LaTeX n'a PAS le droit d'exécuter des commandes
            "-interaction=nonstopmode",  # ne jamais attendre une saisie clavier
            "-halt-on-error",
            "doc.tex",
        ]
        try:
            with _place_de_compilation():
                # _ENV_TEX : mode « paranoïaque », LaTeX ne lit/écrit que dans son dossier.
                resultat = executer(commande, duree_max, cwd=tmp, capture_output=True, text=True,
                                    errors="replace", env=_ENV_TEX)
        except subprocess.TimeoutExpired:
            raise ErreurCompilation(f"Compilation interrompue après {duree_max} s.")

        # Caractère absent de la police : pdflatex s'arrête dessus ; lualatex, lui, laisse
        # un trou et le signale seulement. Dans les deux cas on refuse : un CV avec un
        # caractère manquant ne doit pas partir chez un recruteur.
        m = (re.search(r"Unicode character (.+?) \(U\+[0-9A-F]+\)", resultat.stdout)
             or re.search(r"Missing character: There is no (\S+) \(U\+", resultat.stdout))
        if m:
            raise _erreur_caractere(m.group(1))
        if resultat.returncode != 0:
            raise ErreurCompilation(f"Erreur LaTeX ({moteur_tex}) :\n{_resume_erreur(resultat.stdout)}")

        # LaTeX annonce lui-même le nombre de pages : « Output written on doc.pdf (3 pages, … ».
        m = re.search(r"Output written on \S*doc\.pdf \((\d+) pages?", resultat.stdout)
        return (tmp / "doc.pdf").read_bytes(), int(m.group(1)) if m else 0


class _place_de_compilation:
    """Une des 2 places de compilation, attendue ATTENTE_MAX_S au plus (sinon ServeurOccupe)."""

    def __enter__(self):
        global _en_attente
        with _verrou_attente:
            if _en_attente >= EN_ATTENTE_MAX:
                raise ServeurOccupe()
            _en_attente += 1
        try:
            obtenue = _COMPILATIONS.acquire(timeout=ATTENTE_MAX_S)
        finally:
            with _verrou_attente:
                _en_attente -= 1
        if not obtenue:
            raise ServeurOccupe()
        return self

    def __exit__(self, *erreur):
        _COMPILATIONS.release()
        return False


def compiler(source_latex, fichiers=None, genre="cv"):
    """Compile le LaTeX et renvoie le PDF (bytes). pdflatex d'abord, lualatex si nécessaire.
    Refuse (ErreurDonnees) un document de plus de PAGES_MAX[genre] pages."""
    try:
        pdf, pages = _compiler_avec("pdflatex", source_latex, fichiers, TIMEOUT_S)
    except CaractereInconnu:
        if not lualatex_disponible():
            raise
        # La toute première compilation lualatex prépare les polices : on lui laisse du temps.
        pdf, pages = _compiler_avec("lualatex", source_latex, fichiers, 3 * TIMEOUT_S)
    if pages > PAGES_MAX[genre]:
        if genre == "lettre":
            raise ErreurDonnees(f"Ta lettre fait {pages} pages : raccourcis-la "
                                f"({PAGES_MAX['lettre']} au maximum, une seule conseillée).")
        raise ErreurDonnees(f"Ton CV fait {pages} pages : raccourcis-le "
                            f"({PAGES_MAX['cv']} au maximum, 1 ou 2 conseillées).")
    return pdf


def _volume(valeur):
    """Nombre total de caractères de texte dans une structure (dict / list / str)."""
    if isinstance(valeur, str):
        return len(valeur)
    if isinstance(valeur, dict):
        valeur = valeur.values()
    if isinstance(valeur, (list, tuple, type({}.values()))):
        return sum(_volume(v) for v in valeur)
    return 0


def _verifier_volume(contenu, genre):
    """Refuse un document dont le texte total dépasse VOLUME_MAX[genre] caractères.
    contenu : les données DÉJÀ nettoyées (sans la photo, qui est un fichier à part)."""
    if _volume(contenu) > VOLUME_MAX[genre]:
        if genre == "lettre":
            raise ErreurDonnees("Ta lettre est trop longue : raccourcis-la avant de réessayer.")
        raise ErreurDonnees("Ton CV contient trop de texte : raccourcis-le avant de réessayer.")


# --------------------------------------------------------------------------
# Les deux fonctions à appeler de l'extérieur
# --------------------------------------------------------------------------
def generer_cv(donnees, options=None):
    contexte, fichiers = preparer_cv(donnees, options)
    _verifier_volume({cle: v for cle, v in contexte["cv"].items() if cle != "photo"}, "cv")
    latex = rendre_latex(f"cv_{contexte['o']['modele']}.tex.j2", contexte)
    return compiler(latex, fichiers, "cv")


def generer_lettre(donnees, lettre, options=None):
    contexte, fichiers = preparer_lettre(donnees, lettre, options)
    _verifier_volume(contexte["l"], "lettre")
    return compiler(rendre_latex(f"lettre_{contexte['o']['modele_lettre']}.tex.j2", contexte), fichiers, "lettre")


def pdf_vers_images(pdf, pages_max=3, resolution=96):
    """PDF -> liste d'images JPEG (bytes), une par page, pour l'aperçu à l'écran.
    Pourquoi des images ? Beaucoup de navigateurs de téléphone n'affichent pas
    un PDF à l'intérieur d'une page ; une image, si."""
    if shutil.which("pdftoppm") is None:
        raise ErreurCompilation("pdftoppm introuvable : installe le paquet poppler-utils.")
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "doc.pdf").write_bytes(pdf)
        try:
            executer(["pdftoppm", "-jpeg", "-r", str(resolution), "-f", "1", "-l", str(pages_max),
                      "doc.pdf", "page"], TIMEOUT_S, cwd=tmp, check=True, capture_output=True)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            raise ErreurCompilation("La conversion du PDF en image a échoué.")
        return [f.read_bytes() for f in sorted(tmp.glob("page*.jpg"))]
