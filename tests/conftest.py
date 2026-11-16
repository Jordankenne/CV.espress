"""
Préparation commune des tests.

Lancer :  .venv/bin/python -m pytest          (depuis la racine du projet)

Les tests utilisent une base de données jetable et n'envoient aucun e-mail : les liens
« envoyés » sont récupérés dans la liste `liens` (voir la fixture du même nom).
"""
import os
import sys
import tempfile
from pathlib import Path

import pytest

# À faire AVANT d'importer l'application : elle lit ces réglages à l'import.
os.environ["DOSSIER_DONNEES"] = tempfile.mkdtemp(prefix="cv-tests-")
for variable in ("DERRIERE_PROXY", "ADRESSE_SITE", "SMTP_HOTE", "BREVO_CLE_API", "CLE_SECRETE", "DATABASE_URL"):
    os.environ.pop(variable, None)
# Pour lancer les mêmes tests sur PostgreSQL (base JETABLE : elle est vidée à chaque test) :
#   CV_TESTS_POSTGRES=postgresql://… .venv/bin/python -m pytest tests
if os.environ.get("CV_TESTS_POSTGRES"):
    os.environ["DATABASE_URL"] = os.environ["CV_TESTS_POSTGRES"]
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app as application  # noqa: E402
import comptes  # noqa: E402


class _FilImmediat:
    """Remplace threading.Thread dans les tests : l'envoi d'e-mail se fait tout de suite."""

    def __init__(self, target, args=(), daemon=None):
        self.cible, self.arguments = target, args

    def start(self):
        self.cible(*self.arguments)


@pytest.fixture(autouse=True)
def etat_propre(monkeypatch):
    """Chaque test repart d'une base vide et de compteurs d'échecs à zéro."""
    import statistiques
    statistiques._en_attente.clear()           # compteurs d'usage pas encore écrits en base
    with comptes._base() as b:
        for table in ("compteurs", "candidatures", "partages", "documents", "reinitialisations", "invitations", "comptes"):
            b.execute(f"DELETE FROM {table}")
    comptes._echecs.clear()
    application._appels.clear()
    yield


@pytest.fixture
def liens(monkeypatch):
    """Liste des e-mails « envoyés » pendant le test : (adresse, genre, langue, lien)."""
    envoyes = []
    monkeypatch.setattr(comptes, "_envoyer_lien",
                        lambda email, genre, langue, lien, journal: envoyes.append((email, genre, langue, lien)))
    monkeypatch.setattr(comptes.threading, "Thread", _FilImmediat)
    return envoyes


@pytest.fixture
def client():
    return application.app.test_client()


@pytest.fixture
def nouveau_client():
    """Fabrique de navigateurs indépendants (chacun avec ses propres cookies)."""
    return application.app.test_client


def jeton_de(lien):
    return lien.split("jeton=")[1]


@pytest.fixture
def inscrire(liens):
    """Crée un compte comme un vrai visiteur : demande du lien, puis choix du mot de passe.
    Renvoie le client, connecté."""
    def _inscrire(email, mot_de_passe="Mot-de-passe-42", ip="10.0.0.1"):
        c = application.app.test_client()
        base = {"REMOTE_ADDR": ip}
        r = c.post("/api/compte/inscription", json={"email": email}, environ_base=base)
        assert r.status_code == 202, r.get_json()
        r = c.post("/api/compte/nouveau-mot-de-passe",
                   json={"jeton": jeton_de(liens[-1][3]), "mot_de_passe": mot_de_passe}, environ_base=base)
        assert r.status_code == 200, r.get_json()
        return c
    return _inscrire
