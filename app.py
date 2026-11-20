"""
Le site web : page d'accueil + éditeur (dossier web/) + une API qui fabrique les documents.
Les comptes utilisateurs (facultatifs) sont dans comptes.py.

En développement :   .venv/bin/python app.py        puis ouvrir http://localhost:5000
En production    :   gunicorn -w 1 --threads 16 -b 0.0.0.0:8000 app:app   (voir Dockerfile)
                     Un seul processus (-w 1) : la limite de débit est comptée en mémoire.
"""
import base64
import gzip
import hashlib
import json
import mimetypes
import logging
import os
import re
import threading
import time
import unicodedata
from collections import defaultdict, deque

from urllib.parse import urlsplit

from flask import Flask, Response, abort, jsonify, redirect, render_template, request
from markupsafe import Markup, escape

import admin
import arbre
import comptes
import contact
import ia
import importer
import moteur
import plan
import requetes
import statistiques
import textes
import word

# web/ : fichiers servis tels quels (CSS, JS, images, éditeur) ; pages/ : pages HTML
# assemblées par le serveur (accueil, guides, pages légales) avec en-tête et pied communs.
app = Flask(__name__, static_folder="web", static_url_path="", template_folder="pages")
# Refuse toute requête de plus de 3 Mo (la photo est déjà réduite côté navigateur).
app.config["MAX_CONTENT_LENGTH"] = 3 * 1024 * 1024
# Une page de pages/ modifiée est relue sans redémarrer le serveur (comme les fichiers de web/).
app.config["TEMPLATES_AUTO_RELOAD"] = True
# Journal du serveur : les informations aussi (sauvegardes, actions de l'administration,
# comptes supprimés), pas seulement les avertissements. Rien de personnel n'y est écrit.
app.logger.setLevel(logging.INFO)

# Comptes utilisateurs (facultatifs) : base de données, cookie de session, routes /api/compte.
comptes.initialiser(app)
# Tableau de bord de l'administrateur (réglage ADMINS) : /admin et /api/admin.
app.register_blueprint(admin.admin)
# Formulaire de la page Contact : /api/contact.
app.register_blueprint(contact.contact)

# Manifeste de l'application (icône sur l'écran d'accueil du téléphone).
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("image/webp", ".webp")    # absent de la liste de certains systèmes

# Chez un hébergeur, le site est derrière un proxy : sans ceci, tous les visiteurs
# auraient la même adresse IP (celle du proxy) et partageraient la même limite.
# À n'activer QUE derrière un proxy de confiance (sinon l'en-tête peut être falsifié).
if os.environ.get("DERRIERE_PROXY") == "1":
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)

# --------------------------------------------------------------------------
# Limite de débit : au plus 120 documents par minute et par adresse IP.
# Chaque document lance une compilation LaTeX : sans limite, un seul visiteur
# malveillant pourrait saturer le serveur.
# (En mémoire : suffisant tant qu'il n'y a qu'un seul processus serveur.)
# --------------------------------------------------------------------------
LIMITE, FENETRE_S = 120, 60
_appels = defaultdict(deque)
_verrou = threading.Lock()


def trop_de_requetes():
    maintenant = time.monotonic()
    with _verrou:
        file = _appels[request.remote_addr]
        while file and maintenant - file[0] > FENETRE_S:
            file.popleft()
        if len(file) >= LIMITE:
            return True
        file.append(maintenant)
        if len(_appels) > 10_000:      # ménage : on oublie les adresses inactives
            for ip in [ip for ip, f in _appels.items() if not f or maintenant - f[-1] > FENETRE_S]:
                del _appels[ip]
        return False


# --------------------------------------------------------------------------
# Équité entre visiteurs : la limite de débit ci-dessus ne suffit pas, car un document
# lent (2 s avec lualatex) × 120 par minute occuperait à lui seul les 2 places de
# compilation, et les autres visiteurs attendraient. Donc, par adresse IP :
#   - une seule fabrication à la fois (les suivantes attendent leur tour) ;
#   - au plus 4 demandes en attente (au-delà : refus immédiat), pour qu'un seul
#     visiteur ne puisse pas non plus occuper tous les fils du serveur.
# 4 et non 1 : derrière une même adresse (cybercafé, école) il y a plusieurs personnes.
# --------------------------------------------------------------------------
EN_COURS_MAX = 4
_en_cours = {}      # adresse IP -> [nombre de demandes en cours, verrou « une à la fois »]


def _entrer():
    """Réserve une place pour ce visiteur ; None s'il en occupe déjà trop."""
    with _verrou:
        fiche = _en_cours.setdefault(request.remote_addr, [0, threading.Lock()])
        if fiche[0] >= EN_COURS_MAX:
            return None
        fiche[0] += 1
        return fiche


def _sortir(fiche):
    with _verrou:
        fiche[0] -= 1
        if fiche[0] == 0:
            _en_cours.pop(request.remote_addr, None)


@app.before_request
def adresse_unique():
    """Une seule adresse publique : www.moncvexpress.com et l'ancienne adresse en .onrender.com
    renvoient (redirection permanente) vers ADRESSE_SITE, à la même page. Google ne voit ainsi
    qu'un seul site, et les liens déjà partagés continuent de marcher.
    /sante n'est jamais redirigé (contrôle de santé de Render, moniteur de réveil)."""
    if not comptes.ADRESSE_SITE or request.path == "/sante" or request.method not in ("GET", "HEAD"):
        return None
    principal = urlsplit(comptes.ADRESSE_SITE).hostname
    hote = (request.host or "").split(":")[0].lower()
    autres = {"www." + principal if not principal.startswith("www.") else principal[4:],
              os.environ.get("RENDER_EXTERNAL_HOSTNAME", "").lower()} - {"", principal}
    if hote in autres:
        cible = comptes.ADRESSE_SITE + request.full_path.rstrip("?")
        return redirect(cible, code=301)
    return None


