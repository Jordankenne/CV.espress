"""
Fabrique les miniatures des modèles affichées sur le site (web/img/modele_<nom>.png).

À relancer après avoir modifié ou ajouté un modèle :   .venv/bin/python miniatures.py
Seulement refaire les versions WebP des images déjà là : .venv/bin/python miniatures.py webp
Prérequis : pdftoppm (paquet poppler-utils) et, pour le WebP, ImageMagick (commande convert).

Chaque image existe en trois versions :
  nom.png        : pour les aperçus de liens (WhatsApp, Facebook…), qui préfèrent le PNG ;
  nom.webp       : la même, 3 à 4 fois plus légère, affichée sur le site ;
  nom-petit.webp : 240 px de large, pour les vignettes (sommaire de l'accueil, choix du modèle).
"""
import base64
import json
import struct
import subprocess
import tempfile
import zlib
from pathlib import Path

import moteur

RACINE = Path(__file__).parent
IMAGES = RACINE / "web" / "img"
# Une couleur par modèle : la galerie est plus parlante.
COULEURS = {"moderne": "1E5F4B", "classique": "1F4E79", "europeen": "5B3A8C", "africain": "7A1F1F",
            "elegant": "7A5C2E", "compact": "0F6E7A", "minimal": "2F3E46", "creatif": "C2410C"}


def avatar(cote=360):
    """Photo fictive (silhouette) dessinée pixel par pixel, pour ne mettre la photo
    de personne dans les exemples. Renvoie un PNG sous forme de data-URL."""
    fond, corps = (226, 221, 212), (146, 138, 128)
    lignes = bytearray()
    for y in range(cote):
        lignes.append(0)  # chaque ligne PNG commence par l'octet « filtre »
        for x in range(cote):
            u, v = x / cote - 0.5, y / cote
            tete = u * u + (v - 0.40) ** 2 < 0.17 ** 2
            epaules = (u / 0.40) ** 2 + ((v - 1.08) / 0.46) ** 2 < 1
            lignes.extend(corps if tete or epaules else fond)

    def bloc(type_, donnees):
        return (struct.pack(">I", len(donnees)) + type_ + donnees
                + struct.pack(">I", zlib.crc32(type_ + donnees)))

    png = (b"\x89PNG\r\n\x1a\n"
           + bloc(b"IHDR", struct.pack(">IIBBBBB", cote, cote, 8, 2, 0, 0, 0))
           + bloc(b"IDAT", zlib.compress(bytes(lignes), 9))
           + bloc(b"IEND", b""))
    return "data:image/png;base64," + base64.b64encode(png).decode()


COULEURS_LETTRE = {"moderne": "1E5F4B", "classique": "1F4E79", "epure": "7A1F1F", "elegante": "7A5C2E"}


def enregistrer(pdf, cible):
    """Première page du PDF -> image PNG de 480 px de large."""
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "doc.pdf"
        source.write_bytes(pdf)
        subprocess.run(["pdftoppm", "-png", "-singlefile", "-f", "1", "-l", "1",
                        "-scale-to-x", "480", "-scale-to-y", "-1", str(source), str(cible)],
                       check=True)
    print(f"OK -> {cible}.png")
    en_webp(Path(f"{cible}.png"))


def en_webp(png):
    """nom.png -> nom.webp (même taille) et nom-petit.webp (240 px de large)."""
    base = str(png.with_suffix(""))
    subprocess.run(["convert", str(png), "-strip", "-quality", "86", "-define", "webp:method=6",
                    f"{base}.webp"], check=True)
    subprocess.run(["convert", str(png), "-strip", "-resize", "240x", "-quality", "82",
                    "-define", "webp:method=6", f"{base}-petit.webp"], check=True)


def main():
    cv = json.loads((RACINE / "web" / "exemple.json").read_text(encoding="utf-8"))
    lettre = json.loads((RACINE / "web" / "exemple_lettre.json").read_text(encoding="utf-8"))
    cv["photo"] = avatar()
    IMAGES.mkdir(exist_ok=True)
    for modele in moteur.MODELES_CV:
        pdf = moteur.generer_cv(cv, {"modele": modele, "couleur": COULEURS.get(modele, ""),
                                     "certifier": modele == "africain"})
        enregistrer(pdf, IMAGES / f"modele_{modele}")
    for modele in moteur.MODELES_LETTRE:
        pdf = moteur.generer_lettre(cv, lettre, {"modele_lettre": modele,
                                                 "couleur": COULEURS_LETTRE.get(modele, "")})
        enregistrer(pdf, IMAGES / f"lettre_{modele}")


if __name__ == "__main__":
    import sys
    if sys.argv[1:] == ["webp"]:
        for png in sorted(IMAGES.glob("*.png")):
            if not png.name.startswith("icone-"):
                en_webp(png)
                print(f"OK -> {png.stem}.webp")
    else:
        main()
        for png in sorted(IMAGES.glob("exemple_*.png")):
            en_webp(png)
