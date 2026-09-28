# TikTok Ads Dashboard (Vercel)

Un tableau de bord simple pour gérer et **dupliquer** vos campagnes TikTok Ads, avec **automatisation**, construit sur la **TikTok Marketing API v1.3** officielle et déployable **entièrement sur Vercel**.

- **`/api`** — fonctions **serverless** Vercel. Toute la logique TikTok (auth, tokens, appels API, reporting, duplication, automatisation, logs). Les secrets sont des **variables d'environnement** (jamais dans le frontend).
- **`/lib`** — code partagé (client TikTok, services, store, automatisation).
- **`/frontend`** — interface statique (HTML/CSS/JS), servie par Vercel. **Aucune clé, aucun token** côté client : tout passe par `/api`.

L'automatisation ne repose pas sur un serveur qui tourne en continu (impossible en serverless) mais sur un **Vercel Cron** qui appelle `/api/cron/tick` régulièrement, avec l'état persistant stocké dans **Upstash Redis**.

---

## Architecture sur Vercel

```
/api
  health.js                      GET  /api/health
  accounts.js                    GET  /api/accounts
  identities.js                  GET  /api/identities
  logs.js                        GET  /api/logs
  campaigns/index.js             GET  /api/campaigns
  campaigns/latest.js            GET  /api/campaigns/latest
  campaigns/[id].js              GET  /api/campaigns/:id
  campaigns/[id]/duplicate.js    POST /api/campaigns/:id/duplicate
  automation/status.js           GET  /api/automation/status
  automation/config.js           POST /api/automation/config
  automation/start.js            POST /api/automation/start
  automation/stop.js             POST /api/automation/stop
  cron/tick.js                   GET  /api/cron/tick   (déclenché par Vercel Cron)
/lib      → code partagé
/frontend → interface statique
vercel.json → cron + build statique
```

## 1. Prérequis

- Un compte **Vercel** et la CLI : `npm i -g vercel`.
- **Node.js ≥ 18** en local.
- Une base **Upstash Redis** (gratuite) pour l'état persistant (automatisation, verrous, idempotence, logs).

## 2. Créer la base Upstash Redis

1. Créez un compte sur <https://upstash.com> puis une base **Redis** (region proche de vos utilisateurs).
2. Dans la page de la base, copiez **`UPSTASH_REDIS_REST_URL`** et **`UPSTASH_REDIS_REST_TOKEN`**.
3. Vous les mettrez dans les variables d'environnement Vercel (section 5).

> Alternative : **Vercel KV** (Storage → KV). Il expose `KV_REST_API_URL` / `KV_REST_API_TOKEN`, que le code accepte aussi automatiquement.

## 3. Créer / configurer l'application TikTok Developer

1. Portail : <https://business-api.tiktok.com/portal> → **Create app**.
2. Notez **App ID** et **Secret** (→ `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`).
3. Déclarez une **Redirect URL** identique à `TIKTOK_REDIRECT_URI`. En production, utilisez votre URL Vercel, ex. `https://votre-app.vercel.app/api/auth/callback`.
4. Activez les **permissions** (section 7) et soumettez l'app à validation si nécessaire.

## 4. Connecter votre compte TikTok Ads (obtenir le token)

TikTok utilise **OAuth 2.0** (authorization code).

1. Depuis le portail, lancez l'autorisation et connectez-vous avec le **compte annonceur** à gérer.
2. TikTok redirige vers votre `TIKTOK_REDIRECT_URI` avec un `auth_code`.
3. Échangez ce code contre un token long-lived :

```bash
curl -X POST https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/ \
  -H "Content-Type: application/json" \
  -d '{"app_id":"VOTRE_APP_ID","secret":"VOTRE_SECRET","auth_code":"LE_AUTH_CODE"}'
```

4. Copiez `data.access_token` dans la variable `TIKTOK_ACCESS_TOKEN`.

## 5. Déployer sur Vercel

### a) Variables d'environnement

Dans **Vercel → votre projet → Settings → Environment Variables**, ajoutez :

| Variable | Rôle |
|---|---|
| `TIKTOK_APP_ID` | App ID TikTok. |
| `TIKTOK_APP_SECRET` | Secret TikTok. |
| `TIKTOK_ACCESS_TOKEN` | Token d'accès long-lived (section 4). |
| `TIKTOK_REDIRECT_URI` | URL de redirection OAuth (votre URL Vercel). |
| `TIKTOK_API_BASE` | `https://business-api.tiktok.com` (optionnel). |
| `UPSTASH_REDIS_REST_URL` | URL REST de la base Upstash. |
| `UPSTASH_REDIS_REST_TOKEN` | Token REST de la base Upstash. |
| `CRON_SECRET` | Secret aléatoire protégeant `/api/cron/tick` (`openssl rand -hex 32`). |
| `CORS_ORIGIN` | `*` (même origine sur Vercel). |
| `TIMEZONE` | ex. `Europe/Paris`. |
| `CURRENCY` | ex. `EUR`. |