@app.after_request
def entetes_securite(reponse):
    reponse.headers["X-Content-Type-Options"] = "nosniff"
    reponse.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    # Site servi en HTTPS : le navigateur refusera ensuite toute connexion non chiffrée.
    if request.is_secure:
        reponse.headers["Strict-Transport-Security"] = "max-age=31536000"
    # Le site ne charge que ses propres scripts et styles : une éventuelle
    # injection de HTML ne pourrait pas exécuter de code.
    # Interdit au navigateur de deviner un autre usage de la page (caméra, micro, position).
    # Position : seulement pour ce site (bouton « Ma position » du plan de localisation).
    reponse.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(self)"
    # Les réponses de l'API contiennent le CV du visiteur : ni le navigateur (ordinateur
    # partagé), ni un proxy intermédiaire ne doivent en garder de copie.
    if request.path.startswith("/api/"):
        reponse.headers["Cache-Control"] = "no-store"
    else:
        cache_et_versions(reponse)
    compresser(reponse)
    if reponse.mimetype == "application/pdf":
        return reponse   # un PDF n'exécute rien ; certains lecteurs intégrés supportent mal la CSP
    reponse.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data: blob:; object-src 'none'; "
        "base-uri 'self'; form-action 'self'; frame-ancestors 'none'" + CSP_TURNSTILE)
    return reponse


# Vérification anti-robot de l'inscription (Cloudflare Turnstile) : son script et sa case viennent
# de challenges.cloudflare.com. Autorisé seulement quand Turnstile est configuré.
CSP_TURNSTILE = ("; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com"
                 if comptes.TURNSTILE_SECRET and comptes.TURNSTILE_CLE_SITE else "")


# --------------------------------------------------------------------------
# Cache des fichiers et compression
# --------------------------------------------------------------------------
# Chaque page appelle style.css, editeur-*.js… avec « ?v=<version> ». La version change à chaque mise
# en ligne d'un nouveau code (empreinte des fichiers) : le navigateur peut donc garder ces fichiers
# un an sans jamais utiliser une version périmée. Les pages elles-mêmes sont toujours revérifiées.
# En développement, rien n'est gardé : une modification se voit au rechargement.
PRODUCTION = os.environ.get("DERRIERE_PROXY") == "1"
_WEB = moteur.RACINE / "web"
VERSION = hashlib.sha1(b"".join(f.read_bytes() for f in sorted(_WEB.glob("*.js")) + sorted(_WEB.glob("*.css")))).hexdigest()[:10]
_LIEN_VERSIONNE = re.compile(r'((?:src|href)="/[\w.-]+\.(?:js|css))"')
_IMAGES = (".png", ".jpg", ".webp", ".svg", ".ico", ".webmanifest", ".woff2")


def cache_et_versions(reponse):
    chemin = request.path
    if reponse.mimetype == "text/html" and reponse.status_code == 200:
        # Les adresses des scripts et des styles reçoivent la version du code.
        reponse.direct_passthrough = False
        html = _LIEN_VERSIONNE.sub(rf'\1?v={VERSION}"', reponse.get_data(as_text=True))
        # Traductions : seulement le dictionnaire de la langue de la page (aucun en français).
        langue = chemin.split("/")[1] if chemin.startswith(("/en/", "/it/")) or chemin in ("/en", "/it") else "fr"
        html = html.replace(f'/traductions.js?v={VERSION}"', f'/traductions.js?v={VERSION}&amp;langue={langue}"')
        reponse.set_data(html)
        for entete in ("ETag", "Last-Modified"):        # le contenu a changé : plus de 304 sur l'ancien
            reponse.headers.pop(entete, None)
        reponse.headers.setdefault("Cache-Control", "no-cache")
    elif chemin.endswith((".js", ".css")):
        versionne = PRODUCTION and request.args.get("v") == VERSION
        reponse.headers["Cache-Control"] = "public, max-age=31536000, immutable" if versionne else "no-cache"
    elif chemin.endswith(_IMAGES) and "Cache-Control" not in reponse.headers:
        reponse.headers["Cache-Control"] = "public, max-age=604800" if PRODUCTION else "no-cache"


# Compression gzip des textes (pages, scripts, styles, réponses JSON) : 3 à 5 fois moins à
# télécharger, ce qui compte beaucoup sur une connexion mobile lente.
_COMPRESSIBLES = {"text/html", "text/css", "text/javascript", "application/javascript", "application/json",
                  "image/svg+xml", "application/manifest+json", "text/plain", "application/xml"}
_compresses = {}         # fichiers du site déjà compressés : (chemin, version, taille) -> octets


