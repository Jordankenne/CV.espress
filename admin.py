"""
Tableau de bord de l'administrateur du site (/admin) : chiffres clés, liste des comptes,
suppression d'un compte (par exemple à la demande de son titulaire, RGPD).

Accès : être connecté avec un compte dont l'adresse figure dans le réglage ADMINS
(une ou plusieurs adresses séparées par des virgules). Pour tous les autres, ces adresses
n'existent pas (404) : le site ne révèle même pas qu'il a une administration.

Ce que l'administrateur NE voit PAS : le contenu des CV et des lettres, ni les mots de passe
(seule leur empreinte est en base). La politique de confidentialité le promet aux utilisateurs.
"""
import os
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
