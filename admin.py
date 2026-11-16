"""
Tableau de bord de l'administrateur du site (/admin) : chiffres clés, liste des comptes,
fiche de chaque compte (adresse, documents), consultation et correction des documents,
envoi d'un lien de mot de passe, suppression, et vue brute de toutes les tables.

Accès : être connecté avec un compte dont l'adresse figure dans le réglage ADMINS
(une ou plusieurs adresses séparées par des virgules). Pour tous les autres, ces adresses
n'existent pas (404) : le site ne révèle même pas qu'il a une administration.

L'administrateur ne voit jamais les mots de passe, ni les empreintes ou jetons (masqués) :
il peut seulement envoyer au titulaire un lien pour en choisir un nouveau.
Chaque consultation et chaque modification d'un compte est écrite dans le journal du serveur
(numéro du compte, jamais son contenu), comme l'annonce la politique de confidentialité.
"""
import json
import os
import secrets
import threading
import time

from flask import Blueprint, abort, current_app, jsonify, request
from werkzeug.security import check_password_hash

import comptes as c

admin = Blueprint("admin", __name__, url_prefix="/api/admin")
admin.before_request(c._meme_site)          # même protection contre les requêtes d'autres sites
PAR_PAGE = 50
STOCKAGE_MAX_OCTETS = int(os.environ.get("STOCKAGE_MAX_MO") or 1024) * 1024 * 1024   # Neon gratuit : 1 Go


def adresses_admins():
    return {a.strip().lower() for a in c._reglage("ADMINS").split(",") if a.strip()}


def admin_connecte():
    """(id, email) si le visiteur est connecté avec un compte administrateur, sinon None."""
    compte = c.compte_connecte()
    if compte and compte[1] in adresses_admins():
        return compte
    return None


@admin.before_request
def _reserve_aux_admins():
    if not admin_connecte():
        abort(404)


def _taille_base(b):
    if c.POSTGRES:
        return b.execute("SELECT pg_database_size(current_database())").fetchone()[0]
    return sum(f.stat().st_size for f in c.DOSSIER.glob("comptes.sqlite3*"))


@admin.get("/resume")
def resume():
    maintenant = int(time.time())
    jour = 86400
    with c._base() as b:
        def nombre(sql, *valeurs):
            return b.execute(sql, valeurs).fetchone()[0] or 0
        chiffres = {
            "comptes": nombre("SELECT COUNT(*) FROM comptes"),
            "documents": nombre("SELECT COUNT(*) FROM documents"),
            "volume_documents": nombre("SELECT SUM(LENGTH(contenu)) FROM documents"),
            "inscrits_7j": nombre("SELECT COUNT(*) FROM comptes WHERE cree_le >= ?", maintenant - 7 * jour),
            "inscrits_30j": nombre("SELECT COUNT(*) FROM comptes WHERE cree_le >= ?", maintenant - 30 * jour),
            "actifs_7j": nombre("SELECT COUNT(*) FROM comptes WHERE vu_le >= ?", maintenant - 7 * jour),
            "actifs_30j": nombre("SELECT COUNT(*) FROM comptes WHERE vu_le >= ?", maintenant - 30 * jour),
            "invitations_en_attente": nombre("SELECT COUNT(*) FROM invitations WHERE expire_le >= ?", maintenant),
            "taille_base": _taille_base(b),
        }
        # Inscriptions des 30 derniers jours, jour par jour (comptées ici : même code pour les deux bases).
        dates = [ligne[0] for ligne in b.execute("SELECT cree_le FROM comptes WHERE cree_le >= ?",
                                                 (maintenant - 30 * jour,)).fetchall()]
    par_jour = {}
    for d in dates:
        cle = time.strftime("%Y-%m-%d", time.gmtime(d))
        par_jour[cle] = par_jour.get(cle, 0) + 1
    jours = [time.strftime("%Y-%m-%d", time.gmtime(maintenant - n * jour)) for n in range(29, -1, -1)]
    return jsonify(**chiffres, stockage_max=STOCKAGE_MAX_OCTETS, base="PostgreSQL" if c.POSTGRES else "SQLite",
                   inscriptions=[{"jour": j, "nombre": par_jour.get(j, 0)} for j in jours])


