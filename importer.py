"""
Import d'un CV ou d'une lettre déjà existants (PDF ou Word .docx) : on en extrait le texte,
puis on devine à quelle rubrique du formulaire appartient chaque passage.

C'est une aide au démarrage, pas une lecture parfaite : chaque CV est mis en page à sa
façon. L'utilisateur relit et corrige ensuite dans le formulaire.

Sécurité : le fichier vient d'un inconnu. On vérifie sa signature, sa taille une fois
décompressé, on limite la durée de lecture, et il est supprimé aussitôt lu.
"""
import html
import io
import re
import shutil
import subprocess
import tempfile
import unicodedata
import zipfile
from pathlib import Path

from moteur import ErreurCompilation, ErreurDonnees, executer

TEXTE_MAX = 60_000            # caractères gardés après extraction
DOCX_MAX = 8_000_000          # taille maximale du document.xml décompressé
PARTIES_LETTRE = ("accroche", "parcours", "entreprise", "conclusion")


# --------------------------------------------------------------------------
# 1. Fichier -> texte brut
# --------------------------------------------------------------------------
def extraire_texte(octets, mise_en_page=False):
    """mise_en_page (PDF seulement) : garde les colonnes côte à côte au lieu de suivre l'ordre
    de lecture. Utile quand les dates sont alignées à droite, loin de leur intitulé."""
    if octets.startswith(b"%PDF-"):
        texte = _texte_pdf(octets, mise_en_page)
        if len(texte.strip()) < 30:
            raise ErreurDonnees("Ce PDF ne contient pas de texte lisible (c'est sans doute une image "
                                "scannée). Essaie avec le fichier d'origine, ou remplis le formulaire.")
    elif octets.startswith(b"PK\x03\x04"):
        texte = _texte_docx(octets)
    elif octets.startswith(b"\xd0\xcf\x11\xe0"):
        raise ErreurDonnees("L'ancien format Word (.doc) n'est pas pris en charge. Enregistre ton "
                            "document en .docx ou en PDF, puis réessaie.")
    else:
        raise ErreurDonnees("Format non pris en charge. Envoie un fichier PDF ou Word (.docx).")
    return _nettoyer(texte)


def _nettoyer(texte):
    texte = unicodedata.normalize("NFC", texte)
    # Caractères de contrôle retirés, sauf saut de ligne et tabulation.
    texte = "".join(c for c in texte if c in "\n\t" or unicodedata.category(c)[0] != "C")
    return texte[:TEXTE_MAX]


def _texte_pdf(octets, mise_en_page=False):
    if shutil.which("pdftotext") is None:
        raise ErreurCompilation("pdftotext introuvable : installe le paquet poppler-utils.")
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "doc.pdf").write_bytes(octets)
        try:
            r = executer(["pdftotext", "-enc", "UTF-8", "-l", "6", *(["-layout"] if mise_en_page else []),
                          "doc.pdf", "-"], 15, cwd=tmp, capture_output=True)
        except subprocess.TimeoutExpired:
            raise ErreurDonnees("Ce PDF est trop long à lire. Essaie avec un fichier plus simple.")
        if r.returncode != 0:
            raise ErreurDonnees("Ce PDF n'a pas pu être lu (fichier abîmé ou protégé par mot de passe).")
        return r.stdout.decode("utf-8", errors="replace")


_LIGNE_BBOX = re.compile(r'<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</line>', re.S)
_MOT_BBOX = re.compile(r"<word[^>]*>(.*?)</word>", re.S)


def _texte_pdf_colonnes(octets):
    """Lecture d'un PDF d'après la position de chaque ligne : (texte, colonnes_vues), ou None.
    Les lignes à la même hauteur (intitulé à gauche, dates alignées à droite) sont réunies ;
    un CV en colonnes (barre latérale) est lu colonne par colonne au lieu d'entrecroiser leurs
    lignes."""
    if shutil.which("pdftotext") is None:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "doc.pdf").write_bytes(octets)
        try:
            r = executer(["pdftotext", "-enc", "UTF-8", "-l", "6", "-bbox-layout", "doc.pdf", "-"],
                         15, cwd=tmp, capture_output=True)
        except subprocess.TimeoutExpired:
            return None
    if r.returncode != 0:
        return None
    sortie = r.stdout.decode("utf-8", errors="replace")
    pages, colonnes_vues = [], False
    for page in re.split(r"<page ", sortie)[1:]:
        largeur = float(re.match(r'width="([\d.]+)"', page).group(1))
        lignes = []
        for x0, y0, x1, y1, contenu in _LIGNE_BBOX.findall(page):
            texte = html.unescape(" ".join(_MOT_BBOX.findall(contenu)))
            if texte.strip():
                lignes.append((float(x0), float(y0), float(x1), float(y1), texte))
        coupe = _coupe_colonnes(lignes, largeur)
        if coupe is None:
            pages.append(_rassembler(lignes))
            continue
        colonnes_vues = True
        gauche = [l for l in lignes if l[2] <= coupe]
        droite = [l for l in lignes if l[0] >= coupe]
        # Colonne de libellés (CV européen : titres et dates à gauche, texte à droite, sur la
        # même ligne) : on lit alors rangée par rangée. Une barre latérale, elle, a ses propres
        # lignes, rarement à la même hauteur que celles du texte principal.
        alignees = sum(1 for l in gauche if any(abs((l[1] + l[3]) - (d[1] + d[3])) <= 4 for d in droite))
        if alignees >= 0.35 * len(gauche):
            pages.append(_rassembler(lignes, titres_a_part=True))
            continue
        larges = sorted((l for l in lignes if l[0] < coupe < l[2]), key=lambda l: l[1])
        # La colonne qui porte le plus grand texte (le nom) est lue en premier.
        hauteur = lambda colonne: max((l[3] - l[1] for l in colonne), default=0)  # noqa: E731
        premiere, seconde = (gauche, droite) if hauteur(gauche) >= hauteur(droite) else (droite, gauche)
        # Une ligne sur toute la largeur (en-tête, bas de page) sépare des tranches de colonnes.
        morceaux, haut = [], float("-inf")
        for limite in [l[1] for l in larges] + [float("inf")]:
            for colonne in (premiere, seconde):
                tranche = [l for l in colonne if haut <= l[1] < limite]
                if tranche:
                    morceaux.append(_rassembler(tranche))
            ligne_large = next((l for l in larges if l[1] == limite), None)
            if ligne_large:
                morceaux.append(ligne_large[4])
            haut = limite
        pages.append("\n".join(morceaux))
    return "\n".join(pages), colonnes_vues


