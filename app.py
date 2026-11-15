"""
Le site web : page d'accueil + éditeur (dossier web/) + une API qui fabrique les documents.
Les comptes utilisateurs (facultatifs) sont dans comptes.py.

En développement :   .venv/bin/python app.py        puis ouvrir http://localhost:5000
En production    :   gunicorn -w 1 --threads 16 -b 0.0.0.0:8000 app:app   (voir Dockerfile)
                     Un seul processus (-w 1) : la limite de débit est comptée en mémoire.
"""
import base64
import json
import os
import re
import threading
import time
from collections import defaultdict, deque

from flask import Flask, Response, jsonify, render_template, request
from markupsafe import Markup, escape

import admin
import comptes
import importer
import moteur
import requetes
import textes

# web/ : fichiers servis tels quels (CSS, JS, images, éditeur) ; pages/ : pages HTML
# assemblées par le serveur (accueil, guides, pages légales) avec en-tête et pied communs.
app = Flask(__name__, static_folder="web", static_url_path="", template_folder="pages")
# Refuse toute requête de plus de 3 Mo (la photo est déjà réduite côté navigateur).
app.config["MAX_CONTENT_LENGTH"] = 3 * 1024 * 1024
# Une page de pages/ modifiée est relue sans redémarrer le serveur (comme les fichiers de web/).
app.config["TEMPLATES_AUTO_RELOAD"] = True

# Comptes utilisateurs (facultatifs) : base de données, cookie de session, routes /api/compte.
comptes.initialiser(app)
# Tableau de bord de l'administrateur (réglage ADMINS) : /admin et /api/admin.
app.register_blueprint(admin.admin)

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
    reponse.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    # Les réponses de l'API contiennent le CV du visiteur : ni le navigateur (ordinateur
    # partagé), ni un proxy intermédiaire ne doivent en garder de copie.
    if request.path.startswith("/api/"):
        reponse.headers["Cache-Control"] = "no-store"
    if reponse.mimetype == "application/pdf":
        return reponse   # un PDF n'exécute rien ; certains lecteurs intégrés supportent mal la CSP
    reponse.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data: blob:; object-src 'none'; "
        "base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
    return reponse


# --------------------------------------------------------------------------
# Pages
# --------------------------------------------------------------------------
# Adresse -> fichier de pages/. Les guides sont aussi listés dans le plan du site.
GUIDES = ["modele-cv-afrique", "cv-europass", "cv-sans-experience", "lettre-de-motivation"]
LEGALES = ["mentions-legales", "confidentialite", "conditions"]


# Le site existe en trois langues : français à la racine, anglais sous /en/, italien sous /it/.
PREFIXES = {"fr": "", "en": "/en", "it": "/it"}


def page(nom, langue="fr"):
    """Affiche pages/<nom>.html dans la langue demandée. Les pages longues (guides, pages
    légales) ont un fichier par langue : pages/en/<nom>.html, pages/it/<nom>.html."""
    fichier = f"{nom}.html"
    if langue != "fr" and (moteur.RACINE / "pages" / langue / fichier).is_file():
        fichier = f"{langue}/{fichier}"
    chemin = "/" if nom == "accueil" else f"/{nom}"          # adresse de la page, sans préfixe de langue
    # Adresses publiques (canonical, hreflang, aperçus de partage) : celle du site en
    # production (ADRESSE_SITE), jamais celle annoncée par la requête.
    racine = comptes.racine_site()
    return render_template(
        fichier, racine=racine + "/", url_page=racine + request.path,
        langue=langue, p=PREFIXES[langue], c=textes.COMMUN[langue], a=textes.ACCUEIL[langue],
        # La même page dans chaque langue : sélecteur de langue et balises hreflang.
        versions=[(code, textes.LANGUES_SITE[code], PREFIXES[code] + chemin, racine + PREFIXES[code] + chemin)
                  for code in PREFIXES])


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

    return {"editeur": infos, "champ": champ}


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
        return "Page introuvable.", 404
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
        return app.send_static_file("creer.html")      # traduit dans le navigateur (traductions.js)
    return "Page introuvable.", 404


