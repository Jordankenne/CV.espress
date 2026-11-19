"""Une sauvegarde n'a de valeur que si elle se restaure : copie, restauration, vérification."""
import pytest

import comptes
import statistiques


def _remplir(inscrire):
    c = inscrire("awa@exemple.org")
    assert c.put("/api/compte/donnees", json={"donnees": {"cv": {"nom": "Awa"}}, "nouveau": True}).status_code == 201
    statistiques.compter("pdf:cv", 3)
    statistiques.vider()
    return c


def test_la_base_correspond_a_sa_copie(inscrire):
    _remplir(inscrire)
    copie = comptes.sauvegarder_base()
    bilan = comptes.verifier_restauration(copie)
    assert bilan["comptes"] == 1 and bilan["documents"] == 1 and bilan["compteurs"] >= 1


def test_une_difference_est_signalee(inscrire, nouveau_client):
    c = _remplir(inscrire)
    copie = comptes.sauvegarder_base()
    c.put("/api/compte/donnees", json={"donnees": {"cv": {"nom": "Awa 2"}}, "nouveau": True})
    with pytest.raises(RuntimeError, match="documents : 1 lignes dans la copie, 2 dans la base"):
        comptes.verifier_restauration(copie)


@pytest.mark.skipif(not comptes.POSTGRES, reason="restauration : base PostgreSQL seulement (CV_TESTS_POSTGRES)")
def test_aller_retour_complet_sur_postgres(inscrire):
    _remplir(inscrire)
    copie = comptes.sauvegarder_base()
    with comptes._base() as b:                 # accident : tout est perdu
        for table in reversed(comptes.TABLES):
            b.execute(f"DELETE FROM {table}")
    comptes.restaurer_base(copie)
    assert comptes.verifier_restauration(copie)["comptes"] == 1


def test_une_copie_vide_est_refusee(tmp_path):
    vide = tmp_path / "vide.sqlite3"
    import sqlite3
    sqlite3.connect(vide).close()
    with pytest.raises(RuntimeError, match="vide ou abîmée"):
        comptes.verifier_restauration(vide)