@admin.get("/utilisation")
def utilisation():
    """Compteurs d'usage des 30 derniers jours (statistiques.py), jour par jour."""
    import statistiques
    return jsonify(statistiques.lire(30))


@admin.get("/comptes")
def liste_comptes():
    """Comptes, du plus récent au plus ancien ; ?q= filtre sur l'adresse, ?page= (à partir de 1)."""
    recherche = c._sans_nul(request.args.get("q", ""))[:120].strip().lower()
    try:
        numero_page = max(1, min(int(request.args.get("page", 1)), 100_000))
    except ValueError:
        numero_page = 1
    # Recherche littérale : « % » et « _ » tapés dans la recherche ne sont pas des jokers.
    motif = "%" + recherche.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    with c._base() as b:
        total = b.execute("SELECT COUNT(*) FROM comptes WHERE email LIKE ? ESCAPE '\\'", (motif,)).fetchone()[0]
        lignes = b.execute("""
            SELECT c.id, c.email, c.cree_le, c.vu_le, COUNT(d.id), COALESCE(SUM(LENGTH(d.contenu)), 0)
            FROM comptes c LEFT JOIN documents d ON d.compte_id = c.id
            WHERE c.email LIKE ? ESCAPE '\\'
            GROUP BY c.id, c.email, c.cree_le, c.vu_le
            ORDER BY c.cree_le DESC, c.id DESC LIMIT ? OFFSET ?""",
                           (motif, PAR_PAGE, (numero_page - 1) * PAR_PAGE)).fetchall()
    admins = adresses_admins()
    return jsonify(total=total, page=numero_page, par_page=PAR_PAGE, comptes=[
        {"id": i, "email": e, "cree_le": cree, "vu_le": vu, "documents": n, "volume": v, "admin": e in admins}
        for i, e, cree, vu, n, v in lignes])


@admin.delete("/comptes/<int:numero>")
def supprimer_compte(numero):
    """Supprime un compte et ses documents. Le mot de passe de l'administrateur est redemandé."""
    moi = admin_connecte()
    cles = c._cles_echec(moi[1])
    if c._bloque(*cles):
        return jsonify(erreur="Trop de tentatives. Réessaie dans un quart d'heure."), 429
    mdp = c._corps().get("mot_de_passe")
    with c._base() as b:
        ligne = b.execute("SELECT empreinte FROM comptes WHERE id = ?", (moi[0],)).fetchone()
    if not ligne or not isinstance(mdp, str) or not check_password_hash(ligne[0], mdp[:c.MDP_MAX]):
        c._noter(*cles)
        return jsonify(erreur="Mot de passe incorrect."), 401
    if c._numero(numero) == moi[0]:
        return jsonify(erreur="Pour supprimer ton propre compte, passe par « Mon espace »."), 400
    with c._base() as b:
        supprimes = b.execute("DELETE FROM comptes WHERE id = ?", (c._numero(numero),)).rowcount
    if not supprimes:
        return jsonify(erreur="Ce compte n'existe pas ou n'existe plus."), 404
    current_app.logger.info("Compte n°%s supprimé par l'administration.", numero)   # sans l'adresse
    return jsonify(supprime=numero)


# --------------------------------------------------------------------------
# Fiche d'un compte, documents, lien de mot de passe
# --------------------------------------------------------------------------
def _journal(action, **numeros):
    """Trace d'une action de l'administration : des numéros, jamais d'adresse ni de contenu."""
    current_app.logger.info("Administration : %s (%s).", action,
                            ", ".join(f"{k} n°{v}" for k, v in numeros.items()))


