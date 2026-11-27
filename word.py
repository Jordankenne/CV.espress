"""
Export Word (.docx) du CV, de la lettre et des documents administratifs.

Le fichier est fabriqué directement (un .docx est un dossier zip de fichiers XML), sans
bibliothèque à installer. Mise en page simple, sur une colonne : c'est ce que les logiciels
de recrutement (ATS) lisent le mieux, et ce que la personne pourra retoucher dans Word,
LibreOffice ou Google Docs. Les données passent par les mêmes filtres que le PDF (moteur.py) :
longueurs maximales, caractères invisibles retirés, photo vérifiée.
"""
import io
import re
import zipfile
from xml.sax.saxutils import escape

import moteur
from moteur import (LIBELLES, PARTIES_LETTRE, ErreurDonnees, _dico, _lignes, _liste, _options,
                    _texte)

MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_URL_OK = re.compile(r"^https?://[A-Za-z0-9._~:/?#@!&'()*+,;=%-]+$")


def _t(texte):
    """Texte pour le XML : caractères spéciaux échappés, « -- » (LaTeX) devient un tiret."""
    return escape(re.sub(r"\s?--\s?", " – ", texte), {'"': "&quot;"})


class _Document:
    """Accumule les paragraphes du document et les fichiers liés (liens, photo)."""

    def __init__(self, couleur):
        self.couleur = couleur
        self.corps = []
        self.liens = []          # adresses externes : une relation chacune
        self.photo = None        # (nom, octets, largeur, hauteur)

    # --- morceaux de texte ---
    @staticmethod
    def run(texte, gras=False, italique=False, couleur=None, taille=None):
        if not texte:
            return ""
        proprietes = "".join([
            "<w:b/>" if gras else "", "<w:i/>" if italique else "",
            f'<w:color w:val="{couleur}"/>' if couleur else "",
            f'<w:sz w:val="{taille}"/>' if taille else ""])
        return (f"<w:r>{f'<w:rPr>{proprietes}</w:rPr>' if proprietes else ''}"
                f'<w:t xml:space="preserve">{_t(texte)}</w:t></w:r>')

    def lien(self, url, texte):
        url = _texte(url, 300)
        texte = texte or re.sub(r"^(https?://|mailto:)", "", url)
        if re.match(r"^[a-z][a-z0-9+.-]*:(?!\d)", url, re.I) and not re.match(r"^(https?://|mailto:)", url, re.I):
            return self.run(texte)                 # javascript:, data:… : jamais un lien
        if url and not re.match(r"^(https?://|mailto:)", url, re.I):
            url = "https://" + url
        if not (_URL_OK.match(url) or url.startswith("mailto:")):
            return self.run(texte)
        self.liens.append(url)
        return (f'<w:hyperlink r:id="lien{len(self.liens)}"><w:r><w:rPr><w:rStyle w:val="Lien"/></w:rPr>'
                f'<w:t xml:space="preserve">{_t(texte)}</w:t></w:r></w:hyperlink>')

    # --- paragraphes ---
    def p(self, *runs, style=None, aligne=None, avant=None, apres=None, puce=False, tab=False):
        proprietes = "".join([
            f'<w:pStyle w:val="{style}"/>' if style else "",
            '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' if puce else "",
            '<w:tabs><w:tab w:val="right" w:pos="9638"/></w:tabs>' if tab else "",
            f'<w:spacing{f" w:before={chr(34)}{avant}{chr(34)}" if avant is not None else ""}'
            f'{f" w:after={chr(34)}{apres}{chr(34)}" if apres is not None else ""}/>'
            if avant is not None or apres is not None else "",
            f'<w:jc w:val="{aligne}"/>' if aligne else ""])
        self.corps.append(f"<w:p>{f'<w:pPr>{proprietes}</w:pPr>' if proprietes else ''}{''.join(runs)}</w:p>")

    def titre_section(self, texte):
        self.p(self.run(texte.upper()), style="Rubrique")

    def ligne_avec_date(self, gauche, date):
        """Intitulé à gauche, dates calées à droite (tabulation)."""
        self.p(gauche, ("<w:r><w:tab/></w:r>" + self.run(date, couleur="555555")) if date else "",
               style="Intitule", tab=True)

    def ajouter_photo(self, nom, octets):
        taille = moteur._taille_jpeg(octets) if nom.endswith(".jpg") else (
            int.from_bytes(octets[16:20], "big"), int.from_bytes(octets[20:24], "big"))
        if not taille:
            return ""
        self.photo = (nom, octets)
        hauteur = 1_260_000                       # 3,5 cm en EMU
        largeur = max(1, round(hauteur * taille[0] / taille[1]))
        return (
            '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
            f'<wp:extent cx="{largeur}" cy="{hauteur}"/><wp:docPr id="1" name="Photo"/>'
            '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
            '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            '<pic:nvPicPr><pic:cNvPr id="1" name="Photo"/><pic:cNvPicPr/></pic:nvPicPr>'
            '<pic:blipFill><a:blip r:embed="photo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
            f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{largeur}" cy="{hauteur}"/></a:xfrm>'
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
            '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>')

    # --- fichier final ---
    def fichier(self, titre):
        relations = "".join(
            f'<Relationship Id="lien{i}" Type="{_REL}/hyperlink" Target="{escape(url, {chr(34): "&quot;"})}" '
            'TargetMode="External"/>' for i, url in enumerate(self.liens, 1))
        relations += (f'<Relationship Id="styles" Type="{_REL}/styles" Target="styles.xml"/>'
                      f'<Relationship Id="numerotation" Type="{_REL}/numbering" Target="numbering.xml"/>')
        types = ""
        if self.photo:
            relations += f'<Relationship Id="photo" Type="{_REL}/image" Target="media/{self.photo[0]}"/>'
            types = ('<Default Extension="jpg" ContentType="image/jpeg"/>' if self.photo[0].endswith(".jpg")
                     else '<Default Extension="png" ContentType="image/png"/>')
        document = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
            'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>'
            + "".join(self.corps) +
            '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
            '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/>'
            '</w:sectPr></w:body></w:document>')
        tampon = io.BytesIO()
        with zipfile.ZipFile(tampon, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("[Content_Types].xml", _TYPES.format(images=types))
            z.writestr("_rels/.rels", _RELS_RACINE)
            z.writestr("docProps/core.xml", _CORE.format(titre=_t(titre)))
            z.writestr("word/document.xml", document)
            z.writestr("word/styles.xml", _STYLES.format(couleur=self.couleur))
            z.writestr("word/numbering.xml", _NUMEROTATION)
            z.writestr("word/_rels/document.xml.rels",
                       f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                       f'<Relationships xmlns="{_PKG}/relationships">{relations}</Relationships>')
            if self.photo:
                z.writestr(f"word/media/{self.photo[0]}", self.photo[1])
        return tampon.getvalue()


def _identite(brut):
    d = {cle: _texte(brut.get(cle), maxi) for cle, maxi in
         (("nom", 120), ("titre", 160), ("ville", 200), ("telephone", 60), ("email", 120))}
    if not d["nom"]:
        raise ErreurDonnees("Le nom est obligatoire.")
    return d


def _en_tete(doc, ident, liens=(), avec_titre=True, photo=""):
    doc.p(photo, style="Photo", aligne="right") if photo else None
    doc.p(doc.run(ident["nom"]), style="Nom")
    if avec_titre and ident["titre"]:
        doc.p(doc.run(ident["titre"]), style="Poste")
    morceaux = [doc.run(ident["ville"]), doc.run(ident["telephone"]),
                doc.lien("mailto:" + ident["email"], ident["email"]) if moteur._EMAIL_OK.match(ident["email"])
                else doc.run(ident["email"]), *liens]
    morceaux = [m for m in morceaux if m]
    separateur = doc.run("  |  ", couleur="999999")
    if morceaux:
        doc.p(*[x for i, m in enumerate(morceaux) for x in ((separateur, m) if i else (m,))], style="Contact")


def generer_cv(brut, options=None):
    brut, o = _dico(brut), _options(options)
    t = LIBELLES[o["langue"]]
    doc = _Document(str(o["couleur"]))
    ident = _identite(brut)

    photo = moteur._photo(brut.get("photo"))
    image = doc.ajouter_photo(*photo) if photo else ""
    liens = [doc.lien(l.get("url"), _texte(l.get("label"), 120)) for l in _liste(brut.get("liens"), 6)
             if _texte(l.get("url")) or _texte(l.get("label"))]
    _en_tete(doc, ident, liens, photo=image)

    ec = _dico(brut.get("etat_civil"))
    etat = [(t[c], _texte(ec.get(c), 120)) for c in
            ("date_naissance", "lieu_naissance", "nationalite", "situation", "permis") if _texte(ec.get(c))]
    if etat:
        doc.p(*[r for i, (libelle, valeur) in enumerate(etat)
                for r in ((doc.run("  |  ", couleur="999999") if i else ""), doc.run(f"{libelle} : ", gras=True),
                          doc.run(valeur))], style="Contact")

    profil = _lignes(brut.get("profil"), 12, 900)
    if profil:
        doc.titre_section(t["profil"])
        for ligne in profil:
            doc.p(doc.run(ligne))

    experiences = [e for e in _liste(brut.get("experiences"), 25)
                   if _texte(e.get("poste")) or _texte(e.get("entreprise")) or _lignes(e.get("points"), 12)]
    if experiences:
        doc.titre_section(t["experiences"])
        for e in experiences:
            doc.ligne_avec_date(doc.run(_texte(e.get("poste"), 160), gras=True), _texte(e.get("dates"), 60))
            sous = " – ".join(x for x in (_texte(e.get("entreprise"), 160), _texte(e.get("lieu"), 120)) if x)
            if sous:
                doc.p(doc.run(sous, italique=True), style="SousTitre")
            for point in _lignes(e.get("points"), 12):
                doc.p(doc.run(point), style="Puce", puce=True)

    formations = [f for f in _liste(brut.get("formations"), 20)
                  if _texte(f.get("diplome")) or _texte(f.get("ecole"))]
    if formations:
        doc.titre_section(t["formations"])
        for f in formations:
            doc.ligne_avec_date(doc.run(_texte(f.get("diplome"), 200), gras=True), _texte(f.get("dates"), 60))
            if _texte(f.get("ecole")):
                doc.p(doc.run(_texte(f.get("ecole"), 200), italique=True), style="SousTitre")
            if _texte(f.get("details")):
                doc.p(doc.run(_texte(f.get("details"), 500)))

    competences = [c for c in _liste(brut.get("competences"), 15)
                   if _texte(c.get("liste")) or _texte(c.get("categorie"))]
    if competences:
        doc.titre_section(t["competences"])
        for c in competences:
            categorie = _texte(c.get("categorie"), 80)
            doc.p(doc.run(f"{categorie} : " if categorie else "", gras=True), doc.run(_texte(c.get("liste"), 500)))

    langues = [l for l in _liste(brut.get("langues"), 12) if _texte(l.get("langue"))]
    if langues:
        doc.titre_section(t["langues"])
        for l in langues:
            niveau = _texte(l.get("niveau"), 80)
            doc.p(doc.run(_texte(l.get("langue"), 60), gras=True), doc.run(f" : {niveau}" if niveau else ""))

    certifications = [c for c in _liste(brut.get("certifications"), 12) if _texte(c.get("titre"))]
    if certifications:
        doc.titre_section(t["certifications"])
        for c in certifications:
            organisme = _texte(c.get("organisme"), 160)
            doc.ligne_avec_date(doc.run(_texte(c.get("titre"), 200), gras=True)
                                + doc.run(f", {organisme}" if organisme else ""), _texte(c.get("date"), 60))

    projets = [p for p in _liste(brut.get("projets"), 12) if _texte(p.get("titre"))]
    if projets:
        doc.titre_section(t["projets"])
        for pr in projets:
            doc.ligne_avec_date(doc.run(_texte(pr.get("titre"), 200), gras=True), _texte(pr.get("dates"), 60))
            if _texte(pr.get("details")):
                doc.p(doc.run(_texte(pr.get("details"), 600)))

    interets = _texte(brut.get("interets"), 500)
    if interets:
        doc.titre_section(t["interets"])
        doc.p(doc.run(interets))

    references = [r for r in _liste(brut.get("references"), 6) if _texte(r.get("nom"))]
    if references:
        doc.titre_section(t["references"])
        for r in references:
            reste = " – ".join(x for x in (_texte(r.get("fonction"), 200), _texte(r.get("contact"), 160)) if x)
            doc.p(doc.run(_texte(r.get("nom"), 120), gras=True), doc.run(f" – {reste}" if reste else ""))

    if o["certifier"]:
        doc.p(doc.run(t["certif"], italique=True), avant=240)
    return doc.fichier(f"{t['cv']} – {ident['nom']}")


def generer_lettre(brut, lettre, options=None, avec_titre=True):
    """Lettre de motivation, ou document administratif (titre centré, « Fait à », signataires)."""
    o = _options(options)
    t = LIBELLES[o["langue"]]
    doc = _Document(str(o["couleur"]))
    ident = _identite(_dico(brut))
    l = _dico(lettre)
    dest = _dico(l.get("destinataire"))
    parties = _dico(l.get("parties"))
    corps = [ligne for cle in PARTIES_LETTRE for ligne in _lignes(parties.get(cle), 10, 2000)]
    corps = (corps + _lignes(l.get("corps"), 30, 2000))[:30]
    if not corps:
        raise ErreurDonnees("Le texte de la lettre est vide.")

    titre = _texte(l.get("titre"), 80)
    lieu, date = _texte(l.get("lieu"), 80), _texte(l.get("date"), 60)
    lieu_date = (t["fait_a" if titre else "date_lettre"].format(lieu=lieu, date=date)
                 if lieu and date else lieu or date)

    _en_tete(doc, ident, avec_titre=avec_titre)
    destinataire = [x for x in (_texte(dest.get("nom"), 120), _texte(dest.get("entreprise"), 160)) if x]
    destinataire += _lignes(dest.get("adresse"), 5, 160)
    for i, ligne in enumerate(destinataire):
        doc.p(doc.run(ligne), aligne="right", avant=360 if i == 0 else 0, apres=0)
    if lieu_date and not titre:
        doc.p(doc.run(lieu_date), aligne="right", avant=240)
    if titre:
        doc.p(doc.run(titre.upper()), style="TitreDocument")
    objet = _texte(l.get("objet"), 300)
    if objet:
        doc.p(doc.run(f"{t['objet']} ", gras=True), doc.run(objet, gras=True), avant=360)
    salutation = _texte(l.get("salutation"), 160)
    if salutation:
        doc.p(doc.run(salutation), avant=240)
    for ligne in corps:
        doc.p(doc.run(ligne), aligne="both")
    for ligne in _lignes(l.get("formule"), 4, 600):
        doc.p(doc.run(ligne), aligne="both")
    if lieu_date and titre:
        doc.p(doc.run(lieu_date), avant=240)

    signataires = [(_texte(s.get("role"), 60), _texte(s.get("nom"), 120), _texte(s.get("mention"), 120))
                   for s in map(_dico, _liste(l.get("signataires"), 2))]
    signataires = [s for s in signataires if s[0] or s[1]]
    if signataires:
        for role, nom, mention in signataires:
            doc.p(doc.run(role, gras=True), avant=360, apres=0)
            if mention:
                doc.p(doc.run(mention, italique=True), apres=0)
            doc.p(doc.run(nom))
    else:
        doc.p(doc.run(ident["nom"]), aligne="right", avant=480)
    pj = _texte(l.get("pj"), 300)
    if pj:
        doc.p(doc.run(f"{t['pj']} ", gras=True), doc.run(pj), avant=360)
    return doc.fichier(titre or objet or ident["nom"])


def fabriquer(corps):
    """Requête {type, cv, lettre, admin, options} -> (octets du .docx, nom du fichier)."""
    if not isinstance(corps, dict):
        raise ErreurDonnees("Requête invalide.")
    genre = corps.get("type")
    if genre in ("arbre", "plan"):
        raise ErreurDonnees("Ce document n'existe qu'en PDF.")
    if genre == "lettre":
        fichier, prefixe = generer_lettre(corps.get("cv"), corps.get("lettre"), corps.get("options")), "Lettre"
    elif genre == "admin":
        fichier = generer_lettre(corps.get("cv"), corps.get("admin"), corps.get("options"), avec_titre=False)
        prefixe = "Document"
    else:
        fichier, prefixe = generer_cv(corps.get("cv"), corps.get("options")), "CV"
    nom = (corps.get("cv") or {}).get("nom", "") if isinstance(corps.get("cv"), dict) else ""
    nom = re.sub(r"[^A-Za-z0-9]+", "_", nom if isinstance(nom, str) else "").strip("_")[:40]
    return fichier, f"{prefixe}_{nom or 'document'}.docx"


# --------------------------------------------------------------------------
# Parties fixes du fichier .docx
# --------------------------------------------------------------------------
_PKG = "http://schemas.openxmlformats.org/package/2006"
_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

_TYPES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          f'<Types xmlns="{_PKG}/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          '<Default Extension="xml" ContentType="application/xml"/>{images}'
          '<Override PartName="/word/document.xml" '
          'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
          '<Override PartName="/word/styles.xml" '
          'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
          '<Override PartName="/word/numbering.xml" '
          'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
          '<Override PartName="/docProps/core.xml" '
          'ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>')