def compresser(reponse):
    if (reponse.status_code != 200 or reponse.mimetype not in _COMPRESSIBLES
            or "gzip" not in request.headers.get("Accept-Encoding", "")
            or "Content-Encoding" in reponse.headers or request.method == "HEAD"):
        return
    reponse.direct_passthrough = False
    donnees = reponse.get_data()
    if len(donnees) < 1024:
        return
    fichier = request.path.endswith((".js", ".css", ".svg", ".json", ".webmanifest"))
    cle = (request.full_path, VERSION, len(donnees))     # full_path : ?langue= compris
    compresse = _compresses.get(cle) if fichier else None
    if compresse is None:
        compresse = gzip.compress(donnees, compresslevel=6)
        if fichier and len(_compresses) < 200:
            _compresses[cle] = compresse
    reponse.set_data(compresse)
    reponse.headers["Content-Encoding"] = "gzip"
    reponse.vary.add("Accept-Encoding")
    etag = reponse.headers.get("ETag")
    if etag and not etag.startswith("W/"):
        reponse.headers["ETag"] = "W/" + etag     # même contenu, autre encodage : empreinte « faible »


@app.get("/sante")
def sante():
    """Pour le service qui garde le site éveillé (et le contrôle de santé de l'hébergeur) :
    une réponse immédiate, sans base de données ni page à fabriquer."""
    return Response("ok", mimetype="text/plain", headers={"Cache-Control": "no-store"})


# --------------------------------------------------------------------------
# Pages
# --------------------------------------------------------------------------
# Adresse -> fichier de pages/. Les guides sont aussi listés dans le plan du site.
GUIDES = ["modele-cv-afrique", "cv-europass", "cv-sans-experience", "lettre-de-motivation",
          "cv-ats", "cv-infirmier", "cv-commercial",
          # Pages des autres services (plan, arbre, documents administratifs), pour les moteurs de recherche.
          "plan-de-localisation", "arbre-genealogique", "demande-administrative", "attestation-sur-l-honneur"]
LEGALES = ["mentions-legales", "confidentialite", "conditions", "contact"]


# Le site existe en trois langues : français à la racine, anglais sous /en/, italien sous /it/.
PREFIXES = {"fr": "", "en": "/en", "it": "/it"}


def page(nom, langue="fr", chemin=None, **extra):
    """Affiche pages/<nom>.html dans la langue demandée. Les pages longues (guides, pages
    légales) ont un fichier par langue : pages/en/<nom>.html, pages/it/<nom>.html."""
    if nom not in ("admin", "compte", "erreur"):
        statistiques.compter_visite(nom, langue, request.user_agent.string)
    fichier = f"{nom}.html"
    if langue != "fr" and (moteur.RACINE / "pages" / langue / fichier).is_file():
        fichier = f"{langue}/{fichier}"
    if chemin is None:
        chemin = "/" if nom == "accueil" else f"/{nom}"      # adresse de la page, sans préfixe de langue
    # Adresses publiques (canonical, hreflang, aperçus de partage) : celle du site en
    # production (ADRESSE_SITE), jamais celle annoncée par la requête.
    racine = comptes.racine_site()
    return render_template(
        fichier, racine=racine + "/", url_page=racine + request.path,
        langue=langue, p=PREFIXES[langue], c=textes.COMMUN[langue], a=textes.ACCUEIL[langue],
        # La même page dans chaque langue : sélecteur de langue et balises hreflang.
        versions=[(code, textes.LANGUES_SITE[code], PREFIXES[code] + chemin, racine + PREFIXES[code] + chemin)
                  for code in PREFIXES], **extra)


# Informations légales (éditeur, hébergeur…) : un seul fichier, editeur.json, lu par les
# pages légales. Relu à chaque affichage : une modification s'applique sans redémarrer.
FICHIER_EDITEUR = moteur.RACINE / "editeur.json"


