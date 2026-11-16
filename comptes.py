"""
Comptes utilisateurs (facultatifs) : inscription, connexion, et sauvegarde du CV sur le
serveur pour le retrouver depuis un autre appareil.

Règles de sécurité appliquées ici :
  - le mot de passe n'est jamais enregistré : seulement son empreinte (scrypt, salée) ;
  - chaque requête sur les données passe par l'identifiant de la session : un compte
    ne peut ni lire ni modifier les données d'un autre ;
  - les échecs de connexion sont limités par couple (adresse IP, compte) : un inconnu qui
    tape de mauvais mots de passe ne bloque pas le vrai titulaire depuis chez lui ;
  - le cookie de session est signé, invisible pour JavaScript (HttpOnly) et n'est pas
    envoyé par les autres sites (SameSite) ;
  - les requêtes qui modifient quelque chose doivent venir de notre propre site ;
  - l'adresse e-mail est toujours vérifiée : on s'inscrit en recevant un lien, et c'est en
    l'ouvrant qu'on choisit son mot de passe. Personne ne peut donc créer un compte au nom
    d'une adresse qui n'est pas la sienne ;
  - inscription et mot de passe oublié répondent toujours la même chose, que l'adresse ait
    déjà un compte ou non : le site ne révèle pas qui est inscrit ;
  - les liens envoyés par e-mail sont à usage unique, à durée limitée, et seule leur
    empreinte est gardée en base. Leur adresse vient de ADRESSE_SITE, jamais de la requête.

Stockage : PostgreSQL si DATABASE_URL est défini (en ligne, ex. Neon), sinon un fichier
SQLite (dossier donnees/, à sauvegarder et à garder hors de Git). Le même code sert aux deux.
"""
import hashlib
import json
import os
import re
import secrets
import smtplib
import sqlite3
import threading
import time
import urllib.request
from collections import defaultdict, deque
from contextlib import contextmanager
from datetime import timedelta
from email.message import EmailMessage
from email.utils import parseaddr
from pathlib import Path
from urllib.parse import urlsplit

from flask import Blueprint, current_app, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

import requetes

RACINE = Path(__file__).parent


def _reglage(nom):
    """Réglage de l'hébergeur, sans les espaces ni retours à la ligne collés par erreur avec."""
    return os.environ.get(nom, "").strip()


DOSSIER = Path(os.environ.get("DOSSIER_DONNEES") or RACINE / "donnees")
BASE = DOSSIER / "comptes.sqlite3"
# Base PostgreSQL en ligne (Neon, Supabase…) : son adresse complète, mot de passe compris,
# donnée par l'hébergeur de la base (postgresql://utilisateur:motdepasse@hote/base?sslmode=require).
ADRESSE_BASE = _reglage("DATABASE_URL")
POSTGRES = ADRESSE_BASE.startswith(("postgres://", "postgresql://"))

MDP_MIN, MDP_MAX = 8, 200
DONNEES_MAX = 2_500_000          # taille maximale d'un document enregistré (photo comprise), en octets
DOCUMENTS_MAX = 10               # nombre de documents (un CV et sa lettre) par compte
NOM_MAX = 60
SESSION_JOURS = 30
LIEN_MINUTES = 30                # durée de validité d'un lien « mot de passe oublié »
INVITATION_HEURES = 24           # durée de validité d'un lien d'inscription

# Envoi des e-mails (inscription, mot de passe oublié). À définir chez l'hébergeur :
#   SMTP_HOTE, SMTP_PORT (587 par défaut), SMTP_UTILISATEUR, SMTP_MOT_DE_PASSE,
#   EMAIL_EXPEDITEUR (adresse affichée comme expéditeur),
#   ADRESSE_SITE (ex. https://cv.express) : l'adresse du site, mise dans les liens envoyés.
# Sans SMTP_HOTE (en développement), le lien est écrit dans le journal du serveur au lieu d'être envoyé.
#   ou, à la place du SMTP, BREVO_CLE_API : envoi par l'API web de Brevo (obligatoire chez les
#   hébergeurs gratuits qui bloquent le SMTP, comme Render).
BREVO_CLE_API = _reglage("BREVO_CLE_API")
SMTP_HOTE = _reglage("SMTP_HOTE")
SMTP_PORT = int(_reglage("SMTP_PORT") or 587)
SMTP_UTILISATEUR = _reglage("SMTP_UTILISATEUR")
SMTP_MOT_DE_PASSE = _reglage("SMTP_MOT_DE_PASSE")
EMAIL_EXPEDITEUR = _reglage("EMAIL_EXPEDITEUR") or SMTP_UTILISATEUR
ADRESSE_SITE = _reglage("ADRESSE_SITE").rstrip("/")
# Production = site derrière le proxy de l'hébergeur. Les réglages de sécurité y sont obligatoires.
PRODUCTION = os.environ.get("DERRIERE_PROXY") == "1"
_EMAIL_OK = re.compile(r"^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")

comptes = Blueprint("comptes", __name__, url_prefix="/api/compte")


# --------------------------------------------------------------------------
# Base de données
# --------------------------------------------------------------------------
TABLES = ("comptes", "documents", "reinitialisations", "invitations",    # ordre des clés étrangères
          "partages", "candidatures")
# Erreurs « base injoignable ou occupée » : réponse 503 (réessayer), jamais une erreur 500.
ERREURS_BASE = (sqlite3.OperationalError,)
if POSTGRES:
    import psycopg
    from psycopg_pool import ConnectionPool
    ERREURS_BASE += (psycopg.OperationalError,)
_reserve = None
_verrou_reserve = threading.Lock()


def _reserve_postgres():
    """Réserve de connexions PostgreSQL, ouverte au premier besoin. Les connexions inutilisées
    depuis une minute sont fermées : la base gratuite de Neon peut alors se mettre en veille
    (elle compte ses heures de calcul tant qu'une connexion reste ouverte)."""
    global _reserve
    with _verrou_reserve:
        if _reserve is None:
            _reserve = ConnectionPool(ADRESSE_BASE, min_size=0, max_size=5, max_idle=60, timeout=15,
                                      kwargs={"connect_timeout": 10}, check=ConnectionPool.check_connection,
                                      name="comptes", open=True)
        return _reserve


class _Connexion:
    """Même usage pour SQLite et PostgreSQL : execute("… WHERE id = ?", (valeur,))."""

    def __init__(self, brute):
        self.brute = brute

    def execute(self, sql, valeurs=()):
        if POSTGRES:
            sql = sql.replace("?", "%s")       # aucune requête d'ici ne contient de « ? » ni de « % » littéral
        return self.brute.execute(sql, valeurs)


@contextmanager
def _base():
    """Une connexion par opération : validée (commit) si tout s'est bien passé, annulée
    sinon, et TOUJOURS fermée (SQLite) ou rendue à la réserve (PostgreSQL) à la fin."""
    if POSTGRES:
        with _reserve_postgres().connection() as connexion:
            yield _Connexion(connexion)
        return
    connexion = sqlite3.connect(BASE, timeout=10)
    try:
        connexion.execute("PRAGMA foreign_keys = ON")
        with connexion:
            yield _Connexion(connexion)
    finally:
        connexion.close()