_RELS_RACINE = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                f'<Relationships xmlns="{_PKG}/relationships">'
                f'<Relationship Id="document" Type="{_REL}/officeDocument" Target="word/document.xml"/>'
                f'<Relationship Id="proprietes" Type="{_PKG}/relationships/metadata/core-properties" '
                'Target="docProps/core.xml"/></Relationships>')

_CORE = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
         f'<cp:coreProperties xmlns:cp="{_PKG}/metadata/core-properties" '
         'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>{titre}</dc:title>'
         '<dc:creator>MonCVexpress.com</dc:creator></cp:coreProperties>')


def _style(identifiant, nom, ppr="", rpr="", base="Normal"):
    return (f'<w:style w:type="paragraph" w:customStyle="1" w:styleId="{identifiant}"><w:name w:val="{nom}"/>'
            f'<w:basedOn w:val="{base}"/><w:qFormat/><w:pPr>{ppr}</w:pPr><w:rPr>{rpr}</w:rPr></w:style>')


_STYLES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" '
    'w:eastAsia="Calibri"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault>'
    '<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault>'
    '</w:docDefaults>'
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + _style("Nom", "Nom", '<w:spacing w:after="0"/>', '<w:b/><w:color w:val="{couleur}"/><w:sz w:val="44"/>')
    + _style("Poste", "Poste visé", '<w:spacing w:after="40"/>', '<w:color w:val="444444"/><w:sz w:val="26"/>')
    + _style("Contact", "Coordonnées", '<w:spacing w:after="60"/>', '<w:sz w:val="19"/>')
    + _style("Photo", "Photo", '<w:spacing w:after="0"/>')
    + _style("Rubrique", "Titre de rubrique",
             '<w:keepNext/>'
             '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="{couleur}"/></w:pBdr>'
             '<w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="0"/>',
             '<w:b/><w:color w:val="{couleur}"/><w:spacing w:val="10"/><w:sz w:val="23"/>')
    + _style("Intitule", "Intitulé", '<w:keepNext/><w:spacing w:before="120" w:after="0"/>')
    + _style("SousTitre", "Sous-titre", '<w:spacing w:after="40"/>', '<w:color w:val="444444"/>')
    + _style("Puce", "Puce", '<w:spacing w:after="20"/><w:ind w:left="357" w:hanging="357"/>')
    + _style("TitreDocument", "Titre du document", '<w:spacing w:before="480" w:after="240"/><w:jc w:val="center"/>',
             '<w:b/><w:sz w:val="30"/>')
    + '<w:style w:type="character" w:customStyle="1" w:styleId="Lien"><w:name w:val="Lien"/>'
      '<w:rPr><w:color w:val="{couleur}"/></w:rPr></w:style>'
    '</w:styles>')

_NUMEROTATION = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>'
    '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>'
    '<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="357" w:hanging="357"/></w:pPr></w:lvl></w:abstractNum>'
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>')