@app.context_processor
def infos_editeur():
    try:
        infos = json.loads(FICHIER_EDITEUR.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        infos = {}

    def champ(cle, a_completer):
        """La valeur de editeur.json, ou un repère [À COMPLÉTER] bien visible si elle manque."""
        valeur = infos.get(cle)
        if isinstance(valeur, str) and valeur.strip():
            return escape(valeur.strip())
        return Markup("<mark>[À COMPLÉTER dans editeur.json : {}]</mark>").format(a_completer)

    return {"editeur": infos, "champ": champ, "annee": time.strftime("%Y")}


@app.get("/")
def accueil():
    return page("accueil")


@app.get("/compte")
def espace():
    """« Mon espace » : connexion, ou profil du visiteur connecté. La page ne contient
    rien de personnel : c'est son script (web/espace.js) qui demande les données du compte."""
    return page("compte")


@app.get("/admin")
def administration():
    """Tableau de bord de l'administrateur. Pour tous les autres visiteurs, la page n'existe pas."""
    if not admin.admin_connecte():
        abort(404)
    return page("admin")


@app.get("/<any(en,it):langue>/")
def accueil_traduit(langue):
    return page("accueil", langue)


@app.get("/<any(en,it):langue>/<nom>")
def page_traduite(langue, nom):
    """/en/creer, /it/cv-europass… : la même page, dans une autre langue."""
    if nom in GUIDES or nom in LEGALES or nom == "compte":
        return page(nom, langue)
    if nom == "creer":
        statistiques.compter_visite("creer", langue, request.user_agent.string)
        return app.send_static_file("creer.html")      # traduit dans le navigateur (traductions.js)
    abort(404)


# traductions.js contient les dictionnaires anglais et italien (près de 140 Ko). Chaque page
# reçoit seulement celui de sa langue (?langue=, ajouté par cache_et_versions) : une page
# en français n'en reçoit aucun. Le fichier source reste unique, plus simple à tenir à jour.
_DICOS = {}


def _traductions_pour(langue):
    source = moteur.RACINE / "web" / "traductions.js"
    cle = (langue, source.stat().st_mtime_ns)
    if cle not in _DICOS:
        texte = source.read_text(encoding="utf-8")
        for debut, milieu, fin in (("const DICO = { en: {", "\n  }, it: {", "} }[LANGUE] || {};"),
                                   ("const MOTIFS = { en: [", "], it: [", "] }[LANGUE]")):
            i = texte.index(debut) + len(debut)
            j = texte.index(milieu, i)
            k = texte.index(fin, j)
            en, it = texte[i:j], texte[j + len(milieu):k]
            texte = (texte[:i] + (en if langue == "en" else "") + milieu
                     + (it if langue == "it" else "") + texte[k:])
        _DICOS.clear() if len(_DICOS) > 6 else None
        _DICOS[cle] = texte
    return _DICOS[cle]


@app.get("/traductions.js")
def traductions():
    langue = request.args.get("langue") if request.args.get("langue") in ("en", "it") else "fr"
    return Response(_traductions_pour(langue), mimetype="text/javascript")


@app.get("/<nom>")
def page_texte(nom):
    if nom in GUIDES or nom in LEGALES:
        return page(nom)
    # Sinon c'est un fichier de web/ (style.css, editeur-*.js…) : cette route passe avant
    # celle des fichiers statiques, il faut donc leur passer la main.
    return app.send_static_file(nom)


@app.get("/robots.txt")
def robots():
    return Response(f"User-agent: *\nDisallow: /api/\nDisallow: /admin\nDisallow: /cv/\nSitemap: {comptes.racine_site()}/sitemap.xml\n",
                    mimetype="text/plain")


@app.get("/sitemap.xml")
def plan_du_site():
    """La liste des pages à faire connaître aux moteurs de recherche."""
    racine = comptes.racine_site()
    adresses = [racine + prefixe + chemin for prefixe in PREFIXES.values()
                for chemin in ["/"] + ["/" + nom for nom in GUIDES]]
    corps = "".join(f"<url><loc>{a}</loc></url>" for a in adresses)
    return Response('<?xml version="1.0" encoding="UTF-8"?>'
                    f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{corps}</urlset>',
                    mimetype="application/xml")


@app.get("/creer")
def editeur():
    statistiques.compter_visite("creer", "fr", request.user_agent.string)
    return app.send_static_file("creer.html")


# Les PDF d'exemple de la page d'accueil : fabriqués à la première demande, puis gardés
# en mémoire (ils ne changent pas tant que le serveur tourne).
_exemples = {}


@app.get("/exemple/<modele>.pdf")
def exemple_pdf(modele):
    """/exemple/moderne.pdf = un CV ; /exemple/lettre-moderne.pdf = une lettre."""
    est_lettre = modele.startswith("lettre-")
    nom = modele.removeprefix("lettre-")
    if nom not in (moteur.MODELES_LETTRE if est_lettre else moteur.MODELES_CV):
        return "Modèle inconnu.", 404
    if modele not in _exemples:
        import miniatures   # même photo fictive et mêmes couleurs que les miniatures
        web = moteur.RACINE / "web"
        cv = json.loads((web / "exemple.json").read_text(encoding="utf-8"))
        cv["photo"] = miniatures.avatar()
        try:
            if est_lettre:
                lettre = json.loads((web / "exemple_lettre.json").read_text(encoding="utf-8"))
                _exemples[modele] = moteur.generer_lettre(cv, lettre, {
                    "modele_lettre": nom, "couleur": miniatures.COULEURS_LETTRE[nom]})
            else:
                _exemples[modele] = moteur.generer_cv(cv, {
                    "modele": nom, "couleur": miniatures.COULEURS[nom], "certifier": nom == "africain"})
        except (moteur.ErreurDonnees, moteur.ErreurCompilation) as e:
            app.logger.error("%s", e)
            return "L'exemple n'a pas pu être généré.", 500
    # « inline » : le navigateur OUVRE le PDF au lieu de le télécharger.
    return Response(_exemples[modele], mimetype="application/pdf", headers={
        "Content-Disposition": f'inline; filename="Exemple_{modele}.pdf"',
        "Cache-Control": "public, max-age=3600",
    })


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------
def fabriquer_pdf(corps=None):
    """Lit la requête {type, cv, lettre, options} (ou le dict « corps ») et renvoie (pdf, nom de fichier).
    Lève ErreurDonnees / ErreurCompilation."""
    if corps is None:
        corps = requetes.lire_json()
    if not isinstance(corps, dict):
        raise moteur.ErreurDonnees("Requête invalide.")
    if corps.get("type") == "lettre":
        pdf = moteur.generer_lettre(corps.get("cv"), corps.get("lettre"), corps.get("options"))
        prefixe = "Lettre"
    elif corps.get("type") == "arbre":
        return arbre.generer_arbre(corps.get("arbre"), corps.get("options")), "Arbre_genealogique.pdf"
    elif corps.get("type") == "plan":
        # Plan de localisation : le dessin de l'éditeur, mis en page avec titre, contact et GPS.
        return plan.generer_plan(corps.get("plan"), corps.get("options")), "Plan_de_localisation.pdf"
    elif corps.get("type") == "admin":
        # Document administratif (demande, attestation, procuration) : une lettre, sans le
        # poste visé du CV sous le nom, avec le texte rédigé dans l'éditeur.
        identite = corps.get("cv") if isinstance(corps.get("cv"), dict) else {}
        pdf = moteur.generer_lettre({**identite, "titre": ""}, corps.get("admin"), corps.get("options"))
        prefixe = "Document"
    else:
        pdf = moteur.generer_cv(corps.get("cv"), options_avec_qr(corps.get("options")))
        prefixe = "CV"
    nom = (corps.get("cv") or {}).get("nom", "")
    nom = re.sub(r"[^A-Za-z0-9]+", "_", nom if isinstance(nom, str) else "").strip("_")[:40]
    return pdf, f"{prefixe}_{nom or 'document'}.pdf"


def options_avec_qr(options):
    """Options du CV, avec l'adresse à mettre dans le QR code si le visiteur l'a demandé
    (« qr » coché, « partage » = code du lien de son CV en ligne). L'adresse est toujours
    fabriquée ici, avec un code qui existe vraiment : jamais une adresse envoyée par le navigateur."""
    options = dict(options) if isinstance(options, dict) else {}
    options.pop("lien_qr", None)
    code = options.get("partage")
    if options.get("qr") is True and comptes.partage_existe(code):
        options["lien_qr"] = f"{comptes.racine_site()}/cv/{code}"
    return options


def avec_erreurs(vue):
    """Transforme les erreurs du moteur en réponses JSON propres."""
    def enveloppe(*args, **kwargs):
        if trop_de_requetes():
            return jsonify(erreur="Trop de demandes en peu de temps. Patiente une minute."), 429
        fiche = _entrer()
        if fiche is None:
            return jsonify(erreur="Plusieurs documents sont déjà en cours de fabrication. "
                                  "Réessaie dans quelques secondes."), 429
        try:
            with fiche[1]:      # une seule fabrication à la fois par visiteur
                return vue(*args, **kwargs)
        except moteur.ErreurDonnees as e:
            return jsonify(erreur=str(e)), 400
        except moteur.ServeurOccupe:
            statistiques.compter(f"echec:{vue.__name__}:occupe")
            # Toutes les places de compilation sont prises depuis trop longtemps : on libère
            # ce fil tout de suite plutôt que de le laisser bloqué (les pages restent servies).
            reponse = jsonify(erreur="Beaucoup de demandes en ce moment. Réessaie dans quelques secondes.")
            reponse.headers["Retry-After"] = "10"
            return reponse, 503
        except moteur.ErreurCompilation as e:
            # Le détail (log LaTeX) va dans les logs du serveur, pas chez l'utilisateur.
            app.logger.error("%s", e)
            statistiques.compter(f"echec:{vue.__name__}:compilation")
            return jsonify(erreur="La génération du document a échoué. Réessaie dans un instant."), 500
        except Exception:
            # Erreur imprévue : journalisée et comptée (tableau de bord), réponse propre au visiteur.
            app.logger.exception("Erreur imprévue dans %s", vue.__name__)
            statistiques.compter(f"echec:{vue.__name__}:imprevue")
            return jsonify(erreur="Une erreur imprévue est survenue. Réessaie dans un instant."), 500
        finally:
            _sortir(fiche)
    enveloppe.__name__ = vue.__name__
    return enveloppe


@app.post("/api/apercu")
@avec_erreurs
def apercu():
    """Aperçu à l'écran : les premières pages du document, en images."""
    pdf, _ = fabriquer_pdf()
    images = moteur.pdf_vers_images(pdf)
    return jsonify(pages=["data:image/jpeg;base64," + base64.b64encode(i).decode() for i in images])


# Télécharger un document demande un compte (gratuit). L'éditeur et l'aperçu restent libres.
# COMPTE_OBLIGATOIRE=0 chez l'hébergeur : téléchargement sans compte, comme avant.
app.config["COMPTE_POUR_PDF"] = os.environ.get("COMPTE_OBLIGATOIRE", "1").strip() != "0"


@app.post("/api/pdf")
def pdf():
    if app.config["COMPTE_POUR_PDF"] and not comptes.compte_connecte():
        return jsonify(erreur="Crée ton compte gratuit (ou connecte-toi) pour télécharger ton document.",
                       compte_requis=True), 401
    return fabriquer_le_pdf()


@avec_erreurs
def fabriquer_le_pdf():
    """Le document final, en PDF."""
    document, nom = fabriquer_pdf()
    # Statistiques : type de document et langue du document (rien d'autre).
    corps = requetes.lire_json()
    corps = corps if isinstance(corps, dict) else {}
    genre = corps.get("type") if corps.get("type") in ("lettre", "admin", "plan", "arbre") else "cv"
    statistiques.compter(f"pdf:{genre}")
    if genre in ("cv", "lettre"):
        statistiques.compter(f"langue_document:{moteur._options(corps.get('options'))['langue']}")
        if genre == "cv" and "lien_qr" in options_avec_qr(corps.get("options")):
            statistiques.compter("pdf:cv_avec_qr")
    return Response(document, mimetype="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{nom}"',
    })