def _schema(postgres):
    """Tables de la base, écrites pour PostgreSQL ou pour SQLite."""
    numero = "BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY" if postgres else "INTEGER PRIMARY KEY"
    entier = "BIGINT" if postgres else "INTEGER"
    return [
        f"""CREATE TABLE IF NOT EXISTS comptes (
            id        {numero},
            email     TEXT NOT NULL UNIQUE,
            empreinte TEXT NOT NULL,
            jeton     TEXT NOT NULL,           -- change à chaque suppression/changement : invalide les sessions
            cree_le   {entier} NOT NULL,
            vu_le     {entier} NOT NULL)""",
        # Un compte peut garder plusieurs documents (un CV et sa lettre), par exemple un par offre.
        # « version » augmente à chaque enregistrement : un appareil qui enregistre une version
        # périmée est refusé (409) au lieu d'écraser le travail fait entre-temps sur un autre.
        f"""CREATE TABLE IF NOT EXISTS documents (
            id         {numero},
            compte_id  {entier} NOT NULL REFERENCES comptes(id) ON DELETE CASCADE,
            nom        TEXT NOT NULL,
            contenu    TEXT NOT NULL,
            modifie_le {entier} NOT NULL,
            version    {entier} NOT NULL DEFAULT 1)""",
        "CREATE INDEX IF NOT EXISTS documents_du_compte ON documents (compte_id, modifie_le)",
        # Liens « mot de passe oublié » : on ne garde que l'empreinte du jeton, jamais le jeton.
        f"""CREATE TABLE IF NOT EXISTS reinitialisations (
            compte_id {entier} PRIMARY KEY REFERENCES comptes(id) ON DELETE CASCADE,
            empreinte TEXT NOT NULL,
            expire_le {entier} NOT NULL)""",
        # Liens d'inscription : le compte n'est créé qu'à l'ouverture du lien, ce qui prouve
        # que l'adresse appartient bien à la personne.
        f"""CREATE TABLE IF NOT EXISTS invitations (
            email     TEXT PRIMARY KEY,
            empreinte TEXT NOT NULL,
            expire_le {entier} NOT NULL)""",
        # Lien public d'un CV (/cv/<code>), créé seulement à la demande de son titulaire.
        # Un document a au plus un lien ; le supprimer (ou supprimer le document) le désactive.
        f"""CREATE TABLE IF NOT EXISTS partages (
            code      TEXT PRIMARY KEY,
            doc_id    {entier} NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
            compte_id {entier} NOT NULL REFERENCES comptes(id) ON DELETE CASCADE,
            cree_le   {entier} NOT NULL,
            vues      {entier} NOT NULL DEFAULT 0)""",
        # Suivi des candidatures : une ligne par offre à laquelle on a répondu.
        # doc_id : le CV et la lettre envoyés (oublié si le document est supprimé).
        f"""CREATE TABLE IF NOT EXISTS candidatures (
            id         {numero},
            compte_id  {entier} NOT NULL REFERENCES comptes(id) ON DELETE CASCADE,
            doc_id     {entier} REFERENCES documents(id) ON DELETE SET NULL,
            entreprise TEXT NOT NULL,
            poste      TEXT NOT NULL,
            statut     TEXT NOT NULL,
            envoye_le  TEXT NOT NULL,
            relance_le TEXT NOT NULL,
            lien       TEXT NOT NULL,
            notes      TEXT NOT NULL,
            modifie_le {entier} NOT NULL)""",
        "CREATE INDEX IF NOT EXISTS candidatures_du_compte ON candidatures (compte_id)",
    ]


def racine_site():
    """Adresse publique du site, sans « / » final. En production, toujours ADRESSE_SITE :
    jamais l'en-tête Host de la requête, qu'un attaquant peut choisir."""
    return ADRESSE_SITE or request.url_root.rstrip("/")


def _verifier_configuration():
    """En production, refuse de démarrer si un réglage de sécurité manque."""
    if not PRODUCTION:
        return
    manquants = []
    if not ADRESSE_SITE.startswith("https://"):
        manquants.append("ADRESSE_SITE (l'adresse du site en https, ex. https://cv.express)")
    if len(_reglage("CLE_SECRETE")) < 32:
        manquants.append("CLE_SECRETE (au moins 32 caractères aléatoires)")
    if not (SMTP_HOTE or BREVO_CLE_API) or not EMAIL_EXPEDITEUR:
        manquants.append("BREVO_CLE_API (ou SMTP_HOTE) et EMAIL_EXPEDITEUR (envoi des e-mails d'inscription)")
    if ADRESSE_BASE and not POSTGRES:
        manquants.append("DATABASE_URL (doit commencer par postgresql://)")
    if manquants:
        raise RuntimeError("Réglages de production manquants : " + " ; ".join(manquants))