def _introuvable(quoi="Ce compte"):
    return jsonify(erreur=f"{quoi} n'existe pas ou n'existe plus."), 404


@admin.get("/comptes/<int:numero>")
def fiche_compte(numero):
    numero = c._numero(numero)
    with c._base() as b:
        compte = b.execute("SELECT id, email, cree_le, vu_le FROM comptes WHERE id = ?", (numero,)).fetchone()
        if not compte:
            return _introuvable()
        documents = b.execute("""SELECT id, nom, modifie_le, version, LENGTH(contenu) FROM documents
                                 WHERE compte_id = ? ORDER BY modifie_le DESC, id DESC""", (numero,)).fetchall()
        lien = b.execute("SELECT expire_le FROM reinitialisations WHERE compte_id = ?", (numero,)).fetchone()
    _journal("fiche consultée", compte=numero)
    return jsonify(id=compte[0], email=compte[1], cree_le=compte[2], vu_le=compte[3],
                   admin=compte[1] in adresses_admins(),
                   lien_en_cours=bool(lien and lien[0] >= time.time()),
                   documents=[{"doc": d, "nom": n, "modifie_le": m, "version": v, "volume": t}
                              for d, n, m, v, t in documents])


@admin.patch("/comptes/<int:numero>")
def modifier_compte(numero):
    """Corrige l'adresse e-mail d'un compte (faute de frappe, changement d'adresse)."""
    numero = c._numero(numero)
    email = c._corps().get("email")
    email = c._sans_nul(email).strip().lower()[:120] if isinstance(email, str) else ""
    if not c._EMAIL_OK.match(email):
        return jsonify(erreur="Adresse e-mail invalide."), 400
    with c._base() as b:
        if b.execute("SELECT 1 FROM comptes WHERE email = ? AND id <> ?", (email, numero)).fetchone():
            return jsonify(erreur="Un autre compte utilise déjà cette adresse."), 409
        if not b.execute("UPDATE comptes SET email = ? WHERE id = ?", (email, numero)).rowcount:
            return _introuvable()
        b.execute("DELETE FROM invitations WHERE email = ?", (email,))
    _journal("adresse e-mail modifiée", compte=numero)
    return jsonify(id=numero, email=email)


@admin.post("/comptes/<int:numero>/lien")
def envoyer_lien(numero):
    """Envoie au titulaire un lien pour choisir un nouveau mot de passe (l'administrateur ne
    voit ni ne choisit jamais le mot de passe de quelqu'un)."""
    numero = c._numero(numero)
    jeton = secrets.token_urlsafe(32)
    with c._base() as b:
        ligne = b.execute("SELECT email FROM comptes WHERE id = ?", (numero,)).fetchone()
        if not ligne:
            return _introuvable()
        b.execute("""INSERT INTO reinitialisations (compte_id, empreinte, expire_le) VALUES (?, ?, ?)
                     ON CONFLICT(compte_id) DO UPDATE SET empreinte = excluded.empreinte,
                                                          expire_le = excluded.expire_le""",
                  (numero, c._empreinte_jeton(jeton), int(time.time()) + c.LIEN_MINUTES * 60))
    lien = f"{c.racine_site()}/compte?jeton={jeton}"
    threading.Thread(target=c._envoyer_lien, args=(ligne[0], "oubli", "fr", lien, current_app.logger),
                     daemon=True).start()
    _journal("lien de mot de passe envoyé", compte=numero)
    return jsonify(envoye=True)


@admin.get("/documents/<int:numero>")
def lire_document(numero):
    numero = c._numero(numero)
    with c._base() as b:
        ligne = b.execute("""SELECT d.id, d.compte_id, c.email, d.nom, d.contenu, d.modifie_le, d.version
                             FROM documents d JOIN comptes c ON c.id = d.compte_id WHERE d.id = ?""",
                          (numero,)).fetchone()
    if not ligne:
        return _introuvable("Ce document")
    _journal("document consulté", document=numero, compte=ligne[1])
    return jsonify(doc=ligne[0], compte=ligne[1], email=ligne[2], nom=ligne[3], donnees=json.loads(ligne[4]),
                   modifie_le=ligne[5], version=ligne[6])