@app.post("/api/docx")
def docx():
    """Le même document au format Word (.docx), à retoucher dans Word, LibreOffice ou Google Docs.
    Mêmes conditions que le PDF : compte obligatoire, mêmes limites de demandes."""
    if app.config["COMPTE_POUR_PDF"] and not comptes.compte_connecte():
        return jsonify(erreur="Crée ton compte gratuit (ou connecte-toi) pour télécharger ton document.",
                       compte_requis=True), 401
    return fabriquer_le_docx()


@avec_erreurs
def fabriquer_le_docx():
    corps = requetes.lire_json()
    document, nom = word.fabriquer(corps)
    genre = corps.get("type") if corps.get("type") in ("lettre", "admin") else "cv"
    statistiques.compter(f"docx:{genre}")
    return Response(document, mimetype=word.MIME, headers={"Content-Disposition": f'attachment; filename="{nom}"'})


# Étapes du parcours dans l'éditeur, envoyées par le navigateur (editeur-apercu.js, signaler()), au plus une
# fois par onglet : on voit où les visiteurs s'arrêtent. Liste fermée, rien de personnel.
ETAPES_PARCOURS = ("editeur", "commence", "apercu", "telecharger", "compte_demande", "telecharge",
                   "telecharge_word", "echec_telechargement")