def _creer_secret(fichier):
    """Crée le fichier de clé d'un seul coup, lisible uniquement par le serveur (0600)."""
    try:
        descripteur = os.open(fichier, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return
    with os.fdopen(descripteur, "w") as f:
        f.write(secrets.token_hex(32))


def initialiser(app):
    """À appeler une fois au démarrage : crée le dossier, la base et la clé de session."""
    _verifier_configuration()
    # Tout fichier créé ensuite par le serveur (base, journal -wal/-shm, clé) n'est lisible
    # que par lui : ni les autres comptes de la machine, ni les autres conteneurs.
    os.umask(0o077)
    DOSSIER.mkdir(parents=True, exist_ok=True)
    os.chmod(DOSSIER, 0o700)
    if PRODUCTION:
        # Seules les requêtes adressées au vrai nom du site sont acceptées (plus localhost,
        # pour le contrôle de santé du conteneur).
        noms = [urlsplit(ADRESSE_SITE).hostname, "localhost", "127.0.0.1"]
        # Render donne aussi au service une adresse en .onrender.com (contrôle de santé).
        # Hugging Face Spaces aussi (SPACE_HOST, ex. ton-nom-cv-express.hf.space).
        for variable in ("RENDER_EXTERNAL_HOSTNAME", "SPACE_HOST"):
            if os.environ.get(variable):
                noms.append(os.environ[variable])
        app.config["TRUSTED_HOSTS"] = noms
    try:
        _creer_tables()
    except ERREURS_BASE as e:
        if not POSTGRES:
            raise
        # Message clair dans le journal de l'hébergeur au lieu d'une longue trace.
        raise RuntimeError(f"Base PostgreSQL injoignable ({type(e).__name__}). Vérifier DATABASE_URL ; "
                           "si l'hébergeur bloque le port 5432 en sortie, la base ne peut pas être "
                           "atteinte depuis ce serveur.") from e
    for fichier in DOSSIER.glob("comptes.sqlite3*"):     # base et ses fichiers -wal / -shm
        os.chmod(fichier, 0o600)
    _configurer_session(app)


def _creer_tables():
    with _base() as b:
        if not POSTGRES:
            b.execute("PRAGMA journal_mode = WAL")
        for ordre in _schema(POSTGRES):
            b.execute(ordre)
        maintenant = int(time.time())
        b.execute("DELETE FROM invitations WHERE expire_le < ?", (maintenant,))
        b.execute("DELETE FROM reinitialisations WHERE expire_le < ?", (maintenant,))
        if not POSTGRES:
            # Ancienne table (un seul CV par compte) : son contenu devient le premier document.
            if b.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'donnees'").fetchone():
                b.execute("""INSERT INTO documents (compte_id, nom, contenu, modifie_le)
                             SELECT compte_id, 'Mon CV', contenu, modifie_le FROM donnees""")
                b.execute("DROP TABLE donnees")
            # Base créée avant les numéros de version des documents.
            if "version" not in {colonne[1] for colonne in b.execute("PRAGMA table_info(documents)")}:
                b.execute("ALTER TABLE documents ADD COLUMN version INTEGER NOT NULL DEFAULT 1")


def _configurer_session(app):
    # Clé qui signe les cookies de session. En production : variable CLE_SECRETE (obligatoire),
    # gardée hors du dossier des données et donc hors des sauvegardes.
    # En développement, on en fabrique une dans donnees/ pour survivre aux redémarrages.
    cle = _reglage("CLE_SECRETE")
    if len(cle) < 32:
        fichier = DOSSIER / "cle_secrete"
        _creer_secret(fichier)
        os.chmod(fichier, 0o600)
        cle = fichier.read_text().strip()
    app.secret_key = cle
    app.config.update(
        SESSION_COOKIE_NAME="session_cv",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        # Cookie envoyé seulement en HTTPS, sauf en développement sur localhost.
        SESSION_COOKIE_SECURE=os.environ.get("DERRIERE_PROXY") == "1",
        PERMANENT_SESSION_LIFETIME=timedelta(days=SESSION_JOURS),
    )
    app.register_blueprint(comptes)
    for erreur in ERREURS_BASE:
        app.register_error_handler(erreur, _base_indisponible)
    # Sauvegardes automatiques : seulement pour la base SQLite. Une base PostgreSQL en ligne se
    # sauvegarde avec « python -m comptes sauvegarder » lancé depuis ton ordinateur (voir README).
    if SAUVEGARDE_HEURES > 0 and not POSTGRES:
        threading.Thread(target=_sauvegardes_regulieres, args=(app.logger,), daemon=True,
                         name="sauvegardes").start()


# --------------------------------------------------------------------------
# Sauvegardes automatiques de la base
# --------------------------------------------------------------------------
# Une copie cohérente (API de sauvegarde de SQLite : sûre même pendant les écritures) toutes
# les SAUVEGARDE_HEURES heures dans donnees/sauvegardes/, les SAUVEGARDES_GARDEES plus récentes
# conservées. Ces copies sont sur le MÊME disque : elles protègent d'une erreur ou d'une base
# abîmée, pas de la perte du disque. Prévoir aussi une copie ailleurs (voir README).
# Lancement manuel (tâche cron de l'hébergeur) : python -m comptes sauvegarder
# Avec PostgreSQL (DATABASE_URL), la même commande télécharge toute la base dans un fichier
# SQLite sur l'ordinateur qui la lance ; « python -m comptes restaurer FICHIER » la remet en ligne.
SAUVEGARDE_HEURES = float(os.environ.get("SAUVEGARDE_HEURES") or 24)
SAUVEGARDES_GARDEES = int(os.environ.get("SAUVEGARDES_GARDEES") or 14)
SAUVEGARDES = DOSSIER / "sauvegardes"
_verrou_sauvegarde = threading.Lock()


def _copier_postgres_vers(copie):
    """Copie toutes les tables PostgreSQL dans la base SQLite « copie », en une seule
    lecture cohérente (instantané : les écritures faites pendant la copie n'y sont pas)."""
    for ordre in _schema(False):
        copie.execute(ordre)
    with _base() as b:
        b.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        for table in TABLES:
            with b.brute.cursor(name=f"export_{table}") as curseur:       # lu par paquets, pas tout en mémoire
                curseur.execute(f"SELECT * FROM {table}")
                colonnes = None
                while lignes := curseur.fetchmany(200):
                    colonnes = colonnes or [c.name for c in curseur.description]
                    copie.executemany(f"INSERT INTO {table} ({', '.join(colonnes)}) "
                                      f"VALUES ({', '.join('?' * len(colonnes))})", lignes)
    copie.commit()


def sauvegarder_base():
    """Écrit une copie de la base ; renvoie son chemin. Supprime les copies les plus anciennes."""
    with _verrou_sauvegarde:
        DOSSIER.mkdir(mode=0o700, parents=True, exist_ok=True)
        SAUVEGARDES.mkdir(mode=0o700, exist_ok=True)
        horodatage = time.strftime("comptes-%Y%m%d-%H%M%S")
        for n in range(100):                  # deux copies dans la même seconde : -1, -2…
            cible = SAUVEGARDES / f"{horodatage}{f'-{n}' if n else ''}.sqlite3"
            try:
                # Créé d'emblée lisible par le seul propriétaire : il contient les adresses e-mail.
                os.close(os.open(cible, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600))
                break
            except FileExistsError:
                continue
        copie = sqlite3.connect(cible)
        try:
            if POSTGRES:
                _copier_postgres_vers(copie)
            else:
                source = sqlite3.connect(BASE, timeout=30)
                try:
                    source.backup(copie)
                finally:
                    source.close()
        except BaseException:
            copie.close()
            cible.unlink()                       # pas de copie à moitié écrite
            raise
        copie.close()
        os.chmod(cible, 0o600)
        for ancienne in sorted(SAUVEGARDES.glob("comptes-*.sqlite3"))[:-SAUVEGARDES_GARDEES]:
            ancienne.unlink()
        return cible


def restaurer_base(fichier):
    """Remet dans la base PostgreSQL une copie faite par sauvegarder_base() (ou la base SQLite
    d'un serveur précédent : c'est aussi le moyen d'y transférer des comptes existants).
    Refuse si la base contient déjà des comptes : on n'écrase jamais rien."""
    if not POSTGRES:
        raise RuntimeError("Pour une base SQLite, il suffit de remettre le fichier à la place de "
                           f"{BASE} (serveur arrêté).")
    source = sqlite3.connect(f"file:{Path(fichier).resolve()}?mode=ro", uri=True)
    try:
        with _base() as b:
            for ordre in _schema(True):
                b.execute(ordre)
            if b.execute("SELECT COUNT(*) FROM comptes").fetchone()[0]:
                raise RuntimeError("La base en ligne contient déjà des comptes : restauration refusée.")
            nombres = {}
            presentes = {ligne[0] for ligne in source.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            for table in TABLES:
                if table not in presentes:          # copie faite avant l'arrivée de cette table
                    continue
                curseur = source.execute(f"SELECT * FROM {table}")
                colonnes = [c[0] for c in curseur.description]
                ordre = (f"INSERT INTO {table} ({', '.join(colonnes)}) "
                         f"VALUES ({', '.join(['%s'] * len(colonnes))})")
                nombres[table] = 0
                while lignes := curseur.fetchmany(200):
                    with b.brute.cursor() as c:
                        c.executemany(ordre, lignes)
                    nombres[table] += len(lignes)
            for table in ("comptes", "documents", "candidatures"):   # les prochains numéros suivent les anciens
                b.execute(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                          f"(SELECT COALESCE(MAX(id), 0) + 1 FROM {table}), false)")
        return nombres
    finally:
        source.close()


def _sauvegardes_regulieres(journal):
    time.sleep(300)                          # pas pendant le démarrage du serveur
    while True:
        try:
            journal.info("Sauvegarde de la base : %s", sauvegarder_base().name)
        except (OSError, sqlite3.Error, *ERREURS_BASE) as e:
            journal.error("Sauvegarde de la base impossible : %s", e)
        time.sleep(SAUVEGARDE_HEURES * 3600)


# --------------------------------------------------------------------------
# Protections
# --------------------------------------------------------------------------
# Mots de passe essayés au hasard : on compte les ÉCHECS sur un quart d'heure.
#   - « paire » (adresse IP, compte visé) : 8 au plus. C'est la limite qui arrête un attaquant,
#     sans gêner le vrai titulaire, qui se connecte depuis une autre adresse IP ;
#   - « ip » : 20 au plus (derrière une même adresse, cybercafé ou école, il y a plusieurs personnes) ;
#   - « email » : 100 au plus, toutes adresses IP confondues. Très haute exprès : sinon n'importe
#     qui pourrait bloquer le compte de quelqu'un d'autre. Au-delà, le lien « mot de passe
#     oublié » reste disponible et lève le blocage.
# Les réussites ne comptent pas. Les e-mails envoyés (inscription, mot de passe oublié) sont
# limités par adresse visée et par adresse IP, pour qu'on ne puisse pas inonder une boîte.
FENETRE_S = 15 * 60
LIMITES = {"paire": 8, "ip": 20, "email": 100, "lien_email": 3, "lien_ip": 10, "jeton_ip": 10}
_echecs = defaultdict(deque)
_verrou = threading.Lock()


def _bloque(*cles):
    """Vrai si l'une des clés (type, valeur) a atteint sa limite d'échecs récents."""
    maintenant = time.monotonic()
    with _verrou:
        for cle in cles:
            file = _echecs.get(cle)
            while file and maintenant - file[0] > FENETRE_S:
                file.popleft()
            if file and len(file) >= LIMITES[cle[0]]:
                return True
    return False


def _noter(*cles):
    """Enregistre un échec pour chacune des clés."""
    maintenant = time.monotonic()
    with _verrou:
        for cle in cles:
            _echecs[cle].append(maintenant)
        if len(_echecs) > 20_000:      # ménage
            for cle in [c for c, f in _echecs.items() if not f or maintenant - f[-1] > FENETRE_S]:
                del _echecs[cle]


def _oublier(*cles):
    with _verrou:
        for cle in cles:
            _echecs.pop(cle, None)


@comptes.before_request
def _meme_site():
    """Refuse les requêtes de modification envoyées depuis un autre site (CSRF) :
    elles doivent être en JSON et, si le navigateur indique leur origine, venir d'ici."""
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return None
    origine = request.headers.get("Origin")
    if origine and urlsplit(origine).netloc != request.host:
        return jsonify(erreur="Requête refusée."), 403
    if not request.is_json:
        return jsonify(erreur="Requête invalide."), 400
    return None


# Empreinte bidon : quand l'adresse est inconnue, on vérifie quand même un mot de passe,
# pour que la réponse ne soit pas plus rapide (ce qui révélerait quels comptes existent).
_EMPREINTE_BIDON = generate_password_hash(secrets.token_hex(16))


def _corps():
    corps = requetes.lire_json()       # JSON invalide ou trop imbriqué -> {} (jamais d'erreur 500)
    return corps if isinstance(corps, dict) else {}


def _identifiants():
    """(email normalisé, mot de passe) lus dans la requête ; chaînes vides si absents."""
    corps = _corps()
    email, mdp = corps.get("email"), corps.get("mot_de_passe")
    email = _sans_nul(email).strip().lower() if isinstance(email, str) else ""
    return email[:120], mdp if isinstance(mdp, str) else ""


def compte_connecte():
    """(id, email) du compte de la session en cours, ou None.
    La session contient un jeton comparé à celui de la base : supprimer le compte
    déconnecte donc aussitôt tous les appareils."""
    cid, jeton = session.get("compte"), session.get("jeton")
    if not isinstance(cid, int) or not isinstance(jeton, str):
        return None
    with _base() as b:
        ligne = b.execute("SELECT id, email, jeton FROM comptes WHERE id = ?", (cid,)).fetchone()
    if not ligne or not secrets.compare_digest(ligne[2], jeton):
        session.clear()
        return None
    return ligne[0], ligne[1]


def _ouvrir_session(cid, jeton):
    session.clear()                 # nouvelle session : pas de reprise d'un ancien cookie
    session.permanent = True
    session["compte"], session["jeton"] = cid, jeton


def _non_connecte():
    return jsonify(erreur="Connecte-toi pour continuer."), 401


def _base_indisponible(erreur):
    """Base injoignable (réveil de la base en ligne, coupure réseau) ou trop occupée."""
    current_app.logger.error("Base de données indisponible : %s", type(erreur).__name__)
    reponse = jsonify(erreur="Service momentanément indisponible. Réessaie dans quelques secondes.")
    reponse.headers["Retry-After"] = "10"
    return reponse, 503


def _sans_nul(texte):
    """PostgreSQL refuse le caractère nul dans un texte : on l'enlève de ce qu'envoie le visiteur."""
    return texte.replace("\x00", "")


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------
@comptes.get("")
def etat():
    compte = compte_connecte()
    if not compte:
        return jsonify(connecte=False, email=None)
    # Pour la page « Mon espace » : dates du compte et de la dernière sauvegarde du CV.
    with _base() as b:
        cree_le, vu_le = b.execute("SELECT cree_le, vu_le FROM comptes WHERE id = ?", (compte[0],)).fetchone()
        sauvegarde = b.execute("SELECT MAX(modifie_le) FROM documents WHERE compte_id = ?", (compte[0],)).fetchone()
    return jsonify(connecte=True, email=compte[1], cree_le=cree_le, vu_le=vu_le,
                   modifie_le=sauvegarde[0] if sauvegarde else None)


def _cles_echec(email):
    """Compteurs d'échecs d'une tentative de mot de passe sur ce compte, depuis cette adresse IP."""
    ip = request.remote_addr
    return (("paire", (ip, email)), ("ip", ip), ("email", email))


@comptes.post("/inscription")
def inscription():
    """Inscription en deux temps : ici on envoie un lien à l'adresse indiquée ; c'est en
    l'ouvrant qu'on choisit son mot de passe et que le compte est créé (/nouveau-mot-de-passe).
    La réponse est la même que l'adresse ait déjà un compte ou non."""
    return _envoyer_un_lien("inscription")


@comptes.post("/connexion")
def connexion():
    email, mdp = _identifiants()
    cles = _cles_echec(email)
    if _bloque(*cles):
        return jsonify(erreur="Trop de tentatives. Réessaie dans un quart d'heure, "
                              "ou choisis un nouveau mot de passe avec « Mot de passe oublié »."), 429
    with _base() as b:
        ligne = b.execute("SELECT id, empreinte, jeton FROM comptes WHERE email = ?", (email,)).fetchone()
    correct = check_password_hash(ligne[1] if ligne else _EMPREINTE_BIDON, mdp[:MDP_MAX])
    if not ligne or not correct:
        # Même message dans les deux cas : on ne dit pas si l'adresse a un compte.
        _noter(*cles)
        return jsonify(erreur="Adresse e-mail ou mot de passe incorrect. Si tu viens de t'inscrire, "
                              "ouvre d'abord le lien reçu par e-mail pour choisir ton mot de passe."), 401
    _oublier(cles[0])                # les échecs de CETTE adresse IP sur ce compte sont effacés
    with _base() as b:
        b.execute("UPDATE comptes SET vu_le = ? WHERE id = ?", (int(time.time()), ligne[0]))
    _ouvrir_session(ligne[0], ligne[2])
    return jsonify(connecte=True, email=email)


@comptes.post("/mot-de-passe")
def changer_mot_de_passe():
    """Change le mot de passe (l'ancien est redemandé) et déconnecte les autres appareils."""
    compte = compte_connecte()
    if not compte:
        return _non_connecte()
    cles = _cles_echec(compte[1])
    if _bloque(*cles):
        return jsonify(erreur="Trop de tentatives. Réessaie dans un quart d'heure."), 429
    corps = _corps()
    ancien, nouveau = corps.get("ancien"), corps.get("nouveau")
    with _base() as b:
        ligne = b.execute("SELECT empreinte FROM comptes WHERE id = ?", (compte[0],)).fetchone()
    if not ligne or not isinstance(ancien, str) or not check_password_hash(ligne[0], ancien[:MDP_MAX]):
        _noter(*cles)
        return jsonify(erreur="Mot de passe actuel incorrect."), 401
    if not isinstance(nouveau, str) or not MDP_MIN <= len(nouveau) <= MDP_MAX:
        return jsonify(erreur=f"Le nouveau mot de passe doit contenir au moins {MDP_MIN} caractères."), 400
    if nouveau.lower() in (compte[1], compte[1].split("@")[0]):
        return jsonify(erreur="Choisis un mot de passe différent de ton adresse e-mail."), 400
    if nouveau == ancien:
        return jsonify(erreur="Le nouveau mot de passe doit être différent de l'ancien."), 400
    # Nouveau jeton : les sessions ouvertes sur d'autres appareils cessent d'être valables.
    jeton = secrets.token_hex(16)
    with _base() as b:
        b.execute("UPDATE comptes SET empreinte = ?, jeton = ? WHERE id = ?",
                  (generate_password_hash(nouveau), jeton, compte[0]))
    _ouvrir_session(compte[0], jeton)       # cet appareil-ci reste connecté
    return jsonify(connecte=True)


# --------------------------------------------------------------------------
# Liens envoyés par e-mail : inscription et mot de passe oublié
# --------------------------------------------------------------------------
# Trois messages possibles, dans la langue du site :
#   - « invitation » : l'adresse n'a pas de compte -> lien pour choisir son mot de passe et créer le compte ;
#   - « deja »       : on demande à s'inscrire avec une adresse qui a déjà un compte -> on le dit
#                      à son titulaire (et à lui seul), avec un lien pour changer de mot de passe ;
#   - « oubli »      : mot de passe oublié -> lien pour en choisir un nouveau.
_TEXTES = {
    "invitation": {
        "fr": ("CV.express : confirme ton adresse",
               "Bonjour,\n\nPour créer ton compte CV.express, ouvre ce lien et choisis ton mot de passe "
               "(valable {duree}, utilisable une seule fois) :\n\n{lien}\n\n"
               "Si tu n'as pas demandé à créer de compte, ignore ce message : aucun compte ne sera créé.\n\nCV.express\n"),
        "en": ("CV.express: confirm your address",
               "Hello,\n\nTo create your CV.express account, open this link and choose your password "
               "(valid for {duree}, usable only once):\n\n{lien}\n\n"
               "If you did not ask to create an account, ignore this message: no account will be created.\n\nCV.express\n"),
        "it": ("CV.express: conferma il tuo indirizzo",
               "Ciao,\n\nPer creare il tuo account CV.express, apri questo link e scegli la tua password "
               "(valido {duree}, utilizzabile una sola volta):\n\n{lien}\n\n"
               "Se non hai chiesto di creare un account, ignora questo messaggio: nessun account verrà creato.\n\nCV.express\n"),
    },
    "deja": {
        "fr": ("CV.express : tu as déjà un compte",
               "Bonjour,\n\nQuelqu'un (sans doute toi) a demandé à créer un compte CV.express avec cette adresse. "
               "Tu as déjà un compte : connecte-toi simplement avec ton mot de passe.\n\n"
               "Si tu l'as oublié, ce lien te permet d'en choisir un nouveau (valable {duree}, utilisable une seule fois) :\n\n{lien}\n\n"
               "Si tu n'es pas à l'origine de cette demande, ignore ce message : rien ne change.\n\nCV.express\n"),
        "en": ("CV.express: you already have an account",
               "Hello,\n\nSomeone (probably you) asked to create a CV.express account with this address. "
               "You already have an account: just log in with your password.\n\n"
               "If you have forgotten it, this link lets you choose a new one (valid for {duree}, usable only once):\n\n{lien}\n\n"
               "If you did not make this request, ignore this message: nothing changes.\n\nCV.express\n"),
        "it": ("CV.express: hai già un account",
               "Ciao,\n\nQualcuno (probabilmente tu) ha chiesto di creare un account CV.express con questo indirizzo. "
               "Hai già un account: accedi semplicemente con la tua password.\n\n"
               "Se l'hai dimenticata, questo link ti permette di sceglierne una nuova (valido {duree}, utilizzabile una sola volta):\n\n{lien}\n\n"
               "Se non hai fatto tu questa richiesta, ignora questo messaggio: non cambia nulla.\n\nCV.express\n"),
    },
    "oubli": {
        "fr": ("CV.express : choisis un nouveau mot de passe",
               "Bonjour,\n\nTu as demandé à changer le mot de passe de ton compte CV.express.\n"
               "Ouvre ce lien pour en choisir un nouveau (valable {duree}, utilisable une seule fois) :\n\n{lien}\n\n"
               "Si tu n'es pas à l'origine de cette demande, ignore ce message : ton mot de passe ne change pas.\n\nCV.express\n"),
        "en": ("CV.express: choose a new password",
               "Hello,\n\nYou asked to change the password of your CV.express account.\n"
               "Open this link to choose a new one (valid for {duree}, usable only once):\n\n{lien}\n\n"
               "If you did not make this request, ignore this message: your password does not change.\n\nCV.express\n"),
        "it": ("CV.express: scegli una nuova password",
               "Ciao,\n\nHai chiesto di cambiare la password del tuo account CV.express.\n"
               "Apri questo link per sceglierne una nuova (valido {duree}, utilizzabile una sola volta):\n\n{lien}\n\n"
               "Se non hai fatto tu questa richiesta, ignora questo messaggio: la tua password non cambia.\n\nCV.express\n"),
    },
}
_DUREES = {"fr": ("{} minutes", "{} heures"), "en": ("{} minutes", "{} hours"), "it": ("{} minuti", "{} ore")}


def _empreinte_jeton(jeton):
    return hashlib.sha256(jeton.encode("utf-8")).hexdigest()


def _envoyer_lien(email, genre, langue, lien, journal):
    """Envoie l'e-mail (dans un fil à part : la réponse au visiteur ne dépend pas de sa durée)."""
    sujet, corps = _TEXTES[genre][langue]
    minutes, heures = _DUREES[langue]
    duree = heures.format(INVITATION_HEURES) if genre == "invitation" else minutes.format(LIEN_MINUTES)
    texte = corps.format(lien=lien, duree=duree)
    if BREVO_CLE_API:
        _envoyer_par_brevo(email, sujet, texte, genre, journal)
        return
    if not SMTP_HOTE:
        journal.warning("SMTP non configuré : e-mail non envoyé (%s). Lien : %s", genre, lien)
        return
    message = EmailMessage()
    message["Subject"], message["From"], message["To"] = sujet, EMAIL_EXPEDITEUR, email
    message.set_content(texte)
    try:
        if SMTP_PORT == 465:
            serveur = smtplib.SMTP_SSL(SMTP_HOTE, SMTP_PORT, timeout=20)
        else:
            serveur = smtplib.SMTP(SMTP_HOTE, SMTP_PORT, timeout=20)
            serveur.starttls()                      # connexion chiffrée obligatoire
        with serveur:
            if SMTP_UTILISATEUR:
                serveur.login(SMTP_UTILISATEUR, SMTP_MOT_DE_PASSE)
            serveur.send_message(message)
    except (OSError, smtplib.SMTPException) as e:
        journal.error("Envoi d'un e-mail (%s) impossible : %s", genre, type(e).__name__)


BREVO_ADRESSE = "https://api.brevo.com/v3/smtp/email"


def _envoyer_par_brevo(email, sujet, texte, genre, journal):
    """Envoi par l'API web de Brevo (HTTPS) : fonctionne là où le SMTP est bloqué.
    EMAIL_EXPEDITEUR doit être une adresse validée dans le compte Brevo."""
    nom, adresse = parseaddr(EMAIL_EXPEDITEUR)
    expediteur = {"email": adresse, **({"name": nom} if nom else {})}
    donnees = json.dumps({"sender": expediteur, "to": [{"email": email}],
                          "subject": sujet, "textContent": texte}).encode("utf-8")
    demande = urllib.request.Request(BREVO_ADRESSE, data=donnees, method="POST", headers={
        "api-key": BREVO_CLE_API, "content-type": "application/json", "accept": "application/json"})
    try:
        with urllib.request.urlopen(demande, timeout=20) as reponse:
            reponse.read()
    except OSError as e:               # HTTPError et URLError en font partie
        # Le code de Brevo (401 : clé fausse, 400 : expéditeur non validé…), jamais l'adresse visée.
        journal.error("Envoi d'un e-mail (%s) par Brevo impossible : %s %s", genre, type(e).__name__,
                      getattr(e, "code", ""))


def _envoyer_un_lien(demande):
    """Inscription ou mot de passe oublié. La réponse est TOUJOURS la même, que l'adresse
    ait un compte ou non, et le travail fait est le même (un jeton, une écriture en base,
    un e-mail) : ni le message ni la durée de la réponse ne révèlent qui est inscrit."""
    corps = _corps()
    email = corps.get("email")
    email = email.strip().lower()[:120] if isinstance(email, str) else ""
    langue = corps.get("langue") if corps.get("langue") in _DUREES else "fr"
    cles = (("lien_ip", request.remote_addr), ("lien_email", email))
    if _bloque(*cles):
        return jsonify(erreur="Trop de demandes. Réessaie dans un quart d'heure."), 429
    if not _EMAIL_OK.match(email):
        return jsonify(erreur="Adresse e-mail invalide."), 400
    _noter(*cles)
    jeton = secrets.token_urlsafe(32)
    maintenant = int(time.time())
    with _base() as b:
        ligne = b.execute("SELECT id FROM comptes WHERE email = ?", (email,)).fetchone()
        if ligne:
            # Adresse déjà inscrite : un lien pour changer de mot de passe, envoyé à elle seule.
            genre = "oubli" if demande == "oubli" else "deja"
            b.execute("""INSERT INTO reinitialisations (compte_id, empreinte, expire_le) VALUES (?, ?, ?)
                         ON CONFLICT(compte_id) DO UPDATE SET empreinte = excluded.empreinte,
                                                              expire_le = excluded.expire_le""",
                      (ligne[0], _empreinte_jeton(jeton), maintenant + LIEN_MINUTES * 60))
        elif demande == "inscription":
            genre = "invitation"
            b.execute("""INSERT INTO invitations (email, empreinte, expire_le) VALUES (?, ?, ?)
                         ON CONFLICT(email) DO UPDATE SET empreinte = excluded.empreinte,
                                                          expire_le = excluded.expire_le""",
                      (email, _empreinte_jeton(jeton), maintenant + INVITATION_HEURES * 3600))
        else:
            # Mot de passe oublié pour une adresse inconnue : aucun e-mail, mais une écriture
            # équivalente, pour que la durée de la réponse soit la même.
            genre = None
            b.execute("DELETE FROM invitations WHERE expire_le < ?", (maintenant,))
    if genre:
        prefixe = {"en": "/en", "it": "/it"}.get(langue, "")
        lien = f"{racine_site()}{prefixe}/compte?jeton={jeton}"
        threading.Thread(target=_envoyer_lien, args=(email, genre, langue, lien, current_app.logger),
                         daemon=True).start()
    return jsonify(envoye=True), 202 if demande == "inscription" else 200


@comptes.post("/mot-de-passe-oublie")
def mot_de_passe_oublie():
    return _envoyer_un_lien("oubli")


@comptes.post("/nouveau-mot-de-passe")
def nouveau_mot_de_passe():
    """Deuxième étape, commune à l'inscription et au mot de passe oublié : le jeton reçu
    par e-mail + le mot de passe choisi. Le lien prouve que la personne lit cette adresse."""
    corps = _corps()
    jeton, nouveau = corps.get("jeton"), corps.get("mot_de_passe")
    limite = ("jeton_ip", request.remote_addr)
    if _bloque(limite):
        return jsonify(erreur="Trop de tentatives. Réessaie dans un quart d'heure."), 429
    invalide = jsonify(erreur="Ce lien n'est plus valable. Demande un nouveau lien."), 400
    if not isinstance(jeton, str) or not 20 <= len(jeton) <= 200:
        _noter(limite)
        return invalide
    empreinte, maintenant = _empreinte_jeton(jeton), int(time.time())
    with _base() as b:
        ligne = b.execute("""SELECT c.email FROM reinitialisations r JOIN comptes c ON c.id = r.compte_id
                             WHERE r.empreinte = ? AND r.expire_le >= ?""", (empreinte, maintenant)).fetchone()
        if not ligne:
            ligne = b.execute("SELECT email FROM invitations WHERE empreinte = ? AND expire_le >= ?",
                              (empreinte, maintenant)).fetchone()
    if not ligne:
        _noter(limite)
        return invalide
    email = ligne[0]
    if not isinstance(nouveau, str) or not MDP_MIN <= len(nouveau) <= MDP_MAX:
        return jsonify(erreur=f"Le mot de passe doit contenir au moins {MDP_MIN} caractères."), 400
    if nouveau.lower() in (email, email.split("@")[0]):
        return jsonify(erreur="Choisis un mot de passe différent de ton adresse e-mail."), 400
    session_jeton = secrets.token_hex(16)        # toutes les sessions ouvertes cessent d'être valables
    empreinte_mdp = generate_password_hash(nouveau)
    with _base() as b:
        # Le lien ne sert qu'une fois : il est supprimé dans la même opération que le changement.
        utilises = (b.execute("""DELETE FROM reinitialisations WHERE empreinte = ?
                                 AND compte_id = (SELECT id FROM comptes WHERE email = ?)""", (empreinte, email)).rowcount
                    + b.execute("DELETE FROM invitations WHERE empreinte = ? AND email = ?", (empreinte, email)).rowcount)
        if not utilises:
            return invalide
        compte = b.execute("SELECT id FROM comptes WHERE email = ?", (email,)).fetchone()
        if compte:
            b.execute("UPDATE comptes SET empreinte = ?, jeton = ?, vu_le = ? WHERE id = ?",
                      (empreinte_mdp, session_jeton, maintenant, compte[0]))
            cid, nouveau_compte = compte[0], False
        else:
            cid = b.execute("""INSERT INTO comptes (email, empreinte, jeton, cree_le, vu_le) VALUES (?, ?, ?, ?, ?)
                               RETURNING id""", (email, empreinte_mdp, session_jeton, maintenant, maintenant)).fetchone()[0]
            nouveau_compte = True
    _oublier(("email", email))                   # le titulaire a prouvé qui il est : plus de blocage global
    _ouvrir_session(cid, session_jeton)
    return jsonify(connecte=True, email=email, nouveau_compte=nouveau_compte)


@comptes.post("/deconnexion")
def deconnexion():
    session.clear()
    return jsonify(connecte=False)


# --------------------------------------------------------------------------
# Documents du compte. Toutes les requêtes portent « compte_id = celui de la session » :
# un compte ne peut ni lire, ni modifier, ni supprimer le document d'un autre.
# --------------------------------------------------------------------------
def _numero(valeur):
    """Numéro de document reçu dans l'adresse ou le corps : entier positif, sinon None."""
    try:
        numero = int(valeur)
    except (TypeError, ValueError):
        return None
    return numero if 0 < numero < 2 ** 62 else None


def _contenu(donnees):
    """dict -> texte JSON à enregistrer ; lève ValueError si invalide ou trop gros."""
    if not isinstance(donnees, dict) or requetes.trop_imbrique(donnees):
        raise ValueError("Données invalides.")
    contenu = json.dumps(donnees, ensure_ascii=False, separators=(",", ":"))
    if len(contenu.encode("utf-8")) > DONNEES_MAX:
        raise OverflowError("Données trop volumineuses pour être enregistrées dans ton compte.")
    return contenu


def _nom(valeur, defaut):
    nom = " ".join(_sans_nul(valeur).split())[:NOM_MAX] if isinstance(valeur, str) else ""
    return nom or defaut


def _creer(b, compte_id, nom, contenu):
    """Ajoute un document ; None si le compte en a déjà le maximum."""
    nombre = b.execute("SELECT COUNT(*) FROM documents WHERE compte_id = ?", (compte_id,)).fetchone()[0]
    if nombre >= DOCUMENTS_MAX:
        return None
    maintenant = int(time.time())
    numero = b.execute("""INSERT INTO documents (compte_id, nom, contenu, modifie_le, version) VALUES (?, ?, ?, ?, 1)
                          RETURNING id""", (compte_id, _nom(nom, f"Document {nombre + 1}"), contenu, maintenant)).fetchone()[0]
    return numero, maintenant


def _trop_de_documents():
    return jsonify(erreur=f"Tu as déjà {DOCUMENTS_MAX} documents dans ton compte. Supprimes-en un pour en ajouter."), 409


@comptes.get("/donnees")
def lire_donnees():
    """Un document : celui demandé (?doc=…), sinon le plus récemment modifié."""
    compte = compte_connecte()
    if not compte:
        return _non_connecte()
    demande = request.args.get("doc")
    with _base() as b:
        if demande is not None:
            ligne = b.execute("SELECT id, nom, contenu, modifie_le, version FROM documents WHERE id = ? AND compte_id = ?",
                              (_numero(demande), compte[0])).fetchone()
            if not ligne:
                return jsonify(erreur="Ce document n'existe pas ou n'existe plus."), 404
        else:
            ligne = b.execute("""SELECT id, nom, contenu, modifie_le, version FROM documents WHERE compte_id = ?
                                 ORDER BY modifie_le DESC, id DESC LIMIT 1""", (compte[0],)).fetchone()
    if not ligne:
        return jsonify(donnees=None, modifie_le=None, doc=None, version=None)
    return jsonify(doc=ligne[0], nom=ligne[1], donnees=json.loads(ligne[2]), modifie_le=ligne[3], version=ligne[4])


@comptes.put("/donnees")
def ecrire_donnees():
    """Enregistre un document : celui indiqué (?doc=…) ; sans numéro, le plus récent,
    ou un nouveau si le compte n'en a pas ou si « nouveau » est demandé.
    « version » : la version sur laquelle l'appareil a travaillé. Si le document a été
    enregistré entre-temps ailleurs, refus (409) : rien n'est écrasé, l'appareil décide."""
    compte = compte_connecte()
    if not compte:
        return _non_connecte()
    corps = _corps()
    try:
        contenu = _contenu(corps.get("donnees"))
    except OverflowError as e:
        return jsonify(erreur=str(e)), 413
    except ValueError as e:
        return jsonify(erreur=str(e)), 400
    demande = request.args.get("doc")
    maintenant = int(time.time())
    with _base() as b:
        if demande is not None:
            numero = _numero(demande)
        elif corps.get("nouveau") is True:
            numero = None
        else:
            ligne = b.execute("""SELECT id FROM documents WHERE compte_id = ?
                                 ORDER BY modifie_le DESC, id DESC LIMIT 1""", (compte[0],)).fetchone()
            numero = ligne[0] if ligne else None
        if numero is None and demande is None:
            cree = _creer(b, compte[0], corps.get("nom"), contenu)
            if cree is None:
                return _trop_de_documents()
            return jsonify(doc=cree[0], modifie_le=cree[1], version=1), 201
        attendue = corps.get("version")
        if attendue is None:          # appareil sans gestion des versions (ancienne page encore ouverte)
            modifies = b.execute("""UPDATE documents SET contenu = ?, modifie_le = ?, version = version + 1
                                    WHERE id = ? AND compte_id = ?""", (contenu, maintenant, numero, compte[0])).rowcount
        elif isinstance(attendue, int) and not isinstance(attendue, bool) and abs(attendue) < 2 ** 62:
            modifies = b.execute("""UPDATE documents SET contenu = ?, modifie_le = ?, version = version + 1
                                    WHERE id = ? AND compte_id = ? AND version = ?""",
                                 (contenu, maintenant, numero, compte[0], attendue)).rowcount
        else:
            return jsonify(erreur="Données invalides."), 400
        actuel = b.execute("SELECT version, modifie_le FROM documents WHERE id = ? AND compte_id = ?",
                           (numero, compte[0])).fetchone()
    if not actuel:
        return jsonify(erreur="Ce document n'existe pas ou n'existe plus."), 404
    if not modifies:
        return jsonify(erreur="Ce document a été modifié sur un autre appareil entre-temps.",
                       conflit=True, doc=numero, version=actuel[0], modifie_le=actuel[1]), 409
    return jsonify(doc=numero, modifie_le=actuel[1], version=actuel[0])


@comptes.get("/documents")
def lister_documents():
    """Tous les documents du compte, du plus récent au plus ancien. La photo, lourde,
    n'est pas renvoyée ici (seulement son existence) : elle l'est avec le document lui-même."""
    compte = compte_connecte()
    if not compte:
        return _non_connecte()
    with _base() as b:
        lignes = b.execute("""SELECT d.id, d.nom, d.contenu, d.modifie_le, d.version, p.code, p.vues
                              FROM documents d LEFT JOIN partages p ON p.doc_id = d.id
                              WHERE d.compte_id = ? ORDER BY d.modifie_le DESC, d.id DESC""", (compte[0],)).fetchall()
    documents = []
    for numero, nom, contenu, modifie_le, version, code, vues in lignes:
        donnees = json.loads(contenu)
        cv = donnees.get("cv")
        if isinstance(cv, dict) and cv.get("photo"):
            donnees["cv"] = {**cv, "photo": "", "a_une_photo": True}
        documents.append({"doc": numero, "nom": nom, "modifie_le": modifie_le, "version": version, "donnees": donnees,
                          "partage": _decrire_partage(code, vues)})
    return jsonify(documents=documents, maximum=DOCUMENTS_MAX)


@comptes.post("/documents")
def creer_document():
    """Nouveau document : vide, ou copie d'un document existant (« copie_de »)."""
    compte = compte_connecte()
    if not compte:
        return _non_connecte()
    corps = _corps()
    with _base() as b:
        contenu, nom = "{}", corps.get("nom")
        if corps.get("copie_de") is not None:
            source = b.execute("SELECT nom, contenu FROM documents WHERE id = ? AND compte_id = ?",
                               (_numero(corps.get("copie_de")), compte[0])).fetchone()
            if not source:
                return jsonify(erreur="Ce document n'existe pas ou n'existe plus."), 404
            contenu, nom = source[1], nom or f"{source[0]} (copie)"
        cree = _creer(b, compte[0], nom, contenu)
    if cree is None:
        return _trop_de_documents()
    return jsonify(doc=cree[0], modifie_le=cree[1], version=1), 201


@comptes.patch("/documents/<int:numero>")
def renommer_document(numero):
    compte = compte_connecte()
    if not compte:
        return _non_connecte()
    nom = _nom(_corps().get("nom"), "")
    if not nom:
        return jsonify(erreur="Donne un nom à ce document."), 400
    with _base() as b:
        modifies = b.execute("UPDATE documents SET nom = ? WHERE id = ? AND compte_id = ?",
                             (nom, _numero(numero), compte[0])).rowcount
    if not modifies:
        return jsonify(erreur="Ce document n'existe pas ou n'existe plus."), 404
    return jsonify(doc=numero, nom=nom)


@comptes.delete("/documents/<int:numero>")
def supprimer_document(numero):
    compte = compte_connecte()
    if not compte:
        return _non_connecte()
    with _base() as b:
        supprimes = b.execute("DELETE FROM documents WHERE id = ? AND compte_id = ?",
                              (_numero(numero), compte[0])).rowcount
    if not supprimes:
        return jsonify(erreur="Ce document n'existe pas ou n'existe plus."), 404
    return jsonify(supprime=numero)


# --------------------------------------------------------------------------
# Lien de partage d'un CV : une page publique /cv/<code>, à donner à un recruteur ou à
# imprimer en QR code sur le CV. Créé seulement quand le titulaire le demande ; le code
# est tiré au hasard (impossible à deviner) et le lien peut être désactivé à tout moment.
# --------------------------------------------------------------------------
_ALPHABET_CODE = "abcdefghijkmnpqrstuvwxyz23456789"     # sans 0/o, 1/l : lisible s'il est recopié à la main
CODE_LONGUEUR = 12
CODE_OK = re.compile(rf"^[{_ALPHABET_CODE}]{{{CODE_LONGUEUR}}}$")


def _decrire_partage(code, vues):
    if not code:
        return None
    return {"code": code, "url": f"{racine_site()}/cv/{code}", "vues": vues}


def partage_existe(code):
    if not isinstance(code, str) or not CODE_OK.match(code):
        return False
    with _base() as b:
        return b.execute("SELECT 1 FROM partages WHERE code = ?", (code,)).fetchone() is not None


def document_partage(code, compter=False):
    """Données (dict) du document partagé sous ce code, ou None. compter : une visite de plus."""
    if not isinstance(code, str) or not CODE_OK.match(code):
        return None
    with _base() as b:
        ligne = b.execute("""SELECT d.contenu FROM partages p JOIN documents d ON d.id = p.doc_id
                             WHERE p.code = ?""", (code,)).fetchone()
        if ligne and compter:
            b.execute("UPDATE partages SET vues = vues + 1 WHERE code = ?", (code,))
    return json.loads(ligne[0]) if ligne else None


@comptes.get("/documents/<int:numero>/partage")
def lire_partage(numero):
    compte = compte_connecte()
    if not compte:
        return _non_connecte()
    with _base() as b:
        if not b.execute("SELECT 1 FROM documents WHERE id = ? AND compte_id = ?", (_numero(numero), compte[0])).fetchone():
            return jsonify(erreur="Ce document n'existe pas ou n'existe plus."), 404
        ligne = b.execute("SELECT code, vues FROM partages WHERE doc_id = ? AND compte_id = ?",
                          (_numero(numero), compte[0])).fetchone()
    return jsonify(partage=_decrire_partage(*ligne) if ligne else None)


@comptes.post("/documents/<int:numero>/partage")
def creer_partage(numero):
    """Active le lien public du document (ou renvoie celui qui existe déjà)."""
    compte = compte_connecte()
    if not compte:
        return _non_connecte()
    with _base() as b:
        if not b.execute("SELECT 1 FROM documents WHERE id = ? AND compte_id = ?", (_numero(numero), compte[0])).fetchone():
            return jsonify(erreur="Ce document n'existe pas ou n'existe plus."), 404
        ligne = b.execute("SELECT code, vues FROM partages WHERE doc_id = ?", (_numero(numero),)).fetchone()
        if not ligne:
            code = "".join(secrets.choice(_ALPHABET_CODE) for _ in range(CODE_LONGUEUR))
            b.execute("INSERT INTO partages (code, doc_id, compte_id, cree_le, vues) VALUES (?, ?, ?, ?, 0)",
                      (code, _numero(numero), compte[0], int(time.time())))
            ligne = (code, 0)
    return jsonify(partage=_decrire_partage(*ligne)), 201


@comptes.delete("/documents/<int:numero>/partage")
def supprimer_partage(numero):
    """Désactive le lien : la page publique et le QR code cessent aussitôt de fonctionner."""
    compte = compte_connecte()
    if not compte:
        return _non_connecte()
    with _base() as b:
        b.execute("DELETE FROM partages WHERE doc_id = ? AND compte_id = ?", (_numero(numero), compte[0]))
    return jsonify(partage=None)


# --------------------------------------------------------------------------
# Suivi des candidatures : entreprise, poste, date d'envoi, document envoyé, statut,
# date de relance. Comme les documents, chaque requête porte « compte_id = la session ».
# --------------------------------------------------------------------------
CANDIDATURES_MAX = 300
STATUTS = ("a_envoyer", "envoyee", "relancee", "entretien", "acceptee", "refusee")
_DATE_OK = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_COLONNES_CANDIDATURE = ("id", "doc_id", "entreprise", "poste", "statut", "envoye_le", "relance_le", "lien", "notes", "modifie_le")


def _candidature(b, compte_id, corps):
    """Champs d'une candidature lus et vérifiés ; lève ValueError (message pour le visiteur)."""
    texte = lambda cle, maxi: " ".join(_sans_nul(corps[cle]).split())[:maxi] if isinstance(corps.get(cle), str) else ""
    champs = {"entreprise": texte("entreprise", 120), "poste": texte("poste", 160), "lien": texte("lien", 400)}
    notes = corps.get("notes")
    champs["notes"] = _sans_nul(notes).strip()[:2000] if isinstance(notes, str) else ""
    if not champs["entreprise"] and not champs["poste"]:
        raise ValueError("Indique au moins l'entreprise ou le poste.")
    if champs["lien"] and not re.match(r"^https?://", champs["lien"], re.I):
        champs["lien"] = "https://" + champs["lien"]
    statut = corps.get("statut")
    champs["statut"] = statut if statut in STATUTS else "envoyee"
    for cle in ("envoye_le", "relance_le"):
        valeur = corps.get(cle) if isinstance(corps.get(cle), str) else ""
        if valeur and not _DATE_OK.match(valeur):
            raise ValueError("Date invalide.")
        champs[cle] = valeur
    doc = corps.get("doc_id")
    champs["doc_id"] = None
    if doc not in (None, ""):
        numero = _numero(doc)
        if numero is None or not b.execute("SELECT 1 FROM documents WHERE id = ? AND compte_id = ?",
                                           (numero, compte_id)).fetchone():
            raise ValueError("Ce document n'existe pas ou n'existe plus.")
        champs["doc_id"] = numero
    return champs


def _lire_candidature(ligne):
    return dict(zip(_COLONNES_CANDIDATURE, ligne))


@comptes.get("/candidatures")
def lister_candidatures():
    compte = compte_connecte()
    if not compte:
        return _non_connecte()
    with _base() as b:
        lignes = b.execute(f"""SELECT {', '.join(_COLONNES_CANDIDATURE)} FROM candidatures WHERE compte_id = ?
                               ORDER BY envoye_le DESC, id DESC""", (compte[0],)).fetchall()
    return jsonify(candidatures=[_lire_candidature(l) for l in lignes], statuts=STATUTS, maximum=CANDIDATURES_MAX)


@comptes.post("/candidatures")
def creer_candidature():
    compte = compte_connecte()
    if not compte:
        return _non_connecte()
    corps = _corps()
    with _base() as b:
        try:
            champs = _candidature(b, compte[0], corps)
        except ValueError as e:
            return jsonify(erreur=str(e)), 400
        if b.execute("SELECT COUNT(*) FROM candidatures WHERE compte_id = ?", (compte[0],)).fetchone()[0] >= CANDIDATURES_MAX:
            return jsonify(erreur=f"Tu suis déjà {CANDIDATURES_MAX} candidatures. Supprimes-en pour en ajouter."), 409
        colonnes = list(champs)
        ligne = b.execute(f"""INSERT INTO candidatures (compte_id, {', '.join(colonnes)}, modifie_le)
                              VALUES (?, {', '.join('?' * len(colonnes))}, ?)
                              RETURNING {', '.join(_COLONNES_CANDIDATURE)}""",
                          (compte[0], *champs.values(), int(time.time()))).fetchone()
    return jsonify(candidature=_lire_candidature(ligne)), 201


@comptes.put("/candidatures/<int:numero>")
def modifier_candidature(numero):
    compte = compte_connecte()
    if not compte:
        return _non_connecte()
    corps = _corps()
    with _base() as b:
        try:
            champs = _candidature(b, compte[0], corps)
        except ValueError as e:
            return jsonify(erreur=str(e)), 400
        ligne = b.execute(f"""UPDATE candidatures SET {', '.join(c + ' = ?' for c in champs)}, modifie_le = ?
                              WHERE id = ? AND compte_id = ? RETURNING {', '.join(_COLONNES_CANDIDATURE)}""",
                          (*champs.values(), int(time.time()), _numero(numero), compte[0])).fetchone()
    if not ligne:
        return jsonify(erreur="Cette candidature n'existe pas ou n'existe plus."), 404
    return jsonify(candidature=_lire_candidature(ligne))


@comptes.delete("/candidatures/<int:numero>")
def supprimer_candidature(numero):
    compte = compte_connecte()
    if not compte:
        return _non_connecte()
    with _base() as b:
        supprimes = b.execute("DELETE FROM candidatures WHERE id = ? AND compte_id = ?",
                              (_numero(numero), compte[0])).rowcount
    if not supprimes:
        return jsonify(erreur="Cette candidature n'existe pas ou n'existe plus."), 404
    return jsonify(supprime=numero)


@comptes.delete("")
def supprimer():
    """Supprime le compte ET tous ses documents. Le mot de passe est redemandé."""
    compte = compte_connecte()
    if not compte:
        return _non_connecte()
    cles = _cles_echec(compte[1])
    if _bloque(*cles):
        return jsonify(erreur="Trop de tentatives. Réessaie dans un quart d'heure."), 429
    mdp = _corps().get("mot_de_passe")
    with _base() as b:
        ligne = b.execute("SELECT empreinte FROM comptes WHERE id = ?", (compte[0],)).fetchone()
    if not ligne or not isinstance(mdp, str) or not check_password_hash(ligne[0], mdp[:MDP_MAX]):
        _noter(*cles)
        return jsonify(erreur="Mot de passe incorrect."), 401
    with _base() as b:
        b.execute("DELETE FROM comptes WHERE id = ?", (compte[0],))   # les documents suivent (CASCADE)
    _oublier(*cles[::2])             # échecs de ce compte (paire et global), pas ceux de l'adresse IP
    session.clear()
    current_app.logger.info("Compte supprimé.")       # sans l'adresse : rien de personnel dans les journaux
    return jsonify(connecte=False)


if __name__ == "__main__":
    # python -m comptes sauvegarder        : une copie de la base, tout de suite (fichier SQLite
    #                                        dans donnees/sauvegardes/, même pour PostgreSQL) ;
    # python -m comptes restaurer FICHIER   : remet une copie dans la base PostgreSQL (vide).
    import sys
    arguments = sys.argv[1:]
    if arguments == ["sauvegarder"]:
        print(sauvegarder_base())
    elif len(arguments) == 2 and arguments[0] == "restaurer":
        try:
            print(restaurer_base(arguments[1]))
        except RuntimeError as e:
            sys.exit(str(e))
    else:
        sys.exit("Utilisation : python -m comptes sauvegarder | python -m comptes restaurer FICHIER")
