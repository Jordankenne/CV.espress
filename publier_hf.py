"""
Publie le site sur Hugging Face Spaces (hébergement Docker gratuit).

Seuls les fichiers suivis par Git ET copiés dans l'image (voir le Dockerfile) sont envoyés :
jamais donnees/, production.env, les tests ni tes fichiers personnels. Attention : un Space
public montre ces fichiers (le code du site) à tout le monde ; les secrets, eux, restent cachés.

Utilisation :
  1. huggingface.co/settings/tokens : créer un jeton de type « Write » ;
  2. .venv/bin/pip install huggingface_hub
  3. HF_TOKEN=hf_… .venv/bin/python publier_hf.py TON_NOM/cv-express production.env

production.env (facultatif, jamais envoyé tel quel, ignoré par Git) : lignes NOM=valeur
(DATABASE_URL, BREVO_CLE_API, EMAIL_EXPEDITEUR, CLE_SECRETE…), enregistrées comme secrets du
Space. ADRESSE_SITE et DERRIERE_PROXY sont réglés automatiquement.
Sans argument après le nom : envoie seulement le code (les secrets déjà en place restent).
Avec --essai : affiche ce qui serait envoyé, sans rien envoyer.
"""
import re
import subprocess
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent
# Réglages propres à la petite machine de Render : inutiles ici (2 processeurs, 16 Go).
IGNORES = {"COMPILATIONS_SIMULTANEES", "DUREE_COMPILATION_MAX", "DELAI_SERVEUR", "MEMOIRE_PROCESSUS_MO", "PORT"}

PRESENTATION = """---
title: CV.express
emoji: 📄
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 8000
pinned: false
short_description: CV et lettres de motivation en PDF (FR, EN, IT)
---

# CV.express

Générateur de CV et de lettres de motivation en PDF, en français, anglais et italien.
"""


def fichiers_a_envoyer():
    """Fichiers suivis par Git que le Dockerfile copie dans l'image, plus le Dockerfile."""
    dockerfile = (RACINE / "Dockerfile").read_text(encoding="utf-8")
    copies = set()
    for ligne in dockerfile.splitlines():
        if ligne.startswith("COPY "):
            copies.update(ligne.split()[1:-1])            # COPY a b c ./  ->  a b c
    suivis = subprocess.run(["git", "ls-files", "-z"], cwd=RACINE, check=True,
                            capture_output=True).stdout.decode().split("\0")
    choisis = [f for f in suivis if f and (f == "Dockerfile" or f in copies
                                           or f.split("/")[0] in copies)]
    manquants = copies - {f.split("/")[0] for f in choisis} - {f for f in choisis}
    if manquants:
        sys.exit(f"Fichiers copiés par le Dockerfile mais pas suivis par Git : {', '.join(sorted(manquants))}")
    return sorted(choisis)


def lire_secrets(chemin):
    secrets = {}
    for ligne in Path(chemin).read_text(encoding="utf-8").splitlines():
        ligne = ligne.strip()
        if not ligne or ligne.startswith("#") or "=" not in ligne:
            continue
        nom, valeur = ligne.split("=", 1)
        nom, valeur = nom.strip(), valeur.strip()
        if not re.fullmatch(r"[A-Z_][A-Z0-9_]*", nom):
            sys.exit(f"Nom de réglage invalide dans {chemin} : {nom!r}")
        if nom not in IGNORES:
            secrets[nom] = valeur
    return secrets


def adresse_du_space(depot):
    """TON_NOM/cv-express -> https://ton-nom-cv-express.hf.space"""
    return "https://" + re.sub(r"[^a-z0-9]+", "-", depot.lower()).strip("-") + ".hf.space"


def main():
    arguments = [a for a in sys.argv[1:] if a != "--essai"]
    essai = "--essai" in sys.argv
    if not 1 <= len(arguments) <= 2 or arguments[0].count("/") != 1:
        sys.exit(__doc__)
    depot = arguments[0]
    fichiers = fichiers_a_envoyer()
    secrets = lire_secrets(arguments[1]) if len(arguments) == 2 else {}
    adresse = adresse_du_space(depot)
    if secrets:
        secrets.update(ADRESSE_SITE=adresse, DERRIERE_PROXY="1")
    print(f"Space : {depot}  ->  {adresse}")
    print(f"{len(fichiers)} fichiers + README.md (présentation du Space)")
    if secrets:
        print("Secrets :", ", ".join(sorted(secrets)))
    if essai:
        print("\n".join(fichiers))
        return

    from huggingface_hub import CommitOperationAdd, HfApi
    api = HfApi()                                  # jeton : HF_TOKEN ou « hf auth login »
    api.create_repo(depot, repo_type="space", space_sdk="docker", exist_ok=True)
    for nom, valeur in secrets.items():
        api.add_space_secret(depot, nom, valeur)
    operations = [CommitOperationAdd(path_in_repo=f, path_or_fileobj=str(RACINE / f)) for f in fichiers]
    operations.append(CommitOperationAdd(path_in_repo="README.md", path_or_fileobj=PRESENTATION.encode("utf-8")))
    version = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=RACINE,
                             capture_output=True, text=True).stdout.strip()
    api.create_commit(depot, operations=operations, repo_type="space",
                      commit_message=f"Publication du site ({version or 'local'})")
    print(f"\nEnvoyé. Construction en cours (10 à 20 minutes la première fois) :\n"
          f"  journal : https://huggingface.co/spaces/{depot}?logs=build\n"
          f"  site    : {adresse}")


if __name__ == "__main__":
    main()
