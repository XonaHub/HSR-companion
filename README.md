# HSR Companion

**English** · [Français](#français)

A Windows desktop app for **Honkai: Star Rail** players.
It brings together in one place what you usually look up on several websites:
your characters, what's left to farm, your warps, your relics, your teams and the game's news.

> Unofficial fan app, not affiliated with HoYoverse. Everything stays on your PC.

## Download

Get the latest version from the [Releases](https://github.com/XonaHub/HSR-companion/releases/latest) page:

- **`…_x64-setup.exe`**: the installer (recommended). The app then updates itself: on launch, it offers new versions.
- **`…_x64-portable.exe`**: runs without installing anything. It doesn't update itself: download the new version by hand.

The app isn't signed with a paid certificate, so Windows SmartScreen may show "Windows protected your PC":
click **More info**, then **Run anyway**.

## What the app does

The app has 8 tabs:

| Tab | What it's for |
|---|---|
| **Today** | Opens on every launch: the character you're farming and the time left, your available warps, the current banner, the next version, the next endgame mode to start a new cycle and the latest news. The "Relics to review" card lists the characters of the teams marked ★ in My teams (Teams tab) with what their relics need (pieces to change, to farm, to level); mark a team with a ★ to see its characters there. |
| **Characters** | Every character in the game, the ones you own, and your light cones. Click a character to open their sheet: abilities, traces, eidolons, recommended light cones, relic review, materials. The Relics tab of the sheet suggests the best gear you can put together from your free relics (side by side with what the character wears), says what to farm when nothing fits, and gives the chances of low-level pieces turning out better once levelled. The ‹ › buttons (or the ← → keys) go to the previous or next character. The + button in the corner adds them to your characters (− removes them). |
| **Farming** | Pick a character and a target level; the app tells you what you're missing (taking your inventory into account) and how many days of energy it takes. |
| **Warps** | Your Stellar Jade, your passes and your pity. A simulator gives your odds of getting a character or a light cone with what you have. The estimate of your upcoming warps counts the jades from new endgame cycles, based on what you usually earn in each mode. You can import your warp history. |
| **Relics** | All your relics, graded from S to D based on the character type (crit, break, healer…). Each character's review is on their sheet. |
| **Teams** | Build teams for Memory of Chaos, Pure Fiction and Apocalyptic Shadow, with tips (no healer, too many DPS…). Each mode shows its current cycle (name, effect, end date) and the next one. Tick the enemy weaknesses of each half: the app checks which ones your team covers and suggests your characters of those elements; the choice resets at the next cycle. |
| **News** | Official announcements grouped by version: banners, events, how many warps you can earn during the version, and the current cycle of each endgame mode (Memory of Chaos, Pure Fiction, Apocalyptic Shadow, Anomaly Arbitration) with the date of the next one. |
| **Settings** | Language (French / English), game server (endgame reset times depend on it; detected automatically from your UID), farming yield, export and import of your data, save backups to go back in time, data status, installed version and "Check for updates" button. |

## Fill the app with your account

You don't have to enter everything by hand:

- **Your whole account** (characters, levels, traces, relics, light cones, materials): with the free tool
  [Reliquary Archiver](https://github.com/IceDynamix/reliquary-archiver).
  Either import the file it produces, or leave it running while you play and the app updates live.
- **Following a relic upgrade live**: start Reliquary Archiver before the game, click "Live import" and wait for the "connected" state,
  then keep the character's sheet open on the Relics tab. Each time a piece listed under "To level" is upgraded in game,
  its chances update right away, with a verdict: worth continuing, or no longer worth it.
- **During the Relic Recon event**: the Relics tab of a character's sheet (owned or not) says which sets to pick in the event,
  how much a guaranteed opening would improve each slot, and how many guarantees are useful for this character.
  With the live import, each piece obtained from a chest (or swapped with "Replace with the new Relic") shows up there right away, with a verdict: equip it, or not better.
  When Prydwen has no advice for the character yet, the sets are taken from the pieces obtained, and the relic profile can be chosen at the top of the Relics tab, even for a character you don't own.
- **Your warp history**: open the warp history in the game, then click "Auto-detect" in the Warps tab.
  The app finds the link by itself in the game's cache.

## Where the information comes from

- **Game data** (characters, materials, costs, images): the community repository StarRailRes.
  The app checks for updates every 6 hours and updates itself after a game update.
- **News**: only HoYoverse's official announcements on HoYoLAB. No leaks.
- **Light cone and relic recommendations**: the Prydwen website.
- **Estimates**: EXP per level bracket, farming yield and the pity model are estimates,
  not official values.

**Settings → Data status** shows how recent each source is and whether the last check worked, with a **Check now** button.
An **Offline** badge appears at the top when a source could not be reached.

## Where is my data?

In `%APPDATA%\fr.hsrcompanion.desktop\` on your PC. Nothing is sent anywhere else.
To move to another PC: **Settings → Export**, then **Import** on the other PC.

The app also keeps copies of your save: one per day, and one right before every import, reset or app update (the last 5 of each). If something goes wrong, go to **Settings → Save backups** and click **Restore** next to the copy you want.

## For developers

You need Node.js, Rust and (on Windows) the Visual Studio Build Tools.

```bash
npm install
npm run dev     # runs the app in development mode (Settings shows "Development build")
npm test        # JavaScript + Rust tests
npm run build   # builds the Windows installer
npm run build:dev  # builds a development .exe in release/dev/ (Settings shows "Development build")
```

The tests also run on GitHub (Actions tab) after every push to `master` and on every pull request.

Publishing a version (maintainer only, needs the private signing key): bump the version in
`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `package.json`, then run
`npm run release -- --notes "What's new"` and upload the 3 files from `release/v<version>/` to a GitHub release
tagged `v<version>`.

## License

Code under the [MIT](LICENSE) license. Honkai: Star Rail, its characters and its images
belong to HoYoverse.

---

## Français

[English](#hsr-companion) · **Français**

Une application de bureau Windows pour les joueurs de **Honkai: Star Rail**.
Elle réunit au même endroit ce qu'on cherche d'habitude sur plusieurs sites :
ses persos, ce qu'il reste à farmer, ses vœux, ses reliques, ses équipes et les actus du jeu.

> Application de fan non officielle, sans lien avec HoYoverse. Tout reste sur le PC.

### Télécharger

La dernière version est sur la page [Releases](https://github.com/XonaHub/HSR-companion/releases/latest) :

- **`…_x64-setup.exe`** : l'installateur (conseillé). L'app se met ensuite à jour toute seule : au lancement, elle propose les nouvelles versions.
- **`…_x64-portable.exe`** : se lance sans rien installer. Il ne se met pas à jour tout seul : la nouvelle version est à télécharger à la main.

L'app n'est pas signée avec un certificat payant : Windows SmartScreen peut afficher « Windows a protégé votre ordinateur ».
Cliquer alors sur **Informations complémentaires**, puis **Exécuter quand même**.

### Ce que fait l'app

L'app a 8 onglets :

| Onglet | À quoi il sert |
|---|---|
| **Aujourd'hui** | Ouvert à chaque lancement : le perso en cours de farm et le temps restant, les vœux disponibles, la bannière en cours, la prochaine version, le prochain mode d'endgame qui change de cycle et la dernière actu. La carte « Reliques à revoir » liste les persos des équipes marquées ★ dans Mes équipes (onglet Équipes) avec ce que demandent leurs reliques (pièces à changer, à farmer, à monter) ; marquer une équipe d'une ★ pour y voir ses persos. |
| **Personnages** | Tous les persos du jeu, les persos possédés et les cônes de lumière. Un clic sur un perso ouvre sa fiche : compétences, traces, eidolons, cônes conseillés, bilan des reliques, matériaux. L'onglet Reliques de la fiche propose le meilleur équipement possible avec les reliques libres (à côté de ce que porte le perso), indique quoi farmer quand rien ne convient, et donne les chances qu'une pièce encore basse devienne meilleure une fois montée. Les boutons ‹ › (ou les touches ← →) passent au perso précédent ou suivant. Le bouton + en coin l'ajoute aux persos possédés (− pour le retirer). |
| **Farm** | Choix d'un perso et du niveau visé ; l'app indique ce qui manque (en tenant compte de l'inventaire) et combien de jours d'énergie il faut. |
| **Vœux** | Jades, passes et pity. Un simulateur calcule les chances d'obtenir un perso ou un cône avec les tirages disponibles. L'estimation des vœux à venir compte les jades des nouveaux cycles d'endgame, selon ce qui est obtenu d'habitude dans chaque mode. L'historique des vœux peut être importé. |
| **Reliques** | Toutes les reliques avec une note de S à D selon le type de perso (critique, rupture, soigneur…). Le bilan par perso est dans sa fiche. |
| **Équipes** | Composer des équipes pour la Mémoire du chaos, la Fiction pure et l'Ombre apocalyptique, avec des conseils (pas de soigneur, trop de DPS…). Chaque mode affiche son cycle en cours (nom, effet, date de fin) et le suivant. Les faiblesses des ennemis se cochent pour chaque moitié : l'app indique celles que l'équipe couvre et propose les persos possédés de ces éléments ; le choix repart à zéro au cycle suivant. |
| **Actus** | Les annonces officielles regroupées par version : bannières, événements, combien de vœux on peut gagner pendant la version, et le cycle en cours de chaque mode d'endgame (Mémoire du chaos, Fiction pure, Ombre apocalyptique, Arbitre de l'instable) avec la date du suivant. |
| **Paramètres** | Langue (français / anglais), serveur du jeu (les heures de reset de l'endgame en dépendent ; trouvé tout seul d'après l'UID), rendement de farm, export et import des données, copies de la sauvegarde pour revenir en arrière, statut des données, version installée et bouton « Rechercher une mise à jour ». |

### Remplir l'app avec son compte

Inutile de tout saisir à la main :

- **Le compte complet** (persos, niveaux, traces, reliques, cônes, matériaux) : avec l'outil gratuit
  [Reliquary Archiver](https://github.com/IceDynamix/reliquary-archiver).
  Soit en important le fichier qu'il produit, soit en le laissant tourner pendant la partie : l'app se met alors à jour en direct.
- **Suivre l'amélioration d'une relique en direct** : lancer Reliquary Archiver avant le jeu, cliquer sur « Import en direct » et attendre l'état « connecté »,
  puis garder la fiche du perso ouverte sur l'onglet Reliques. À chaque amélioration en jeu d'une pièce listée dans « À monter »,
  ses chances se mettent à jour aussitôt, avec un verdict : ça vaut le coup de continuer, ou plus le coup.
- **Pendant l'événement Aléas et reliques (Relic Recon)** : l'onglet Reliques de la fiche d'un perso (possédé ou non) indique les sets à choisir
  dans l'événement, ce qu'une ouverture Garantie apporterait à chaque emplacement et combien de Garanties sont utiles pour ce perso.
  Avec l'import en direct, chaque pièce tirée d'un coffre (ou échangée avec « Remplacer par la nouvelle relique ») y apparaît aussitôt, avec un verdict : à équiper, ou pas meilleure.
  Quand Prydwen n'a pas encore de conseil pour le perso, les sets sont déduits des pièces reçues, et le profil de reliques se choisit en haut de l'onglet Reliques, même pour un perso non possédé.
- **L'historique des vœux** : ouvrir l'historique des vœux dans le jeu, puis cliquer sur « Détection auto » dans l'onglet Vœux.
  L'app retrouve le lien toute seule dans le cache du jeu.

### D'où viennent les informations

- **Données du jeu** (persos, matériaux, coûts, images) : le dépôt communautaire StarRailRes.
  L'app vérifie s'il y a du nouveau toutes les 6 heures et se met à jour seule après une mise à jour du jeu.
- **Actus** : uniquement les annonces officielles de HoYoverse sur HoYoLAB. Pas de fuites.
- **Conseils de cônes et de reliques** : le site Prydwen.
- **Estimations** : l'EXP par palier, le rendement du farm et le modèle de pity sont des estimations,
  pas des valeurs officielles.

**Paramètres → Statut des données** indique l'âge de chaque source et si la dernière vérification a réussi, avec un bouton **Vérifier maintenant**.
Un repère **Hors ligne** apparaît en haut quand une source n'a pas pu être jointe.

### Où sont les données ?

Dans `%APPDATA%\fr.hsrcompanion.desktop\` sur le PC. Rien n'est envoyé ailleurs.
Pour changer de PC : **Paramètres → Exporter**, puis **Importer** sur l'autre PC.

L'app garde aussi des copies de la sauvegarde : une par jour, et une juste avant chaque import, remise à zéro ou mise à jour de l'app (les 5 dernières de chaque). En cas de problème : **Paramètres → Copies de la sauvegarde**, puis **Restaurer** à côté de la copie voulue.

### Pour les développeurs

Il faut Node.js, Rust et (sous Windows) les Visual Studio Build Tools.

```bash
npm install
npm run dev     # lance l'app en mode développement (Paramètres affiche « Version de développement »)
npm test        # tests JavaScript + tests Rust
npm run build   # crée l'installateur Windows
npm run build:dev  # crée un .exe de développement dans release/dev/ (Paramètres affiche « Version de développement »)
```

Les tests tournent aussi sur GitHub (onglet Actions) après chaque push sur `master` et à chaque pull request.

Publier une version (mainteneur seulement, il faut la clé privée de signature) : changer la version dans
`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` et `package.json`, puis lancer
`npm run release -- --notes "Nouveautés"` et envoyer les 3 fichiers de `release/v<version>/` dans une release GitHub
avec le tag `v<version>`.

### Licence

Code sous licence [MIT](LICENSE). Honkai: Star Rail, ses personnages et ses images
appartiennent à HoYoverse.