@app.post("/api/evenement")
def evenement():
    corps = requetes.lire_json()
    etape = corps.get("etape") if isinstance(corps, dict) else None
    if etape not in ETAPES_PARCOURS or not request.is_json:
        return jsonify(erreur="Étape inconnue."), 400
    origine = request.headers.get("Origin")
    if origine and urlsplit(origine).netloc != request.host:
        return jsonify(erreur="Requête refusée."), 403
    cle = ("evenement_ip", request.remote_addr)     # limite à part : ne prend rien aux PDF
    if not statistiques.robot(request.user_agent.string) and not comptes._bloque(cle):
        comptes._noter(cle)
        statistiques.compter(f"parcours:{etape}")
    return "", 204


# --------------------------------------------------------------------------
# Assistant IA (ia.py) : analyse du CV, et comparaison avec une offre.
# Compte obligatoire, accord explicite à chaque analyse, quota par compte et plafond global
# par jour (coût maîtrisé). Seules les analyses réussies sont décomptées.
# --------------------------------------------------------------------------
IA_PAR_COMPTE = int(os.environ.get("IA_ANALYSES_PAR_JOUR") or 5)
IA_MAX_JOUR = int(os.environ.get("IA_ANALYSES_MAX_JOUR") or 300)


@app.get("/api/ia")
def etat_ia():
    if not ia.actif():
        return jsonify(actif=False)
    compte = comptes.compte_connecte()
    restant = max(0, IA_PAR_COMPTE - comptes.usages_ia(compte[0])[0]) if compte else None
    return jsonify(actif=True, fournisseur=ia.nom_fournisseur(), par_jour=IA_PAR_COMPTE, restant=restant)


@app.post("/api/ia/analyse")
def analyse_ia():
    if not ia.actif():
        return jsonify(erreur="L'assistant IA n'est pas activé."), 404
    compte = comptes.compte_connecte()
    if not compte:
        return jsonify(erreur="Crée ton compte gratuit (ou connecte-toi) pour utiliser l'assistant IA.",
                       compte_requis=True), 401
    corps = requetes.lire_json()
    corps = corps if isinstance(corps, dict) else {}
    if corps.get("accord") is not True:
        return jsonify(erreur="Coche la case pour accepter l'envoi de ton CV à l'assistant IA.", accord_requis=True), 400
    if trop_de_requetes():
        return jsonify(erreur="Trop de demandes en peu de temps. Patiente une minute."), 429
    moi, tous = comptes.usages_ia(compte[0])
    if moi >= IA_PAR_COMPTE:
        return jsonify(erreur=f"Tu as utilisé tes {IA_PAR_COMPTE} analyses du jour. Reviens demain.", restant=0), 429
    if tous >= IA_MAX_JOUR:
        app.logger.warning("Assistant IA : plafond du jour atteint (%s analyses).", tous)
        return jsonify(erreur="L'assistant IA est très demandé aujourd'hui. Réessaie demain."), 503
    offre = corps.get("offre") if isinstance(corps.get("offre"), str) else ""
    try:
        resultat = ia.analyser(corps.get("cv"), offre, corps.get("langue"))
    except ia.ErreurIA as e:
        statistiques.compter(f"echec:ia:{e.code}")
        return jsonify(erreur=str(e)), e.code
    comptes.noter_usage_ia(compte[0])
    statistiques.compter("ia:analyse_offre" if resultat["offre"] else "ia:analyse")
    return jsonify(resultat=resultat, restant=max(0, IA_PAR_COMPTE - moi - 1), fournisseur=ia.nom_fournisseur())


@app.post("/api/importer")
@avec_erreurs
def importer_document():
    """Un CV ou une lettre existants (PDF ou .docx, envoyé tel quel dans le corps de la
    requête) -> les champs du formulaire, pré-remplis. Le fichier n'est pas conservé."""
    type_document = "lettre" if request.args.get("type") == "lettre" else "cv"
    octets = request.get_data(cache=False)
    if not octets:
        raise moteur.ErreurDonnees("Aucun fichier reçu.")
    resultat = importer.importer(octets, type_document)
    statistiques.compter(f"import:{type_document}")
    return jsonify(resultat)