> `CRON_SECRET` : Vercel l'envoie automatiquement au cron sous forme d'en-tête `Authorization: Bearer <CRON_SECRET>`. L'endpoint le vérifie et refuse toute requête non autorisée.

### b) Déployer

Depuis la racine du projet :

```bash
vercel          # première fois : lie le projet
vercel --prod   # déploiement en production
```

Ou connectez le repo Git à Vercel (import du projet) : les pushes déploient automatiquement.

Vercel détecte `vercel.json`, sert `/frontend` en statique, publie les fonctions `/api` et enregistre le **cron**.

## 6. À propos du Cron (important)

Le cron est défini dans `vercel.json` :

```json
"crons": [{ "path": "/api/cron/tick", "schedule": "0 * * * *" }]
```

- `0 * * * *` = **toutes les heures**. C'est le déclencheur ; la logique interne décide s'il faut réellement lancer (fenêtre horaire, intervalle configuré, maximum/jour).
- **Plan Vercel Hobby (gratuit)** : les cron jobs sont limités à **un déclenchement par jour**. Si vous êtes en Hobby, mettez par exemple `"schedule": "0 9 * * *"` (une fois par jour) — l'automatisation ne pourra alors créer qu'un lot par jour.
- **Plan Pro** : cron plus fréquents autorisés (ex. toutes les heures comme ci-dessus).
- Vous pouvez aussi déclencher manuellement un tick en appelant `GET /api/cron/tick` avec l'en-tête `Authorization: Bearer <CRON_SECRET>`.

*Contenu reformulé pour respecter les restrictions de licence.* Détails officiels : [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs).

## 7. Permissions TikTok nécessaires

- **Ad Account Management** — `oauth2/advertiser/get`.
- **Campaign / Ad Group / Ad management (lecture + écriture)** — lister et créer campagnes, ad groups, ads.
- **Reporting** — `report/integrated/get` (dépenses, conversions, valeur d'achat → ROAS).
- **Identity / Spark Ads** — `identity/get`, `identity/video/info` (dupliquer les Spark Ads sans les transformer en publicités classiques).

Les noms exacts des scopes dépendent de votre app dans le portail. Doc : <https://business-api.tiktok.com/portal/docs>.

## 8. Lancer en local

```bash
npm install
cp .env.example .env   # renseignez vos valeurs
vercel dev             # émule les fonctions /api + sert le frontend
```

Ouvrez l'URL indiquée par `vercel dev` (souvent `http://localhost:3000`).

> Sans Upstash configuré en local, le store bascule sur un **fallback en mémoire** : parfait pour tester, mais l'état ne persiste pas entre invocations. En production, Upstash est requis.

---

## Comportements de sécurité importants

- **Aucun secret côté frontend.** Toutes les opérations TikTok passent par `/api`.
- **Idempotence + verrouillage** (via Upstash) : un en-tête `Idempotency-Key` rejoue le même résultat pendant 10 min ; un verrou `SET NX EX` empêche une double duplication de la même campagne (double-clic → `409`). Le bouton se désactive et affiche « Création en cours… ».
- **PAUSE par défaut** : toute duplication et toute campagne automatisée est créée en **PAUSE** sauf choix explicite **ACTIVE**.
- **Spark Ads** : jamais converties silencieusement en publicités classiques. Si le post/identité source n'est pas réutilisable, l'ad est marquée **en échec** avec le message TikTok.
- **Échec partiel** : jamais affiché comme « succès ». Le résultat détaille campagne créée, Ad Groups créés, Ads créées, éléments en échec et message d'erreur TikTok.
- **Cron protégé** par `CRON_SECRET`.

## Note sur la duplication

TikTok ne fournit pas d'endpoint « dupliquer » unique. Le backend lit la structure complète de la campagne source (campagne → ad groups → ads) via les endpoints officiels `*/get`, puis la recrée via `campaign/create`, `adgroup/create`, `ad/create` en reportant ciblage, placements, optimisation, événement de conversion/pixel et budget. Certains réglages en lecture seule ou soumis à validation TikTok peuvent être refusés côté API — l'élément concerné apparaît alors dans les échecs avec le message TikTok exact.