@app.get("/<nom>")
def page_texte(nom):
    if nom in GUIDES or nom in LEGALES:
        return page(nom)
    # Sinon c'est un fichier de web/ (style.css, app.js…) : cette route passe avant
    # celle des fichiers statiques, il faut donc leur passer la main.
    return app.send_static_file(nom)


@app.get("/robots.txt")
def robots():
    return Response(f"User-agent: *\nDisallow: /api/\nDisallow: /admin\nSitemap: {comptes.racine_site()}/sitemap.xml\n",
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
def fabriquer_pdf():
    """Lit la requête {type, cv, lettre, options} et renvoie (pdf, nom de fichier).
    Lève ErreurDonnees / ErreurCompilation."""
    corps = requetes.lire_json()
    if not isinstance(corps, dict):
        raise moteur.ErreurDonnees("Requête invalide.")
    if corps.get("type") == "lettre":
        pdf = moteur.generer_lettre(corps.get("cv"), corps.get("lettre"), corps.get("options"))
        prefixe = "Lettre"
    else:
        pdf = moteur.generer_cv(corps.get("cv"), corps.get("options"))
        prefixe = "CV"
    nom = (corps.get("cv") or {}).get("nom", "")
    nom = re.sub(r"[^A-Za-z0-9]+", "_", nom if isinstance(nom, str) else "").strip("_")[:40]
    return pdf, f"{prefixe}_{nom or 'document'}.pdf"


def avec_erreurs(vue):
    """Transforme les erreurs du moteur en réponses JSON propres."""
    def enveloppe():
        if trop_de_requetes():
            return jsonify(erreur="Trop de demandes en peu de temps. Patiente une minute."), 429
        fiche = _entrer()
        if fiche is None:
            return jsonify(erreur="Plusieurs documents sont déjà en cours de fabrication. "
                                  "Réessaie dans quelques secondes."), 429
        try:
            with fiche[1]:      # une seule fabrication à la fois par visiteur
                return vue()
        except moteur.ErreurDonnees as e:
            return jsonify(erreur=str(e)), 400
        except moteur.ServeurOccupe:
            # Toutes les places de compilation sont prises depuis trop longtemps : on libère
            # ce fil tout de suite plutôt que de le laisser bloqué (les pages restent servies).
            reponse = jsonify(erreur="Beaucoup de demandes en ce moment. Réessaie dans quelques secondes.")
            reponse.headers["Retry-After"] = "10"
            return reponse, 503
        except moteur.ErreurCompilation as e:
            # Le détail (log LaTeX) va dans les logs du serveur, pas chez l'utilisateur.
            app.logger.error("%s", e)
            return jsonify(erreur="La génération du document a échoué. Réessaie dans un instant."), 500
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


@app.post("/api/pdf")
@avec_erreurs
def pdf():
    """Le document final, en PDF."""
    document, nom = fabriquer_pdf()
    return Response(document, mimetype="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{nom}"',
    })


@app.post("/api/importer")
@avec_erreurs
def importer_document():
    """Un CV ou une lettre existants (PDF ou .docx, envoyé tel quel dans le corps de la
    requête) -> les champs du formulaire, pré-remplis. Le fichier n'est pas conservé."""
    type_document = "lettre" if request.args.get("type") == "lettre" else "cv"
    octets = request.get_data(cache=False)
    if not octets:
        raise moteur.ErreurDonnees("Aucun fichier reçu.")
    return jsonify(importer.importer(octets, type_document))


@app.errorhandler(RecursionError)
def trop_imbrique(_):
    # Filet de sécurité : la lecture du JSON (requetes.lire_json) refuse déjà ce cas.
    return jsonify(erreur="Requête invalide."), 400


@app.errorhandler(413)
def trop_gros(_):
    return jsonify(erreur="Données trop volumineuses (3 Mo maximum)."), 413


if __name__ == "__main__":
    # debug=False : le mode debug de Flask ne doit jamais être exposé sur Internet.
    # use_reloader : le serveur se relance tout seul dès qu'un fichier .py change (sinon il
    # continue de tourner avec l'ancien code). Le débogueur, lui, reste désactivé.
    app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=True)