# --------------------------------------------------------------------------
# CV en ligne : /cv/<code>, la page publique d'un CV dont le titulaire a activé le lien
# (Mon espace). Elle suit le document : chaque modification y apparaît aussitôt.
# Jamais indexée par les moteurs de recherche : seuls ceux qui ont le lien la voient.
# --------------------------------------------------------------------------
TEXTES_PUBLICS = {
    "fr": {"titre": "CV de {}", "pdf": "Télécharger le CV en PDF", "cree": "CV créé avec",
           "creer": "Crée le tien gratuitement", "absent": "Ce CV n'est pas ou plus en ligne.",
           "absent_detail": "Son titulaire a peut-être désactivé le lien.", "accueil": "Aller sur CV.express"},
    "en": {"titre": "CV of {}", "pdf": "Download the CV as PDF", "cree": "CV made with",
           "creer": "Make yours for free", "absent": "This CV is not online (or no longer).",
           "absent_detail": "Its owner may have turned the link off.", "accueil": "Go to CV.express"},
    "it": {"titre": "CV di {}", "pdf": "Scarica il CV in PDF", "cree": "CV creato con",
           "creer": "Crea il tuo gratis", "absent": "Questo CV non è (più) online.",
           "absent_detail": "Il titolare potrebbe aver disattivato il link.", "accueil": "Vai su CV.express"},
}


def _cv_public(donnees):
    """Le CV enregistré -> ce que montre la page publique : du texte seulement, nettoyé et
    borné comme pour le PDF (l'échappement HTML est fait par le modèle de page)."""
    cv = moteur._dico(donnees.get("cv"))
    options = moteur._options(donnees.get("options"))
    t = lambda v, maxi=300: moteur._texte(v, maxi)
    liste = lambda cle, maxi: moteur._liste(cv.get(cle), maxi)
    photo = cv.get("photo") if isinstance(cv.get("photo"), str) else ""
    if not re.fullmatch(r"data:image/(jpeg|png);base64,[A-Za-z0-9+/=]+", photo) or len(photo) > 2_800_000:
        photo = ""
    liens = []
    for l in liste("liens", 6):
        url = t(l.get("url"))
        if url and not re.match(r"^https?://", url, re.I):
            url = "https://" + url
        if moteur._URL_OK.match(url):
            liens.append({"url": url, "label": t(l.get("label"), 120) or re.sub(r"^https?://", "", url)})
    ec = moteur._dico(cv.get("etat_civil"))
    libelles = moteur.LIBELLES[options["langue"]]
    return {
        "langue": options["langue"], "couleur": str(options["couleur"]), "l": libelles,
        "nom": t(cv.get("nom"), 120), "titre": t(cv.get("titre"), 160), "ville": t(cv.get("ville"), 200),
        "telephone": t(cv.get("telephone"), 60), "email": t(cv.get("email"), 120), "photo": photo,
        "profil": moteur._lignes(cv.get("profil"), 12, 900), "liens": liens,
        "etat_civil": [(libelles[cle], t(ec.get(cle), 120)) for cle in
                       ("date_naissance", "lieu_naissance", "nationalite", "situation", "permis") if t(ec.get(cle))],
        "experiences": [{"poste": t(e.get("poste"), 160), "entreprise": t(e.get("entreprise"), 160),
                         "lieu": t(e.get("lieu"), 120), "dates": t(e.get("dates"), 60),
                         "points": moteur._lignes(e.get("points"), 12)}
                        for e in liste("experiences", 25) if t(e.get("poste")) or t(e.get("entreprise"))],
        "formations": [{"diplome": t(f.get("diplome"), 200), "ecole": t(f.get("ecole"), 200),
                        "dates": t(f.get("dates"), 60), "details": t(f.get("details"), 500)}
                       for f in liste("formations", 20) if t(f.get("diplome")) or t(f.get("ecole"))],
        "competences": [{"categorie": t(c.get("categorie"), 80), "liste": t(c.get("liste"), 500)}
                        for c in liste("competences", 15) if t(c.get("liste"))],
        "langues": [{"langue": t(x.get("langue"), 60), "niveau": t(x.get("niveau"), 80)}
                    for x in liste("langues", 12) if t(x.get("langue"))],
        "certifications": [{"titre": t(c.get("titre"), 200), "organisme": t(c.get("organisme"), 160),
                            "date": t(c.get("date"), 60)} for c in liste("certifications", 12) if t(c.get("titre"))],
        "projets": [{"titre": t(p.get("titre"), 200), "dates": t(p.get("dates"), 60), "details": t(p.get("details"), 600)}
                    for p in liste("projets", 12) if t(p.get("titre"))],
        "interets": t(cv.get("interets"), 500),
    }


def _sans_index(reponse):
    reponse.headers["X-Robots-Tag"] = "noindex, nofollow"
    reponse.headers["Cache-Control"] = "no-store"     # un lien désactivé ne doit plus rien montrer
    return reponse


@app.get("/cv/<code>")
def cv_en_ligne(code):
    donnees = comptes.document_partage(code, compter=True)
    if donnees:
        statistiques.compter("cv_en_ligne:vue")
    if not donnees:
        langue = request.accept_languages.best_match(["fr", "en", "it"]) or "fr"
        return _sans_index(Response(render_template("cv_public.html", cv=None, x=TEXTES_PUBLICS[langue],
                                                    langue=langue, p=PREFIXES[langue], racine=comptes.racine_site()), status=404))
    cv = _cv_public(donnees)
    return _sans_index(Response(render_template("cv_public.html", cv=cv, x=TEXTES_PUBLICS[cv["langue"]], code=code,
                                                langue=cv["langue"], p=PREFIXES[cv["langue"]], racine=comptes.racine_site())))


