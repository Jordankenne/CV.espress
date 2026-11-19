"""Inscriptions automatisées : champ piège, Cloudflare Turnstile, plafond quotidien, quota d'e-mails."""
import io
import json
import time

import app as application
import comptes
from test_securite_comptes import API, inscription, nombre_de_comptes


class _Reponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


def _turnstile_actif(monkeypatch, succes=True, injoignable=False):
    """Active Turnstile et remplace l'appel à Cloudflare. Renvoie la liste des jetons vérifiés."""
    monkeypatch.setattr(comptes, "TURNSTILE_CLE_SITE", "cle-publique")
    monkeypatch.setattr(comptes, "TURNSTILE_SECRET", "secret")
    verifies = []

    def appel(demande, timeout=None):
        assert demande.full_url == comptes.TURNSTILE_ADRESSE
        verifies.append(demande.data.decode())
        if injoignable:
            raise OSError("réseau")
        return _Reponse(json.dumps({"success": succes}).encode())

    monkeypatch.setattr(comptes.urllib.request, "urlopen", appel)
    return verifies


def test_champ_piege_rempli_refuse_l_inscription(client):
    r = inscription(client, site_web="http://spam.example")
    assert r.status_code == 400
    assert nombre_de_comptes() == 0


def test_champ_piege_vide_ne_gene_pas(client):
    assert inscription(client, site_web="").status_code == 201


def test_sans_reglage_turnstile_pas_de_verification(client):
    assert client.get(API).get_json()["turnstile"] == ""
    assert inscription(client).status_code == 201


def test_turnstile_cle_publique_donnee_au_navigateur(client, monkeypatch):
    _turnstile_actif(monkeypatch)
    assert client.get(API).get_json()["turnstile"] == "cle-publique"


def test_turnstile_sans_jeton_refuse(client, monkeypatch):
    verifies = _turnstile_actif(monkeypatch)
    r = inscription(client)
    assert r.status_code == 400 and r.get_json()["turnstile"] is True
    assert verifies == [] and nombre_de_comptes() == 0


def test_turnstile_jeton_refuse_par_cloudflare(client, monkeypatch):
    _turnstile_actif(monkeypatch, succes=False)
    assert inscription(client, turnstile="faux").status_code == 400
    assert nombre_de_comptes() == 0


def test_turnstile_jeton_valide(client, monkeypatch):
    verifies = _turnstile_actif(monkeypatch)
    assert inscription(client, turnstile="bon-jeton").status_code == 201
    assert "response=bon-jeton" in verifies[0] and "secret=secret" in verifies[0]


def test_turnstile_injoignable_n_empeche_pas_de_s_inscrire(client, monkeypatch):
    _turnstile_actif(monkeypatch, injoignable=True)
    assert inscription(client, turnstile="jeton").status_code == 201


def test_csp_autorise_turnstile_seulement_s_il_est_configure(client):
    assert "challenges.cloudflare.com" not in client.get("/compte").headers["Content-Security-Policy"]


def test_plafond_quotidien_d_inscriptions(client, monkeypatch):
    monkeypatch.setattr(comptes, "INSCRIPTIONS_PAR_JOUR", 2)
    maintenant = int(time.time())
    with comptes._base() as b:
        for i in range(2):
            b.execute("INSERT INTO comptes (email, empreinte, jeton, cree_le, vu_le) VALUES (?, 'x', 'y', ?, ?)",
                      (f"robot{i}@exemple.org", maintenant, maintenant))
    assert inscription(client).status_code == 503
    with comptes._base() as b:            # comptes anciens : ne comptent plus
        b.execute("UPDATE comptes SET cree_le = ?", (maintenant - 2 * 86400,))
    assert inscription(client).status_code == 201


def test_quota_d_emails_garde_une_reserve_pour_les_liens(monkeypatch):
    monkeypatch.setattr(comptes, "EMAILS_PAR_JOUR", 5)
    monkeypatch.setattr(comptes, "EMAILS_RESERVE_LIENS", 2)
    monkeypatch.setattr(comptes, "_emails_du_jour", {"jour": "", "envoyes": 0})
    assert [comptes._budget_email("bienvenue") for _ in range(4)] == [True, True, True, False]
    assert [comptes._budget_email("oubli") for _ in range(3)] == [True, True, False]


def test_quota_atteint_aucun_envoi(monkeypatch):
    monkeypatch.setattr(comptes, "_budget_email", lambda genre: False)
    monkeypatch.setattr(comptes, "BREVO_CLE_API", "cle")
    monkeypatch.setattr(comptes, "_envoyer_par_brevo", lambda *a, **k: (_ for _ in ()).throw(AssertionError("envoyé")))
    comptes.envoyer_email("a@exemple.org", "s", "t", "bienvenue", application.app.logger)


def test_lien_recu_par_email_marque_l_adresse_verifiee(inscrire, liens, nouveau_client):
    inscrire("verif@exemple.org")
    with comptes._base() as b:
        assert b.execute("SELECT verifie_le FROM comptes").fetchone()[0] == 0
    nouveau_client().post(f"{API}/mot-de-passe-oublie", json={"email": "verif@exemple.org"})
    jeton = liens[-1][3].split("jeton=")[1]
    assert nouveau_client().post(f"{API}/nouveau-mot-de-passe",
                                 json={"jeton": jeton, "mot_de_passe": "Nouveau-mdp-42"}).status_code == 200
    with comptes._base() as b:
        assert b.execute("SELECT verifie_le FROM comptes").fetchone()[0] > 0
