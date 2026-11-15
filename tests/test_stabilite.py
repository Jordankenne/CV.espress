"""Stabilité : JSON hostile, taille des documents, processus bridés, serveur occupé,
sauvegardes, et aucune modification écrasée entre deux appareils."""
import json
import os
import sqlite3
import stat
import threading
import time
from pathlib import Path

import pytest

import comptes
import moteur
import requetes

API = "/api/compte"
RACINE = Path(__file__).resolve().parent.parent
CV = json.loads((RACINE / "web" / "exemple.json").read_text(encoding="utf-8"))
LETTRE = json.loads((RACINE / "web" / "exemple_lettre.json").read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# JSON hostile : jamais d'erreur 500
# ---------------------------------------------------------------------------
TRES_IMBRIQUE = "[" * 100_000 + "]" * 100_000
CORPS_HOSTILES = [TRES_IMBRIQUE, '{"cv": ' * 50 + "1" + "}" * 50, '{"cv": {"nom": "x"', "pas du json", "\xff\xfe", "",
                  "[1, 2]", "null", '"texte"']


@pytest.mark.parametrize("chemin", ["/api/pdf", "/api/apercu", f"{API}/inscription", f"{API}/connexion",
                                    f"{API}/mot-de-passe-oublie", f"{API}/nouveau-mot-de-passe"])
@pytest.mark.parametrize("corps", CORPS_HOSTILES, ids=range(len(CORPS_HOSTILES)))
def test_json_hostile_jamais_d_erreur_500(client, chemin, corps):
    r = client.post(chemin, data=corps.encode("utf-8", "surrogateescape") if isinstance(corps, str) else corps,
                    content_type="application/json")
    assert r.status_code in (400, 401), r.status_code
    assert "erreur" in r.get_json()


def test_document_trop_imbrique_refuse_a_l_enregistrement(inscrire):
    c = inscrire("awa@exemple.org")
    imbrique = {"cv": {"nom": "Awa"}}
    for _ in range(30):
        imbrique = {"x": imbrique}
    r = c.put(f"{API}/donnees", data=json.dumps({"donnees": imbrique}), content_type="application/json")
    assert r.status_code == 400


def test_mesure_de_profondeur():
    assert requetes.profondeur('{"a": [1, {"b": 2}]}') == 3
    assert requetes.profondeur('{"a": "[[[[[[[[[[[[[[[[[[[[[[[[[[[["}') == 1     # crochets dans une chaîne
    assert requetes.profondeur('{"a": "\\"[[[["}') == 1                           # guillemet échappé
    assert requetes.trop_imbrique(json.loads("[" * 25 + "]" * 25))
    assert not requetes.trop_imbrique({"cv": {"experiences": [{"poste": "x"}]}})


# ---------------------------------------------------------------------------
# Taille des documents
# ---------------------------------------------------------------------------
def test_cv_normal_accepte(client):
    r = client.post("/api/pdf", json={"cv": CV, "options": {"modele": "classique"}})
    assert r.status_code == 200 and r.data[:5] == b"%PDF-"


def test_cv_trop_volumineux_refuse_avant_compilation(client):
    gros = dict(CV, experiences=[{"poste": f"Poste {i}", "entreprise": "E", "dates": "2020",
                                  "points": "\n".join(["Mission longue " * 25] * 12)} for i in range(25)])
    debut = time.time()
    r = client.post("/api/pdf", json={"cv": gros})
    assert r.status_code == 400 and "trop de texte" in r.get_json()["erreur"]
    assert time.time() - debut < 2                    # refusé sans lancer LaTeX


def test_cv_de_trop_de_pages_refuse_avec_le_nombre_de_pages(client):
    # Sous la limite de texte, mais beaucoup d'entrées courtes : beaucoup de pages.
    long = dict(CV, experiences=[{"poste": f"Poste {i}", "entreprise": "Entreprise", "lieu": "Dakar",
                                  "dates": "2020", "points": "\n".join(f"Mission {k}" for k in range(12))}
                                 for i in range(25)],
                formations=[{"diplome": f"Diplôme {i}", "ecole": "École", "dates": "2019"} for i in range(20)])
    r = client.post("/api/pdf", json={"cv": long, "options": {"modele": "europeen"}})
    assert r.status_code == 400, r.status_code
    message = r.get_json()["erreur"]
    assert message.startswith("Ton CV fait ") and "4 au maximum" in message, message


def test_lettre_trop_longue_refusee(client):
    longue = dict(LETTRE, parties={k: "Phrase de la lettre. " * 120 for k in ("accroche", "parcours", "entreprise", "conclusion")})
    r = client.post("/api/pdf", json={"type": "lettre", "cv": CV, "lettre": longue})
    assert r.status_code == 400 and "trop longue" in r.get_json()["erreur"]


# ---------------------------------------------------------------------------
# Programmes externes bridés
# ---------------------------------------------------------------------------
def test_les_programmes_externes_sont_bridés(monkeypatch):
    if not moteur._PRLIMIT:
        pytest.skip("prlimit absent sur cette machine")
    r = moteur.executer(["sh", "-c", "ulimit -v; ulimit -t; ulimit -f; ulimit -n"], 10, capture_output=True, text=True)
    memoire_ko, cpu, fichier, ouverts = r.stdout.split()
    assert int(memoire_ko) == moteur.MEMOIRE_PROCESSUS_MO * 1024
    assert int(cpu) == 15 and int(ouverts) == 256
    assert int(fichier) * 512 == moteur.FICHIER_MAX_MO * 1024 * 1024     # ulimit -f compte en blocs de 512 octets


def test_toutes_les_commandes_passent_par_executer(monkeypatch):
    vues = []
    vrai = moteur.executer
    monkeypatch.setattr(moteur, "executer", lambda commande, *a, **k: (vues.append(commande[0]), vrai(commande, *a, **k))[1])
    pdf = moteur.generer_cv(CV, {"modele": "moderne"})
    moteur.pdf_vers_images(pdf)
    assert vues[:2] == ["pdflatex", "pdftoppm"]


def test_compilation_lualatex_reussit_sous_les_limites():
    if not moteur.lualatex_disponible():
        pytest.skip("lualatex absent")
    pdf = moteur.generer_cv(dict(CV, nom="Ŋɔɛ Ɓaɗa"), {"modele": "moderne"})
    assert pdf[:5] == b"%PDF-"


# ---------------------------------------------------------------------------
# Serveur occupé : on refuse vite au lieu de bloquer les fils
# ---------------------------------------------------------------------------
def test_serveur_occupe_repond_503_vite_et_les_pages_restent_servies(nouveau_client, monkeypatch):
    monkeypatch.setattr(moteur, "ATTENTE_MAX_S", 0.5)
    for _ in range(2):                                 # les 2 places de compilation sont prises
        moteur._COMPILATIONS.acquire()
    try:
        debut = time.time()
        r = nouveau_client().post("/api/pdf", json={"cv": CV}, environ_base={"REMOTE_ADDR": "10.1.1.1"})
        assert r.status_code == 503 and r.headers["Retry-After"] == "10"
        assert "quelques secondes" in r.get_json()["erreur"]
        assert time.time() - debut < 2
        page = nouveau_client().get("/")
        assert page.status_code == 200
    finally:
        for _ in range(2):
            moteur._COMPILATIONS.release()


def test_file_d_attente_pleine_refus_immediat(nouveau_client, monkeypatch):
    monkeypatch.setattr(moteur, "_en_attente", moteur.EN_ATTENTE_MAX)
    debut = time.time()
    r = nouveau_client().post("/api/pdf", json={"cv": CV}, environ_base={"REMOTE_ADDR": "10.1.1.2"})
    assert r.status_code == 503 and time.time() - debut < 0.5


def test_les_places_sont_rendues_meme_en_cas_d_erreur(client):
    for _ in range(5):
        client.post("/api/pdf", json={"cv": {"nom": "x", "photo": "data:image/png;base64,AAAA"}})
    assert moteur._COMPILATIONS.acquire(timeout=0.1) and moteur._COMPILATIONS.acquire(timeout=0.1)
    moteur._COMPILATIONS.release(); moteur._COMPILATIONS.release()
    assert moteur._en_attente == 0


def test_charge_concurrente(nouveau_client):
    """20 demandes simultanées, de 20 adresses : jamais d'erreur 500, jamais de blocage."""
    codes = []

    def tir(n):
        codes.append(nouveau_client().post("/api/pdf", json={"cv": CV}, environ_base={"REMOTE_ADDR": f"10.2.0.{n}"}).status_code)

    fils = [threading.Thread(target=tir, args=(n,)) for n in range(20)]
    debut = time.time()
    for f in fils:
        f.start()
    for f in fils:
        f.join(timeout=60)
    assert len(codes) == 20 and set(codes) <= {200, 503}, codes
    assert time.time() - debut < 45


# ---------------------------------------------------------------------------
# Sauvegardes
# ---------------------------------------------------------------------------
def test_sauvegarde_coherente_et_privee(inscrire, monkeypatch):
    c = inscrire("awa@exemple.org")
    c.put(f"{API}/donnees", json={"donnees": {"cv": {"nom": "Awa"}}})
    copie = comptes.sauvegarder_base()
    assert stat.S_IMODE(os.stat(copie).st_mode) == 0o600
    assert stat.S_IMODE(os.stat(copie.parent).st_mode) == 0o700
    b = sqlite3.connect(copie)
    try:
        assert b.execute("SELECT email FROM comptes").fetchall() == [("awa@exemple.org",)]
        assert json.loads(b.execute("SELECT contenu FROM documents").fetchone()[0])["cv"]["nom"] == "Awa"
    finally:
        b.close()


def test_sauvegardes_anciennes_supprimees(monkeypatch):
    monkeypatch.setattr(comptes, "SAUVEGARDES_GARDEES", 3)
    for f in comptes.SAUVEGARDES.glob("comptes-*.sqlite3") if comptes.SAUVEGARDES.exists() else []:
        f.unlink()
    for i in range(5):
        cible = comptes.sauvegarder_base()
        cible.rename(cible.with_name(f"comptes-2026010{i}-000000.sqlite3"))     # dates différentes
    comptes.sauvegarder_base()
    restantes = sorted(p.name for p in comptes.SAUVEGARDES.glob("comptes-*.sqlite3"))
    assert len(restantes) == 3 and "comptes-20260101-000000.sqlite3" not in restantes


# ---------------------------------------------------------------------------
# Deux appareils : aucune modification écrasée
# ---------------------------------------------------------------------------
def test_les_versions_empechent_l_ecrasement(inscrire, nouveau_client):
    ordinateur = inscrire("awa@exemple.org", "Mot-de-passe-42")
    telephone = nouveau_client()
    telephone.post(f"{API}/connexion", json={"email": "awa@exemple.org", "mot_de_passe": "Mot-de-passe-42"})

    cree = ordinateur.put(f"{API}/donnees", json={"donnees": {"cv": {"nom": "Version 1"}}}).get_json()
    numero, version = cree["doc"], cree["version"]
    assert version == 1
    lu = telephone.get(f"{API}/donnees?doc={numero}").get_json()
    assert lu["version"] == 1

    r = ordinateur.put(f"{API}/donnees?doc={numero}", json={"donnees": {"cv": {"nom": "Ordinateur"}}, "version": 1})
    assert r.status_code == 200 and r.get_json()["version"] == 2

    # Le téléphone a travaillé sur la version 1 : son enregistrement est refusé, rien n'est écrasé.
    r = telephone.put(f"{API}/donnees?doc={numero}", json={"donnees": {"cv": {"nom": "Téléphone"}}, "version": 1})
    assert r.status_code == 409
    assert r.get_json()["conflit"] is True and r.get_json()["version"] == 2
    assert ordinateur.get(f"{API}/donnees?doc={numero}").get_json()["donnees"]["cv"]["nom"] == "Ordinateur"

    # Il enregistre alors son travail à part : les deux versions existent.
    r = telephone.put(f"{API}/donnees", json={"donnees": {"cv": {"nom": "Téléphone"}}, "nouveau": True,
                                              "nom": "Version modifiée sur cet appareil"})
    assert r.status_code == 201
    noms = sorted(d["donnees"]["cv"]["nom"] for d in ordinateur.get(f"{API}/documents").get_json()["documents"])
    assert noms == ["Ordinateur", "Téléphone"]


def test_version_dans_la_liste_et_les_copies(inscrire):
    c = inscrire("awa@exemple.org")
    numero = c.put(f"{API}/donnees", json={"donnees": {"cv": {"nom": "A"}}}).get_json()["doc"]
    c.put(f"{API}/donnees?doc={numero}", json={"donnees": {"cv": {"nom": "B"}}, "version": 1})
    assert c.get(f"{API}/documents").get_json()["documents"][0]["version"] == 2
    copie = c.post(f"{API}/documents", json={"copie_de": numero}).get_json()
    assert copie["version"] == 1


@pytest.mark.parametrize("version", ["1", 1.5, True, [1], {"v": 1}])
def test_version_invalide_refusee(inscrire, version):
    c = inscrire("awa@exemple.org")
    numero = c.put(f"{API}/donnees", json={"donnees": {"cv": {"nom": "A"}}}).get_json()["doc"]
    assert c.put(f"{API}/donnees?doc={numero}", json={"donnees": {"cv": {"nom": "B"}}, "version": version}).status_code == 400
    assert c.get(f"{API}/donnees?doc={numero}").get_json()["donnees"]["cv"]["nom"] == "A"


@pytest.mark.skipif(comptes.POSTGRES, reason="base SQLite seulement")
def test_ancienne_base_sans_colonne_version_migree(tmp_path, monkeypatch):
    base = tmp_path / "comptes.sqlite3"
    b = sqlite3.connect(base)
    b.execute("CREATE TABLE comptes (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, empreinte TEXT NOT NULL, "
              "jeton TEXT NOT NULL, cree_le INTEGER NOT NULL, vu_le INTEGER NOT NULL)")
    b.execute("CREATE TABLE documents (id INTEGER PRIMARY KEY, compte_id INTEGER NOT NULL, nom TEXT NOT NULL, "
              "contenu TEXT NOT NULL, modifie_le INTEGER NOT NULL)")
    b.execute("INSERT INTO comptes VALUES (1, 'a@b.c', 'x', 'j', 0, 0)")
    b.execute("INSERT INTO documents VALUES (1, 1, 'Mon CV', '{}', 0)")
    b.commit()
    b.close()
    monkeypatch.setattr(comptes, "DOSSIER", tmp_path)
    monkeypatch.setattr(comptes, "BASE", base)
    monkeypatch.setattr(comptes, "SAUVEGARDE_HEURES", 0)
    from flask import Flask
    comptes.initialiser(Flask("essai"))                # le vrai démarrage, sur l'ancienne base
    with comptes._base() as b:
        assert b.execute("SELECT id, nom, version FROM documents").fetchall() == [(1, "Mon CV", 1)]
    comptes.initialiser(Flask("essai2"))               # un second démarrage ne change rien
    with comptes._base() as b:
        assert b.execute("SELECT version FROM documents").fetchall() == [(1,)]


# ---------------------------------------------------------------------------
# Documents administratifs (demande, attestation, procuration) : mis en page comme une lettre
# ---------------------------------------------------------------------------
PROCURATION = {"titre": "PROCURATION", "lieu": "Dakar", "date": "16 novembre 2026",
               "corps": "Je soussignée, Awa Exemple, donne procuration à Moussa Exemple.\nFait pour servir et valoir ce que de droit.",
               "signataires": [{"role": "Le mandant", "nom": "Awa Exemple", "mention": "« Bon pour pouvoir »"},
                               {"role": "Le mandataire", "nom": "Moussa Exemple", "mention": "« Bon pour acceptation »"}]}


def _texte_pdf(pdf, tmp_path):
    import subprocess
    (tmp_path / "d.pdf").write_bytes(pdf)
    return subprocess.run(["pdftotext", "-layout", str(tmp_path / "d.pdf"), "-"], capture_output=True, text=True).stdout


def test_document_administratif_titre_date_en_bas_deux_signatures(client, tmp_path):
    r = client.post("/api/pdf", json={"type": "admin", "cv": CV, "admin": PROCURATION})
    assert r.status_code == 200 and r.data[:5] == b"%PDF-"
    assert "Document_Awa_Exemple.pdf" in r.headers["Content-Disposition"]
    texte = _texte_pdf(r.data, tmp_path)
    assert "PROCURATION" in texte and "Fait à Dakar, le 16 novembre 2026" in texte
    assert "Le mandant" in texte and "Le mandataire" in texte and "Moussa Exemple" in texte
    assert CV["titre"] not in texte                       # pas de « poste visé » sous le nom
    assert texte.index("PROCURATION") < texte.index("Je soussignée") < texte.index("Fait à Dakar") < texte.index("Le mandant")


def test_demande_a_une_autorite_garde_la_presentation_d_une_lettre(client, tmp_path):
    demande = {"destinataire": {"nom": "À Monsieur le Maire de Thiès"}, "lieu": "Thiès", "date": "16 novembre 2026",
               "objet": "Demande de stage", "corps": "Monsieur le Maire,\nJ'ai l'honneur de solliciter un stage."}
    r = client.post("/api/pdf", json={"type": "admin", "cv": CV, "admin": demande})
    texte = _texte_pdf(r.data, tmp_path)
    assert r.status_code == 200 and "Demande de stage" in texte and "Thiès, le 16 novembre 2026" in texte
    assert "Fait à" not in texte


@pytest.mark.parametrize("admin", [
    None, "x", [], {}, {"corps": ""}, {"corps": "x", "signataires": "abc"}, {"corps": "x", "signataires": [1, None, "a"]},
    {"corps": "x", "titre": ["a"], "signataires": [{"role": {"a": 1}, "nom": 3}]},
    {"corps": "x", "titre": "\\input{/etc/passwd} & % $ # _ { }", "signataires": [{"role": "\\write18{id}", "nom": "~^"}] * 5},
])
def test_document_administratif_hostile_jamais_d_erreur_500(client, admin):
    r = client.post("/api/pdf", json={"type": "admin", "cv": CV, "admin": admin})
    assert r.status_code in (200, 400), r.get_json()
    r = client.post("/api/pdf", json={"type": "admin", "cv": "pas un dictionnaire", "admin": admin})
    assert r.status_code == 400


def test_une_lettre_de_motivation_ordinaire_ne_change_pas(tmp_path):
    texte = _texte_pdf(moteur.generer_lettre(CV, LETTRE, {}), tmp_path)
    assert "Fait à" not in texte and texte.count(CV["nom"]) == 2      # en-tête et signature