@app.get("/cv/<code>/pdf")
@avec_erreurs
def cv_en_ligne_pdf(code):
    donnees = comptes.document_partage(code)
    if not donnees:
        return _sans_index(Response("Ce CV n'est pas ou plus en ligne.", status=404, mimetype="text/plain"))
    options = moteur._dico(donnees.get("options"))
    pdf = moteur.generer_cv(donnees.get("cv"), options_avec_qr({**options, "qr": options.get("qr") is True, "partage": code}))
    nom = moteur._texte(moteur._dico(donnees.get("cv")).get("nom"), 120)
    nom = unicodedata.normalize("NFKD", nom).encode("ascii", "ignore").decode()
    nom = re.sub(r"[^A-Za-z0-9]+", "_", nom).strip("_")[:40]
    return _sans_index(Response(pdf, mimetype="application/pdf", headers={
        "Content-Disposition": f'inline; filename="CV_{nom or "document"}.pdf"'}))


# --------------------------------------------------------------------------
# Administration : le PDF d'un document enregistré dans un compte, fabriqué à la demande
# (les PDF ne sont jamais stockés). Réservé aux administrateurs ; chaque ouverture est
# notée dans le journal, sans adresse ni contenu. Non compté dans les statistiques d'usage.
# --------------------------------------------------------------------------
@app.get("/api/admin/documents/<int:numero>/pdf")
def admin_pdf(numero):
    if not admin.admin_connecte():
        abort(404)
    genre = request.args.get("type", "cv")
    if genre not in ("cv", "lettre", "admin", "plan", "arbre"):
        abort(404)
    with comptes._base() as b:
        ligne = b.execute("SELECT contenu, compte_id FROM documents WHERE id = ?", (comptes._numero(numero),)).fetchone()
    if not ligne:
        abort(404)
    donnees = json.loads(ligne[0])
    if genre not in moteur.pdf_possibles(donnees):
        return jsonify(erreur="Ce document ne contient pas encore ce type de document."), 404
    adm = moteur._dico(donnees.get("admin"))
    if adm.get("genre") not in ("demande", "reclamation"):     # comme dans l'éditeur (documentAdmin)
        adm = {**adm, "destinataire": {}, "pj": ""}
    corps = {"type": genre, "cv": donnees.get("cv"), "lettre": donnees.get("lettre"), "admin": adm,
             "plan": donnees.get("plan"), "arbre": donnees.get("arbre"), "options": donnees.get("options")}
    reponse = _admin_pdf_fabrique(corps)
    if isinstance(reponse, Response) and reponse.status_code == 200:
        admin._journal(f"PDF consulté ({genre})", document=comptes._numero(numero), compte=ligne[1])
    return reponse


@avec_erreurs
def _admin_pdf_fabrique(corps):
    document, nom = fabriquer_pdf(corps)
    return Response(document, mimetype="application/pdf", headers={
        "Content-Disposition": f'inline; filename="{nom}"', "Cache-Control": "no-store"})


# QR codes déjà fabriqués (une image ne change jamais pour un même code). Bornés en nombre.
_qr_images = {}


@app.get("/cv/<code>/qr")
@avec_erreurs
def cv_en_ligne_qr(code):
    """Le QR code du lien, en image : à afficher dans Mon espace, à imprimer ou à partager."""
    if not comptes.partage_existe(code):
        return _sans_index(Response("Ce CV n'est pas ou plus en ligne.", status=404, mimetype="text/plain"))
    adresse = f"{comptes.racine_site()}/cv/{code}"
    if adresse not in _qr_images:
        if not moteur._QR_OK.match(adresse):
            raise moteur.ErreurDonnees("Adresse du site invalide pour un QR code.")
        latex = ("\\documentclass{article}\\usepackage[paperwidth=4cm,paperheight=4cm,margin=0.3cm]{geometry}"
                 "\\usepackage{qrcode}\\pagestyle{empty}\\begin{document}\\noindent"
                 f"\\qrcode[height=3.4cm,nolink]{{{adresse}}}\\end{{document}}\n")
        image = moteur.pdf_vers_images(moteur.compiler(latex, {}, "cv"), pages_max=1, resolution=220)[0]
        if len(_qr_images) > 500:
            _qr_images.clear()
        _qr_images[adresse] = image
    return _sans_index(Response(_qr_images[adresse], mimetype="image/jpeg", headers={
        "Content-Disposition": f'inline; filename="QR_CV_{code}.jpg"'}))


@app.errorhandler(RecursionError)
def trop_imbrique(_):
    # Filet de sécurité : la lecture du JSON (requetes.lire_json) refuse déjà ce cas.
    return jsonify(erreur="Requête invalide."), 400


def _page_erreur(code):
    """Page d'erreur avec l'en-tête et le pied du site, dans la langue de l'adresse demandée."""
    if request.path.startswith("/api/"):
        return jsonify(erreur="Introuvable." if code == 404 else "Erreur du serveur. Réessaie dans un instant."), code
    trouve = re.match(r"^/(en|it)(/|$)", request.path)
    try:
        return page("erreur", trouve.group(1) if trouve else "fr", chemin="/", code=code), code
    except Exception:                                   # dernier recours : jamais d'erreur dans l'erreur
        return "Erreur.", code


@app.errorhandler(404)
def introuvable(_):
    return _page_erreur(404)


@app.errorhandler(500)
def erreur_serveur(_):
    return _page_erreur(500)


@app.errorhandler(413)
def trop_gros(_):
    return jsonify(erreur="Données trop volumineuses (3 Mo maximum)."), 413


if __name__ == "__main__":
    # debug=False : le mode debug de Flask ne doit jamais être exposé sur Internet.
    # use_reloader : le serveur se relance tout seul dès qu'un fichier .py change (sinon il
    # continue de tourner avec l'ancien code). Le débogueur, lui, reste désactivé.
    app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=True)