@admin.put("/documents/<int:numero>")
def corriger_document(numero):
    """Remplace le contenu (et le nom) d'un document. « version » : celle qui a été affichée ;
    si le titulaire a enregistré entre-temps, refus (409) au lieu d'écraser son travail."""
    numero = c._numero(numero)
    corps = c._corps()
    try:
        contenu = c._contenu(corps.get("donnees"))
    except OverflowError as e:
        return jsonify(erreur=str(e)), 413
    except ValueError as e:
        return jsonify(erreur=str(e)), 400
    version = corps.get("version")
    if not isinstance(version, int) or isinstance(version, bool) or not 0 < version < 2 ** 62:
        return jsonify(erreur="Version du document manquante."), 400
    nom = c._nom(corps.get("nom"), "")
    with c._base() as b:
        modifies = b.execute("""UPDATE documents SET contenu = ?, nom = COALESCE(NULLIF(?, ''), nom),
                                modifie_le = ?, version = version + 1 WHERE id = ? AND version = ?""",
                             (contenu, nom, int(time.time()), numero, version)).rowcount
        actuel = b.execute("SELECT version, modifie_le, compte_id FROM documents WHERE id = ?", (numero,)).fetchone()
    if not actuel:
        return _introuvable("Ce document")
    if not modifies:
        return jsonify(erreur="Le titulaire a modifié ce document entre-temps. Recharge-le avant de le corriger.",
                       conflit=True, version=actuel[0]), 409
    _journal("document corrigé", document=numero, compte=actuel[2])
    return jsonify(doc=numero, version=actuel[0], modifie_le=actuel[1])


@admin.delete("/documents/<int:numero>")
def supprimer_document(numero):
    numero = c._numero(numero)
    with c._base() as b:
        ligne = b.execute("DELETE FROM documents WHERE id = ? RETURNING compte_id", (numero,)).fetchone()
    if not ligne:
        return _introuvable("Ce document")
    _journal("document supprimé", document=numero, compte=ligne[0])
    return jsonify(supprime=numero)


# --------------------------------------------------------------------------
# Vue brute : toutes les tables de la base
# --------------------------------------------------------------------------
# Colonnes jamais montrées en clair : empreintes de mots de passe et de liens, jetons de session.
MASQUEES = {"empreinte", "jeton"}
APERCU_CONTENU = 300                 # caractères d'un document montrés dans la vue brute


@admin.get("/tables/<nom>")
def table_brute(nom):
    if nom not in c.TABLES:
        abort(404)
    try:
        numero_page = max(1, min(int(request.args.get("page", 1)), 100_000))
    except ValueError:
        numero_page = 1
    with c._base() as b:
        total = b.execute(f"SELECT COUNT(*) FROM {nom}").fetchone()[0]
        curseur = b.execute(f"SELECT * FROM {nom} ORDER BY 1 DESC LIMIT ? OFFSET ?",
                            (PAR_PAGE, (numero_page - 1) * PAR_PAGE))
        colonnes = [d[0] for d in curseur.description]
        lignes = curseur.fetchall()
    def montrer(colonne, valeur):
        if colonne in MASQUEES:
            return "••••••"
        if colonne == "contenu" and isinstance(valeur, str) and len(valeur) > APERCU_CONTENU:
            return valeur[:APERCU_CONTENU] + f"… ({len(valeur)} caractères)"
        return valeur
    _journal("table consultée", **{f"table {nom} page": numero_page})
    return jsonify(table=nom, colonnes=colonnes, total=total, page=numero_page, par_page=PAR_PAGE,
                   lignes=[[montrer(col, v) for col, v in zip(colonnes, ligne)] for ligne in lignes])
