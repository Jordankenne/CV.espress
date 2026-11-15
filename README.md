# CV.express

Générateur de CV et de lettres de motivation en PDF (français, anglais, italien).

## Lancer en développement

```bash
.venv/bin/python app.py          # puis ouvrir http://localhost:5000
```

Sans serveur d'e-mails configuré, les liens d'inscription et de mot de passe oublié
sont écrits dans le terminal au lieu d'être envoyés.

## Tests

```bash
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest tests -q
```

## Production

Voir le `Dockerfile`. Avec `DERRIERE_PROXY=1`, le serveur refuse de démarrer sans
`ADRESSE_SITE` (en https), `CLE_SECRETE`, `EMAIL_EXPEDITEUR` et un moyen d'envoyer les
e-mails : `BREVO_CLE_API` (API web de Brevo) ou les réglages `SMTP_…`.

La base des comptes est :
- une base PostgreSQL en ligne si `DATABASE_URL` est défini (par exemple Neon) ;
- sinon un fichier SQLite dans `/donnees` : monter alors un volume à cet endroit.

## Sauvegardes de la base

Le serveur fait une copie de la base toutes les 24 heures dans `/donnees/sauvegardes/`
et garde les 14 plus récentes. Réglages : `SAUVEGARDE_HEURES` (0 pour désactiver) et
`SAUVEGARDES_GARDEES`. Copie immédiate, par exemple depuis une tâche cron :

```bash
python -m comptes sauvegarder
```

**Ces copies sont sur le même disque que la base.** Elles protègent d'une erreur ou
d'une base abîmée, pas de la perte du disque : activer aussi les instantanés (snapshots)
du volume chez l'hébergeur, ou copier régulièrement `/donnees/sauvegardes/` ailleurs.

Restaurer une sauvegarde :

1. arrêter le serveur ;
2. remplacer `/donnees/comptes.sqlite3` par la copie choisie, et supprimer
   `comptes.sqlite3-wal` et `comptes.sqlite3-shm` s'ils existent ;
3. vérifier que le fichier appartient à l'utilisateur du serveur, avec les droits 600 ;
4. relancer le serveur.

## Déployer gratuitement : Render + Neon + Brevo

Trois comptes gratuits, chacun son rôle : **Render** fait tourner le site, **Neon** garde la
base des comptes, **Brevo** envoie les e-mails (inscription, mot de passe oublié).

1. **Neon** (neon.com) : créer un projet, région **AWS Europe Central (Frankfurt)**.
   Dans **Connect**, copier la chaîne de connexion (`postgresql://…?sslmode=require`).
   Les tables sont créées automatiquement au premier démarrage du site.
2. **Brevo** (brevo.com) :
   - **Senders, Domains & Dedicated IPs > Senders** : ajouter et valider l'adresse qui
     enverra les e-mails (un lien de confirmation arrive dans cette boîte) ;
   - **SMTP & API > API Keys** : créer une clé et la copier.
3. Pousser le dépôt sur GitHub (`git push`).
4. **Render** (render.com) : **New > Blueprint**, choisir le dépôt. Render lit `render.yaml`
   et demande :
   - `ADRESSE_SITE` : `https://cv-express.onrender.com` (le nom exact est affiché par
     Render ; s'il diffère, corriger cette valeur dans **Environment** ensuite) ;
   - `DATABASE_URL` : la chaîne de connexion Neon ;
   - `BREVO_CLE_API` : la clé Brevo ;
   - `EMAIL_EXPEDITEUR` : l'adresse validée dans Brevo, par exemple
     `CV.express <ton.adresse@gmail.com>`.
5. Vérifier : créer un compte sur le site ; l'e-mail d'inscription doit arriver (regarder
   aussi les indésirables). En cas de problème, **Logs** dans Render.

Limites de l'offre gratuite : le site s'endort après 15 minutes sans visite (le premier
visiteur attend alors environ une minute), un PDF prend quelques secondes de plus, Neon
garde 1 Go (quelques milliers de comptes) et Brevo envoie 300 e-mails par jour.
Plus tard, avec un budget : `plan: starter` dans `render.yaml` (site jamais endormi,
plus rapide), sans rien changer d'autre.

Propre domaine : l'ajouter dans **Settings > Custom Domains** sur Render, puis mettre
`ADRESSE_SITE` à `https://ce-domaine`.

## Déployer gratuitement sur Hugging Face Spaces

Plus puissant que Render gratuit (2 processeurs, 16 Go), sans carte bancaire. Le site
s'endort après 48 heures sans visite. Neon et Brevo s'utilisent de la même façon.

1. Créer un compte sur huggingface.co, puis un jeton **Write** dans
   **Settings > Access Tokens**.
2. Mettre les réglages dans `production.env` (ignoré par Git) : `CLE_SECRETE`,
   `DATABASE_URL`, `BREVO_CLE_API`, `EMAIL_EXPEDITEUR`.
3. Publier (crée le Space, enregistre les réglages comme secrets, envoie le code) :

   ```bash
   .venv/bin/pip install huggingface_hub
   HF_TOKEN=hf_… .venv/bin/python publier_hf.py TON_NOM/cv-express production.env
   ```

   Pour une mise à jour du code ensuite : la même commande sans `production.env`.
4. Le site est à l'adresse `https://ton-nom-cv-express.hf.space` (affichée par le script).
   Donner cette adresse-là aux visiteurs : la page huggingface.co/spaces/… affiche le site
   dans un cadre, que le site refuse par sécurité (protection contre le « clickjacking »).

Si le journal affiche « Base PostgreSQL injoignable », Hugging Face bloque la sortie vers
le port 5432 de Neon : le signaler sur discuss.huggingface.co, ou héberger ailleurs.

### Sauvegarder la base en ligne

Neon gratuit ne garde pas de vraies sauvegardes. Depuis ton ordinateur, régulièrement
(par exemple chaque semaine) :

```bash
DATABASE_URL='postgresql://…' .venv/bin/python -m comptes sauvegarder
```

La base entière est copiée dans un fichier `donnees/sauvegardes/comptes-DATE.sqlite3`
(il contient les adresses e-mail des clients : ne pas le partager). Pour la remettre en
ligne dans une base Neon **vide** (nouvelle base, ou après un accident) :

```bash
DATABASE_URL='postgresql://…' .venv/bin/python -m comptes restaurer donnees/sauvegardes/comptes-DATE.sqlite3
```

La même commande transfère les comptes d'une ancienne base SQLite vers Neon.

### Tests sur PostgreSQL

Les tests tournent aussi sur une base PostgreSQL **jetable** (elle est vidée à chaque test,
ne jamais y mettre l'adresse de la vraie base) :

```bash
CV_TESTS_POSTGRES='postgresql://…/base_de_test' .venv/bin/python -m pytest tests -q
```