def _coupe_colonnes(lignes, largeur):
    """Abscisse d'une séparation verticale entre deux colonnes de texte, ou None : une bande
    vide d'au moins 12 points, entre 15 % et 70 % de la largeur, traversée par très peu de
    lignes, avec beaucoup de lignes de chaque côté."""
    if len(lignes) < 12:
        return None
    meilleure = None
    for x in range(int(largeur * 0.15), int(largeur * 0.70), 2):
        traversent = sum(1 for l in lignes if l[0] < x + 6 and l[2] > x - 6)
        gauche = sum(1 for l in lignes if l[2] <= x - 6)
        droite = sum(1 for l in lignes if l[0] >= x + 6)
        if traversent <= max(2, len(lignes) // 20) and min(gauche, droite) >= max(5, len(lignes) // 6):
            if meilleure is None or traversent < meilleure[0]:
                meilleure = (traversent, x)
    return meilleure[1] if meilleure else None


def _rubriques_cote_a_cote(rangs):
    """Deux rubriques côte à côte (« COMPÉTENCES      LANGUES ») : leurs lignes partagent les
    mêmes rangées. On remet chaque rubrique d'un bloc (la gauche, puis la droite), jusqu'au
    prochain titre placé contre la marge de gauche. Repère : un titre de rubrique qui ne
    commence pas contre la marge."""
    if not rangs:
        return rangs
    marge = min(r[0][0] for r in rangs)
    titre_marge = lambda r: _rubrique(r[0][4]) and r[0][0] <= marge + 15      # noqa: E731
    sortie, i = [], 0
    while i < len(rangs):
        decale = next((l for l in rangs[i] if _rubrique(l[4]) and l[0] > marge + 40), None)
        if decale is None:
            sortie.append(rangs[i])
            i += 1
            continue
        coupe = decale[0] - 20             # le texte peut commencer un peu avant son titre
        # Le bloc commence au titre de gauche (même rangée, ou une ou deux rangées plus haut).
        debut = i
        while debut > i - 3 and debut > 0 and not titre_marge(rangs[debut]):
            debut -= 1
        if not titre_marge(rangs[debut]):
            debut = i
        del sortie[len(sortie) - (i - debut):]
        gauche, droite, j = [], [], debut
        while j < len(rangs) and (j <= i or not titre_marge(rangs[j]) or len(rangs[j]) > 1):
            g = [l for l in rangs[j] if l[0] < coupe]
            d = [l for l in rangs[j] if l[0] >= coupe]
            if g:
                gauche.append(g)
            if d:
                droite.append(d)
            j += 1
        sortie.extend(gauche + droite)
        i = j
    return sortie


def _rassembler(lignes, titres_a_part=False):
    """Lignes (x0, y0, x1, y1, texte) -> texte, de haut en bas ; celles qui sont à la même
    hauteur sont réunies de gauche à droite. titres_a_part : un titre de rubrique placé en
    tête de rangée garde sa propre ligne."""
    rangs = []
    for l in sorted(lignes, key=lambda l: ((l[1] + l[3]) / 2, l[0])):
        milieu = (l[1] + l[3]) / 2
        if rangs and abs(rangs[-1][0] - milieu) <= 3:
            rangs[-1][1].append(l)
        else:
            rangs.append([milieu, [l]])
    for _, rang in rangs:
        rang.sort(key=lambda l: l[0])
    rangs = [rang for _, rang in rangs]
    if not titres_a_part:                  # colonne de libellés : ses titres sont tous à gauche
        rangs = _rubriques_cote_a_cote(rangs)
    sortie = []
    for rang in rangs:
        tete = rang[0][4]
        # « Informatique », « Outils »… sont aussi des catégories de compétences : titres seulement en capitales.
        # Un titre en capitales peut tenir sur deux lignes (« INFORMATIONS / PERSONNELLES ») : seul, il
        # n'est pas reconnu comme titre, mais il reste un titre et garde sa ligne.
        titre = (_rubrique(tete) and (tete.isupper() or _cle(tete) not in _TITRES_AMBIGUS)) \
            or (tete.isupper() and len(tete.split()) <= 3 and not re.search(r"\d", tete))
        if titres_a_part and len(rang) > 1 and titre:
            sortie.append(rang.pop(0)[4])
        texte = rang[0][4]
        for avant, apres in zip(rang, rang[1:]):
            # Libellé et valeur côte à côte (« Français    Courant ») : reliés par « : », comme
            # « Langue : niveau », « Catégorie : compétences », « Adresse : Dakar ».
            texte += (" : " if apres[0] - avant[2] > 12 else " ") + apres[4]
        sortie.append(texte)
    return "\n".join(sortie)


def _texte_docx(octets):
    """Un .docx est une archive ZIP ; le texte est dans word/document.xml.
    On le lit sans analyseur XML (pas d'entités piégées) : un paragraphe par <w:p>."""
    try:
        with zipfile.ZipFile(io.BytesIO(octets)) as archive:
            info = archive.getinfo("word/document.xml")
            if info.file_size > DOCX_MAX:       # « bombe » de décompression
                raise ErreurDonnees("Document trop volumineux.")
            xml = archive.read(info).decode("utf-8", errors="replace")
    except (zipfile.BadZipFile, KeyError, RuntimeError):
        raise ErreurDonnees("Ce fichier n'est pas un document Word (.docx) lisible.")
    paragraphes = []
    for bloc in re.findall(r"<w:p[ >].*?</w:p>", xml, flags=re.S):
        bloc = re.sub(r"<w:(tab|br|cr)\b[^>]*/>", " ", bloc)
        morceaux = re.findall(r"<w:t(?:\s[^>]*)?>(.*?)</w:t>", bloc, flags=re.S)
        paragraphes.append(html.unescape("".join(morceaux)))
    # Ligne vide entre deux paragraphes : dans un .docx, un paragraphe tient sur une seule ligne.
    return "\n\n".join(paragraphes)


# --------------------------------------------------------------------------
# Outils communs
# --------------------------------------------------------------------------
_EMAIL = re.compile(r"[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")
_TEL = re.compile(r"(?<![\w/])(?:\+|00)?\d[\d .()/-]{7,18}\d(?!\w)")
_URL = re.compile(r"(?:https?://|www\.)[^\s,;|]+|(?:linkedin\.com|github\.com)/[^\s,;|]+", re.I)
_PUCE = re.compile(r"^\s*(?:[-–—•●▪■◦*·‣➢>]|\d{1,2}[.)])\s+")
_MOIS = (r"(?:janv|févr|fevr|mars|avr|mai|juin|juil|août|aout|sept|oct|nov|déc|dec|jan|feb|mar|apr|may|jun|jul|aug|sep|"
         r"gen|mag|giu|lug|ago|set|ott|dic)[a-zéû]*\.?")
_AN = r"(?:19|20)\d{2}"
_MAINTENANT = r"(?:aujourd'?hui|présent|present|ce jour|actuel(?:lement)?|en cours|now|current|today|oggi|attuale|presente|in corso)"
_DATE = rf"(?:(?:\d{{1,2}}[/.-])?\d{{1,2}}[/.-]{_AN}|{_MOIS}\s+{_AN}|{_AN})"
# « 01/2024 – 10/2026 », « 2020 - 2023 », « depuis mars 2022 », « Sept. 2021 à aujourd'hui », « 2019 »
_PERIODE = re.compile(
    rf"(?:(?:depuis|since|dal|da)\s+)?{_DATE}(?:\s*(?:[-–—]+|à|au|a|to|al|until)\s*(?:{_DATE}|{_MAINTENANT}))?",
    re.I)


def _cle(texte):
    """Texte simplifié pour comparer des titres : minuscules, sans accents ni ponctuation."""
    sans = unicodedata.normalize("NFD", texte.lower())
    sans = "".join(c for c in sans if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z ]+", " ", sans).strip()


def _propre(ligne):
    return " ".join(_PUCE.sub("", ligne).split())


# Titres de rubriques reconnus (français, anglais, italien), sans accents.
_RUBRIQUES = {
    "profil": ["profil", "profil professionnel", "a propos", "a propos de moi", "presentation", "resume", "objectif",
               "objectif professionnel", "profile", "summary", "professional summary", "about me", "about", "objective",
               "career objective", "profilo", "profilo professionale", "chi sono", "obiettivo", "sommario"],
    "experiences": ["experience", "experiences", "experience professionnelle", "experiences professionnelles",
                    "parcours professionnel", "emplois", "stages", "stages et experiences", "work experience",
                    "professional experience", "employment", "employment history", "work history",
                    "esperienza", "esperienze", "esperienza professionale", "esperienze professionali",
                    "esperienza lavorativa", "esperienze lavorative"],
    "formations": ["formation", "formations", "etudes", "diplomes", "formation et diplomes", "parcours scolaire",
                   "parcours academique", "cursus", "education", "education and training", "academic background",
                   "qualifications", "istruzione", "formazione", "istruzione e formazione", "studi", "titoli di studio"],
    "competences": ["competences", "competences techniques", "competences professionnelles", "competences cles",
                    "savoir faire", "informatique", "outils", "atouts", "skills", "technical skills", "key skills",
                    "core skills", "competenze", "competenze tecniche", "competenze professionali", "capacita e competenze",
                    "competenze informatiche"],
    "langues": ["langues", "langues parlees", "langues etrangeres", "languages", "language skills", "lingue",
                "lingue straniere", "competenze linguistiche"],
    "interets": ["centres d interet", "centre d interet", "interets", "loisirs", "hobbies", "passions", "activites",
                 "divers", "interests", "hobbies and interests", "interessi", "hobby", "interessi personali", "tempo libero"],
    "references": ["references", "referenze", "referees"],
    "ignorer": ["contact", "contacts", "coordonnees", "informations personnelles", "etat civil", "infos personnelles",
                "personal information", "personal details", "contatti", "informazioni personali", "dati personali",
                "curriculum vitae", "cv", "publications", "distinctions", "awards"],
    "certifications": ["certifications", "certification", "certificats", "certificats et attestations", "attestations",
                       "certificates", "licenses and certifications", "certificazioni", "attestati"],
    "projets": ["projets", "projets realises", "projets personnels", "realisations", "projects", "personal projects",
                "progetti", "progetti personali"],
}
_TITRES = {titre: rubrique for rubrique, titres in _RUBRIQUES.items() for titre in titres}
_TITRES_AMBIGUS = {"informatique", "outils", "atouts", "divers", "activites", "passions", "hobby", "studi"}


def _rubrique(ligne):
    """La rubrique annoncée par cette ligne si c'est un titre (« EXPÉRIENCES : »), sinon None."""
    if len(ligne) > 45 or _PUCE.match(ligne):
        return None
    return _TITRES.get(_cle(ligne))


# --------------------------------------------------------------------------
# 2a. Texte -> CV
# --------------------------------------------------------------------------
# Libellés « Nom : … », « Date de naissance : … » (état civil), sans accents.
_LIBELLES = {
    "nom": ["nom et prenoms", "nom et prenom", "nom prenom", "noms et prenoms", "nom complet", "nom", "full name", "name",
            "nome e cognome", "nome"],
    "ville": ["adresse", "domicile", "ville", "lieu de residence", "address", "location", "indirizzo", "residenza"],
    "telephone": ["telephone", "tel", "mobile", "portable", "phone", "telefono", "cellulare"],
    "email": ["e mail", "email", "mail", "courriel", "adresse e mail"],
    "date_naissance": ["date de naissance", "ne le", "nee le", "date of birth", "data di nascita"],
    "lieu_naissance": ["lieu de naissance", "place of birth", "luogo di nascita"],
    "nationalite": ["nationalite", "nationality", "nazionalita", "cittadinanza"],
    "situation": ["situation matrimoniale", "situation familiale", "situation de famille", "etat matrimonial",
                  "marital status", "stato civile"],
    "permis": ["permis de conduire", "permis", "driving licence", "driving license", "patente di guida", "patente"],
    "titre": ["poste vise", "poste recherche", "position sought", "desired position", "posizione desiderata"],
}
_CLES_LIBELLES = sorted(((cle, champ) for champ, cles in _LIBELLES.items() for cle in cles),
                        key=lambda paire: -len(paire[0]))
_ETAT_CIVIL = ("date_naissance", "lieu_naissance", "nationalite", "situation", "permis")
_NIVEAU = re.compile(r"courant|maternelle|bilingue|natif|native|fluent|notions|scolaire|debutant|intermediaire|avance|"
                     r"basic|beginner|intermediate|advanced|proficient|madrelingua|fluente|base|buono|ottimo|"
                     r"^[abc][12]$", re.I)


def _libelle(ligne):
    """« Date de naissance : 12 mars 1999 » ou « Adresse Dakar » -> (champ, valeur).
    (champ, "") si la ligne ne contient que le libellé ; (None, None) si ce n'en est pas un."""
    cle = _cle(ligne.split(":")[0]) if ":" in ligne else _cle(ligne)
    for libelle, champ in _CLES_LIBELLES:
        if cle == libelle:
            return champ, ligne.split(":", 1)[1].strip() if ":" in ligne else ""
        if ":" not in ligne and cle.startswith(libelle + " "):
            # Valeur sur la même ligne, sans deux-points : on retire autant de mots que le libellé en compte.
            return champ, " ".join(ligne.split()[len(libelle.split()):])
    return None, None


def _ressemble_a_un_nom(ligne):
    mots = ligne.split()
    return (2 <= len(mots) <= 5 and _cle(ligne) not in _TITRES
            and all(re.fullmatch(r"[^\W\d_][^\W\d_'’.-]*", mot) and mot[0].isupper() for mot in mots))


def _nom_propre(ligne):
    return " ".join(mot.capitalize() if mot.isupper() and len(mot) > 3 else mot for mot in ligne.split())


def analyser_cv(texte):
    lignes = []
    for l in (l.strip() for l in texte.replace("\r", "").split("\n")):
        if lignes and re.search(r"\s[|·•]\s", lignes[-1]) and len(re.findall(r"\s:\s", lignes[-1])) >= 2 \
                and (lignes[-1].endswith(":") or re.search(r"\s:\s", l)) and not _rubrique(l):
            # État civil sur plusieurs lignes, coupé n'importe où : « … · Situation / matrimoniale : Célibataire · … »
            lignes[-1] += " " + l
        elif l.startswith(":") and lignes:
            lignes[-1] += " " + l          # « Situation matrimoniale / : Célibataire » coupé par la mise en page
        elif lignes and l[:1].islower() and re.search(r"[^\W\d_]-$", lignes[-1]):
            lignes[-1] = lignes[-1][:-1] + l   # mot coupé en fin de ligne : « Séné- / galaise »
        elif l:
            lignes.append(l)
    cv = {"nom": "", "titre": "", "email": "", "telephone": "", "ville": "", "profil": "", "interets": "",
          "etat_civil": {}, "experiences": [], "formations": [], "competences": [], "langues": [], "liens": [],
          "certifications": [], "projets": [], "references": []}

    # ---- Coordonnées : reconnaissables où qu'elles soient, sauf dans les références
    #      (le téléphone d'un ancien employeur n'est pas celui du candidat) ----
    sans_refs, dans_refs = [], False
    for l in lignes:
        rubrique = _rubrique(l)
        if rubrique:
            dans_refs = rubrique == "references"
        elif not dans_refs:
            sans_refs.append(l)
    coordonnees = "\n".join(sans_refs)
    m = _EMAIL.search(coordonnees)
    if m:
        cv["email"] = m.group()
    for m in _TEL.finditer(_PERIODE.sub(" ", coordonnees)):
        if 8 <= sum(c.isdigit() for c in m.group()) <= 15:
            cv["telephone"] = " ".join(m.group().split())
            break
    for m in list(_URL.finditer(texte))[:4]:
        url = m.group().rstrip(".)")
        if "@" not in url:
            cv["liens"].append({"label": re.sub(r"^https?://(www\.)?", "", url)[:60], "url": url})

    # ---- Libellés d'état civil (« Nationalité : Sénégalaise »), avec la valeur sur la même
    #      ligne ou sur la suivante. Ces lignes sont retirées du reste de l'analyse. ----
    trouves, restantes, i = {}, [], 0
    while i < len(lignes):
        morceaux = ([x.strip() for x in re.split(r"\s[|·•]\s|\|", lignes[i]) if x.strip()]
                    if re.search(r"\||\s[·•]\s", lignes[i]) else [lignes[i]])
        paires = [_libelle(x) for x in morceaux]
        if all(champ for champ, _ in paires):
            for champ, valeur in paires:
                if not valeur and len(paires) == 1 and i + 1 < len(lignes):
                    suivante = lignes[i + 1].lstrip(": ").strip()
                    if lignes[i + 1].startswith(":") or (not _rubrique(lignes[i + 1]) and not _libelle(lignes[i + 1])[0]
                                                         and len(suivante) <= 60):
                        valeur, i = suivante, i + 1
                if valeur:
                    trouves.setdefault(champ, valeur.lstrip(": ").strip()[:160])
            i += 1
            continue
        restantes.append(lignes[i])
        i += 1
    lignes = restantes
    cv["etat_civil"] = {c: trouves[c] for c in _ETAT_CIVIL if c in trouves}
    cv["ville"] = trouves.get("ville", "")
    cv["titre"] = trouves.get("titre", "")
    if trouves.get("nom"):
        cv["nom"] = _nom_propre(trouves["nom"])

    # ---- Découpage en rubriques (un titre peut tenir sur deux lignes : « EXPÉRIENCES / PROFESSIONNELLES ») ----
    blocs, courant, i = {"entete": []}, "entete", 0
    while i < len(lignes):
        deux = (_rubrique(lignes[i] + " " + lignes[i + 1])
                if i + 1 < len(lignes) and lignes[i].isupper() and not re.search(r"\d", lignes[i + 1]) else None)
        rubrique = deux or _rubrique(lignes[i])
        if rubrique and rubrique == courant and not deux and not lignes[i].isupper():
            rubrique = None      # « Informatique » sous « Compétences » : une catégorie, pas un nouveau titre
        if rubrique:
            courant = rubrique
            blocs.setdefault(courant, [])
            i += 2 if deux else 1
            continue
        blocs[courant].append(lignes[i])
        i += 1

    def coordonnee(l):
        return bool(_EMAIL.search(l) or _URL.search(l) or _TEL.search(l))

    # ---- Nom : la ligne « qui ressemble à un nom » la plus plausible. Indices : elle reprend
    #      l'adresse e-mail, elle est tout en haut, ou elle précède un titre de rubrique. ----
    if not cv["nom"]:
        local = _cle(cv["email"].split("@")[0]) if cv["email"] else ""
        meilleur = (0, None, None)
        for rubrique, contenu in blocs.items():
            for k, ligne in enumerate(contenu):
                if not _ressemble_a_un_nom(ligne) or coordonnee(ligne):
                    continue
                points = sum(3 for mot in _cle(ligne).split() if len(mot) > 2 and mot in local)
                if rubrique == "entete" and k < 3:
                    points += 2
                if rubrique not in ("experiences", "formations", "references", "entete") and k >= len(contenu) - 2:
                    points += 1          # nom placé après une colonne latérale, juste avant la suite
                if points > meilleur[0]:
                    meilleur = (points, rubrique, k)
        if meilleur[1] is not None:
            contenu = blocs[meilleur[1]]
            cv["nom"] = _nom_propre(contenu.pop(meilleur[2]))
            # La ligne qui suit le nom est souvent le poste visé.
            if not cv["titre"] and meilleur[2] < len(contenu):
                suite = contenu[meilleur[2]]
                if len(suite.split()) <= 9 and len(suite) <= 80 and not coordonnee(suite) and not _PERIODE.search(suite):
                    cv["titre"] = contenu.pop(meilleur[2])
    entete = [l for l in blocs["entete"] if not coordonnee(l)]
    if not cv["titre"]:
        # Sous « CURRICULUM VITAE », la première ligne est souvent le poste visé.
        courtes = [l for l in entete + blocs.get("ignorer", [])[:1] if len(l.split()) <= 8 and not re.search(r"\d", l) and "," not in l]
        if courtes:
            cv["titre"] = courtes[0]
    if not cv["ville"]:
        # « Accra, Ghana | +233… | adresse@… » : la ville est le morceau sans chiffres ni adresse.
        morceaux = [m.strip() for l in blocs["entete"] + blocs.get("ignorer", []) for m in re.split(r"[|•·]", l)]
        for morceau in morceaux:
            if "," in morceau and len(morceau) <= 60 and not coordonnee(morceau) and morceau != cv["titre"] \
                    and not re.search(r"\d{3,}", morceau):
                cv["ville"] = morceau
                break
    if "profil" not in blocs:
        longues = [l for l in entete if len(l.split()) >= 8]
        if longues:
            blocs["profil"] = longues

    cv["profil"] = _phrases(blocs.get("profil", []))[:2500]
    cv["interets"] = " ".join(_propre(l) for l in blocs.get("interets", []))[:500]
    cv["experiences"] = [
        {"poste": e["titre"], **_employeur_et_lieu(e["sous_titre"]), "dates": e["dates"],
         "points": "\n".join(e["details"])}
        for e in _entrees(blocs.get("experiences", []))][:25]
    cv["formations"] = [
        {"diplome": e["titre"], "ecole": e["sous_titre"], "dates": e["dates"], "details": " ".join(e["details"])[:500]}
        for e in _entrees(blocs.get("formations", []))][:20]

    # ---- Certifications : « Intitulé, organisme – 2025 » ; projets : comme les expériences ----
    date_avant = ""
    for ligne in (_propre(l) for l in blocs.get("certifications", [])[:24]):
        periode = _PERIODE.search(ligne)
        if periode:
            ligne = " ".join((ligne[:periode.start()] + " " + ligne[periode.end():]).split()).strip(" -–—|,:;()")
        precedente = cv["certifications"][-1] if cv["certifications"] else None
        if not ligne and periode:
            if precedente and not precedente["date"]:
                precedente["date"] = periode.group().strip()      # date seule sous l'intitulé
            else:
                date_avant = periode.group().strip()              # date seule AVANT l'intitulé
            continue
        if precedente and ligne and not periode and not precedente["organisme"] and len(ligne.split()) <= 6:
            precedente["organisme"] = ligne[:160]                 # organisme sous l'intitulé
            continue
        if not ligne:
            continue
        titre, organisme = _couper(ligne)
        if not organisme and "," in titre:
            titre, _, organisme = (x.strip() for x in titre.partition(","))
        if titre:
            cv["certifications"].append({"titre": titre[:200], "organisme": organisme[:160],
                                         "date": periode.group().strip() if periode else date_avant})
            date_avant = ""
    cv["projets"] = [
        {"titre": e["titre"][:200], "dates": e["dates"],
         "details": " ".join(x for x in [e["sous_titre"], *e["details"]] if x)[:600]}
        for e in _entrees(blocs.get("projets", []))][:12]

    # ---- Compétences : « Catégorie : liste », ou une catégorie seule sur sa ligne suivie de la liste ----
    lignes_c = [_propre(l) for l in blocs.get("competences", [])]
    for k, ligne in enumerate(lignes_c):
        categorie, sep, suite = ligne.partition(":")
        precedente = cv["competences"][-1] if cv["competences"] else None
        if sep and suite.strip() and len(categorie) <= 40:
            cv["competences"].append({"categorie": categorie.strip(), "liste": suite.strip()})
        elif precedente and (precedente["liste"].endswith(",") or not precedente["liste"]):
            precedente["liste"] = (precedente["liste"] + " " + ligne).strip()
        elif "," not in ligne and len(ligne.split()) <= 3 and k + 1 < len(lignes_c) and "," in lignes_c[k + 1]:
            cv["competences"].append({"categorie": ligne.rstrip(" :"), "liste": ""})
        elif ligne:
            cv["competences"].append({"categorie": "", "liste": ligne})
    cv["competences"] = [{"categorie": c["categorie"], "liste": c["liste"][:500]}
                         for c in cv["competences"] if c["liste"]][:15]

    # ---- Langues : « Anglais : B2 », « Anglais (courant) », « Anglais – B1 » ----
    for ligne in blocs.get("langues", []):
        for morceau in re.split(r"[;,|•●]|\s{3,}", _propre(ligne)):
            m = re.match(r"\s*([^\W\d_][^:()–—-]{1,30}?)\s*(?:[:–—-]|\(|\s{2,})\s*(.+?)\)?\s*$", morceau)
            if m:
                cv["langues"].append({"langue": m.group(1).strip(), "niveau": m.group(2).strip()[:80]})
            elif morceau.strip() and len(morceau.split()) <= 4:
                cv["langues"].append({"langue": morceau.strip(), "niveau": ""})
    # Présentation en deux colonnes : toutes les langues, puis tous les niveaux.
    n = len(cv["langues"])
    if n >= 2 and n % 2 == 0 and not any(l["niveau"] for l in cv["langues"]) \
            and all(_NIVEAU.search(_cle(l["langue"]) if len(l["langue"]) > 2 else l["langue"]) for l in cv["langues"][n // 2:]):
        cv["langues"] = [{"langue": a["langue"], "niveau": b["langue"]}
                         for a, b in zip(cv["langues"][:n // 2], cv["langues"][n // 2:])]
    cv["langues"] = cv["langues"][:12]

    # ---- Références : « Nom, fonction – téléphone » (une ligne coupée en deux est recollée) ----
    refs = []
    for ligne in (_propre(l) for l in blocs.get("references", [])):
        if refs and (ligne[:1].isdigit() or ligne[:1].islower()):
            refs[-1] += " " + ligne
        elif ligne:
            refs.append(ligne)
    for ligne in refs[:6]:
        if re.search(r"sur demande|on request|su richiesta", ligne, re.I):
            continue
        contact = _EMAIL.search(ligne) or _TEL.search(ligne)
        if contact:
            ligne = (ligne[:contact.start()] + ligne[contact.end():]).strip(" –—-,;:|")
        nom, _, suite = ligne.partition(",")
        cv["references"].append({"nom": nom.strip()[:120], "fonction": suite.strip()[:200],
                                 "contact": " ".join(contact.group().split()) if contact else ""})
    return cv


def _phrases(lignes):
    """Recolle un paragraphe coupé en lignes par la mise en page."""
    return " ".join(_propre(l) for l in lignes)


def _entrees(lignes):
    """Découpe une rubrique « expériences » ou « formation » en entrées
    {titre, sous_titre, dates, details}. Le repère : chaque entrée a une période.
    Deux présentations existent : la période EN TÊTE de chaque entrée (« 2020 – 2023 : Licence… »),
    ou APRÈS l'intitulé (« Licence… / Université / 2020 – 2023 »)."""
    def periode_de(ligne):
        return None if _PUCE.match(ligne) else _PERIODE.search(_propre(ligne))

    # Quelle présentation ? On regarde les lignes qui portent une période.
    avec_texte = seules = 0
    for l in lignes:
        m = periode_de(l)
        if m:
            reste = (_propre(l)[:m.start()] + _propre(l)[m.end():]).strip(" -–—|,:;()")
            avec_texte, seules = avec_texte + bool(len(reste) > 3), seules + bool(len(reste) <= 3)
    premiere = next((l for l in lignes if not _PUCE.match(l)), "")
    m = periode_de(premiere)
    if avec_texte > seules:
        mode = "meme_ligne"            # « Licence en gestion        2020 – 2023 » : la période ouvre l'entrée
    elif m and m.start() <= 2:
        mode = "avant"                 # période seule sur sa ligne, AVANT l'intitulé
    else:
        mode = "apres"                 # période seule sur sa ligne, APRÈS l'intitulé
    entrees, e = [], None

    def nouvelle():
        nonlocal e
        e = {"titre": "", "sous_titre": "", "dates": "", "details": []}
        entrees.append(e)

    for i, brute in enumerate(lignes):
        puce = bool(_PUCE.match(brute))
        ligne = _propre(brute)
        periode = periode_de(brute)
        if mode != "apres":
            debute = bool(periode)
        else:
            # Un intitulé court, suivi de près par une période : c'est le début d'une nouvelle entrée.
            proches = [_propre(x) for x in lignes[i + 1:i + 3] if not _PUCE.match(x)]
            annonce = not puce and len(ligne.split()) <= 12 and (
                bool(periode) or any(_PERIODE.search(x) and len(x) < 60 for x in proches))
            debute = annonce and e is not None and bool(e["details"] or (e["dates"] and e["titre"]))
        if e is None or debute:
            nouvelle()
        if periode and not e["dates"]:
            e["dates"] = periode.group().strip()
            ligne = " ".join((ligne[:periode.start()] + " " + ligne[periode.end():]).split()).strip(" -–—|,:;()")
            if not ligne:
                continue
            if periode.start() <= 2 and not e["titre"] and "," in ligne and not re.search(r"\s[–—|·•-]\s", ligne):
                # « 2020 : Baccalauréat série G, Lycée Exemple »
                e["titre"], _, e["sous_titre"] = (x.strip() for x in ligne.partition(","))
                continue
        if puce or (e["titre"] and e["sous_titre"]):
            e["details"].append(ligne)
        elif not e["titre"]:
            e["titre"], e["sous_titre"] = _couper(ligne)
        else:
            e["sous_titre"] = ligne
    return [x for x in entrees if x["titre"] or x["details"]]


_FORMES_SOCIETE = re.compile(r"\b(sarl|sa|sas|sasu|eurl|srl|spa|snc|gie|inc|ltd|llc|gmbh|plc|co)\.?$", re.I)


def _employeur_et_lieu(texte):
    """« Cabinet Exemple, Dakar » -> employeur « Cabinet Exemple », lieu « Dakar ».
    Le dernier morceau après une virgule est un lieu s'il est court et sans chiffres
    (« Orange, SA » reste entier : SA est une forme de société)."""
    employeur, virgule, lieu = texte.rpartition(",")
    lieu = lieu.strip()
    if virgule and employeur.strip() and 1 <= len(lieu.split()) <= 3 and lieu[:1].isupper() \
            and not re.search(r"\d", lieu) and not _FORMES_SOCIETE.search(lieu):
        return {"entreprise": employeur.strip(), "lieu": lieu}
    return {"entreprise": texte, "lieu": ""}


def _couper(ligne):
    """« Assistante comptable – Cabinet Exemple » : poste et employeur sur une même ligne."""
    m = re.search(r"\s+[–—|·•]\s+|\s+-\s+|\s+(?:chez|at|presso)\s+|\s+@\s+", ligne)
    if m and m.start() >= 3:
        return ligne[:m.start()].strip(), ligne[m.end():].strip()
    return ligne, ""


# --------------------------------------------------------------------------
# 2b. Texte -> lettre
# --------------------------------------------------------------------------
_APPEL = re.compile(r"^(madame|monsieur|mesdames|messieurs|ch[eè]re?s?\b|bonjour|dear\b|hello\b|to whom|"
                    r"gentil|egregi|spett|buongiorno|alla cortese)", re.I)
_POLITESSE = re.compile(r"salutations|agr[ée]er|cordialement|respectueu|bien à vous|sincerely|faithfully|regards|"
                        r"yours truly|distinti saluti|cordiali saluti|cordialmente|in fede|porgo", re.I)
_OBJET = re.compile(r"^\s*(?:objet|subject|oggetto|re)\s*:\s*(.+)", re.I)
_PJ = re.compile(r"^\s*(?:p\.?\s?j\.?|pi[èe]ces? jointes?|encl?\.?|enclosures?|attachments?|allegat[oi])\s*:?\s*(.+)", re.I)


def _paragraphes(texte):
    """Texte -> liste de paragraphes (chacun une liste de lignes).
    Un PDF ne garde pas toujours les lignes vides : on repère alors la fin d'un paragraphe
    à sa dernière ligne, plus courte que les autres et terminée par une ponctuation."""
    lignes = [" ".join(l.split()) for l in texte.replace("\r", "").split("\n")]
    # Largeur d'une ligne « pleine » : la médiane des lignes longues (le texte de la lettre).
    longues = sorted(len(l) for l in lignes if len(l) >= 45)
    largeur = longues[len(longues) // 2] if longues else 0
    paragraphes, courant = [], []
    for ligne in lignes + [""]:
        if not ligne:
            if courant:
                paragraphes.append(courant)
            courant = []
            continue
        courant.append(ligne)
        fin_de_phrase = ligne.endswith((".", "!", "?", "»", "”")) or len(ligne) < 0.5 * largeur
        if fin_de_phrase and len(ligne) < 0.9 * largeur:
            paragraphes.append(courant)
            courant = []
    return paragraphes


def _recoller(lignes):
    """Lignes d'un paragraphe -> une phrase ; un mot coupé en fin de ligne (« convien- / dra ») est réuni."""
    texte = ""
    for ligne in lignes:
        if texte.endswith("-") and ligne[:1].islower() and len(texte) > 1 and texte[-2].isalpha():
            texte = texte[:-1] + ligne
        else:
            texte = (texte + " " + ligne).strip()
    return texte


def analyser_lettre(texte):
    paragraphes = _paragraphes(texte)

    lettre = {"objet": "", "salutation": "", "formule": "", "pj": "", "destinataire": {},
              "parties": dict.fromkeys(PARTIES_LETTRE, "")}
    blocs = []
    for lignes in paragraphes:
        garder = []
        for ligne in lignes:
            if (m := _OBJET.match(ligne)) and not lettre["objet"]:
                lettre["objet"] = m.group(1)[:300]
            elif (m := _PJ.match(ligne)) and not lettre["pj"]:
                lettre["pj"] = m.group(1)[:300]
            else:
                garder.append(ligne)
        if garder:
            blocs.append(garder)

    debut = next((i for i, b in enumerate(blocs)
                  if len(b) == 1 and len(b[0]) <= 80 and _APPEL.match(b[0]) and b[0].rstrip().endswith((",", ":"))), None)
    if debut is not None:
        lettre["salutation"] = blocs[debut][0][:160]
        corps = blocs[debut + 1:]
    else:   # pas de formule d'appel repérée : le corps commence au premier vrai paragraphe
        premier = next((i for i, b in enumerate(blocs) if len(" ".join(b).split()) >= 20), 0)
        corps = blocs[premier:]
    corps = [_recoller(b) for b in corps]

    # On cherche la formule de politesse en partant de la fin de la lettre.
    fin = next((i for i in range(len(corps) - 1, -1, -1) if _POLITESSE.search(corps[i])), None)
    if fin is not None and fin < len(corps) - 3:
        fin = None                     # trop loin de la fin : ce n'est pas la formule finale
    if fin is not None:
        # Si la formule de politesse est collée à la phrase précédente, on les sépare.
        phrases = re.split(r"(?<=[.!?])\s+", corps[fin])
        k = max(i for i, phrase in enumerate(phrases) if _POLITESSE.search(phrase))
        lettre["formule"] = " ".join(phrases[k:])[:600]
        corps = corps[:fin] + ([" ".join(phrases[:k])] if k else [])
    # Après le texte : la signature (lignes courtes) ne fait pas partie du corps.
    while corps and len(corps[-1].split()) <= 4:
        corps.pop()
    corps = [p for p in corps if p][:30]
    if not corps:
        raise ErreurDonnees("Aucun texte de lettre n'a été trouvé dans ce fichier.")

    parties = lettre["parties"]
    parties["accroche"] = corps.pop(0)
    if len(corps) >= 2:
        parties["conclusion"] = corps.pop()
    if len(corps) >= 2:
        parties["entreprise"] = corps.pop()
    parties["parcours"] = "\n".join(corps)
    return lettre


def _qualite(cv):
    """Note une analyse : plus il y a d'entrées complètes (intitulé + dates), mieux c'est."""
    entrees = [(e["poste"], e["dates"]) for e in cv["experiences"]] + [(f["diplome"], f["dates"]) for f in cv["formations"]]
    return (2 * sum(1 for titre, dates in entrees if titre and dates) - sum(1 for titre, dates in entrees if not dates)
            + bool(cv["nom"]) + bool(cv["titre"]) + sum(1 for l in cv["langues"] if l["niveau"])
            + sum(1 for c in cv["competences"] if c["categorie"]))


def importer(octets, type_document):
    """Point d'entrée : fichier -> {"cv": …} ou {"lettre": …}."""
    texte = extraire_texte(octets)
    if type_document == "lettre":
        return {"lettre": analyser_lettre(texte)}
    cv = analyser_cv(texte)
    if octets.startswith(b"%PDF-"):
        # CV en colonnes (barre latérale) : chaque colonne lue d'un bloc, sinon tout se mélange.
        lecture = _texte_pdf_colonnes(octets)
        if lecture:
            texte_lu, colonnes = lecture
            autre = analyser_cv(_nettoyer(texte_lu))
            # En colonnes, la lecture par position est presque toujours la bonne ; sinon, seulement
            # si elle fait au moins aussi bien (dates alignées à droite remises sur leur ligne).
            if _qualite(autre) >= _qualite(cv) - (1 if colonnes else 0):
                cv = autre
        # Deuxième lecture du PDF, mise en page conservée : on garde la meilleure des deux.
        autre = analyser_cv(extraire_texte(octets, mise_en_page=True))
        if _qualite(autre) >= _qualite(cv) + 2:       # nettement meilleure seulement
            cv = autre
    if not (cv["nom"] or cv["experiences"] or cv["formations"] or cv["profil"]):
        raise ErreurDonnees("Le contenu de ce fichier n'a pas pu être reconnu comme un CV. "
                            "Remplis le formulaire à la main : cela prend quelques minutes.")
    return {"cv": cv}
