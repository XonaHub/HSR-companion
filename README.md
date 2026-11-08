# HSR Companion

**English** · [Français](#français)

A Windows desktop app for **Honkai: Star Rail** players.
It brings together in one place what you usually look up on several websites:
your characters, what's left to farm, your warps, your relics, your teams and the game's news.

> Unofficial fan app, not affiliated with HoYoverse. Everything stays on your PC.

## What the app does

The app has 8 tabs:

| Tab | What it's for |
|---|---|
| **Today** | Opens on every launch: the character you're farming and the time left, your available warps, the current banner, the next version, the next endgame mode to start a new cycle and the latest news. |
| **Characters** | Every character in the game, the ones you own, and your light cones. Click a character to open their sheet: abilities, traces, eidolons, recommended light cones, relic review, materials. The + button in the corner adds them to your characters (− removes them). |
| **Farming** | Pick a character and a target level; the app tells you what you're missing (taking your inventory into account) and how many days of energy it takes. |
| **Warps** | Your Stellar Jade, your passes and your pity. A simulator gives your odds of getting a character or a light cone with what you have. The estimate of your upcoming warps counts the jades from new endgame cycles, based on what you usually earn in each mode. You can import your warp history. |
| **Relics** | All your relics, graded from S to D based on the character type (crit, break, healer…). Each character's review is on their sheet. |
| **Teams** | Build teams for Memory of Chaos, Pure Fiction and Apocalyptic Shadow, with tips (no healer, too many DPS…). |
| **News** | Official announcements grouped by version: banners, events, how many warps you can earn during the version, and the current cycle of each endgame mode (Memory of Chaos, Pure Fiction, Apocalyptic Shadow, Anomaly Arbitration) with the date of the next one. |
| **Settings** | Language (French / English), game server (endgame reset times depend on it; detected automatically from your UID), farming yield, backup and restore of your data. |

## Fill the app with your account

You don't have to enter everything by hand:

- **Your whole account** (characters, levels, traces, relics, light cones, materials): with the free tool
  [Reliquary Archiver](https://github.com/IceDynamix/reliquary-archiver).
  Either import the file it produces, or leave it running while you play and the app updates live.
- **Your warp history**: open the warp history in the game, then click "Auto-detect" in the Warps tab.
  The app finds the link by itself in the game's cache.

## Where the information comes from

- **Game data** (characters, materials, costs, images): the community repository StarRailRes.
  The app checks for updates every 6 hours and updates itself after a game update.
- **News**: only HoYoverse's official announcements on HoYoLAB. No leaks.
- **Light cone and relic recommendations**: the Prydwen website.
- **Estimates**: EXP per level bracket, farming yield and the pity model are estimates,
  not official values.

## Where is my data?

In `%APPDATA%\fr.hsrcompanion.desktop\` on your PC. Nothing is sent anywhere else.
To move to another PC: **Settings → Export**, then **Import** on the other PC.

## For developers

You need Node.js, Rust and (on Windows) the Visual Studio Build Tools.

```bash
npm install
npm run dev     # runs the app in development mode
npm test        # JavaScript + Rust tests
npm run build   # builds the Windows installer
```

## License

Code under the [MIT](LICENSE) license. Honkai: Star Rail, its characters and its images
belong to HoYoverse.

---

## Français

[English](#hsr-companion) · **Français**

Une application de bureau Windows pour les joueurs de **Honkai: Star Rail**.
Elle réunit au même endroit ce qu'on cherche d'habitude sur plusieurs sites :
ses persos, ce qu'il reste à farmer, ses vœux, ses reliques, ses équipes et les actus du jeu.

> Application de fan non officielle, sans lien avec HoYoverse. Tout reste sur ton PC.

### Ce que fait l'app

L'app a 8 onglets :

| Onglet | À quoi il sert |
|---|---|
| **Aujourd'hui** | Ouvert à chaque lancement : le perso que tu farmes et le temps qu'il reste, tes vœux disponibles, la bannière en cours, la prochaine version, le prochain mode d'endgame qui change de cycle et la dernière actu. |
| **Personnages** | Tous les persos du jeu, ceux que tu possèdes, et tes cônes de lumière. Clique sur un perso pour ouvrir sa fiche : compétences, traces, eidolons, cônes conseillés, bilan des reliques, matériaux. Le bouton + en coin l'ajoute à tes persos (− pour le retirer). |
| **Farm** | Tu choisis un perso et le niveau visé ; l'app dit ce qu'il te manque (en tenant compte de ton inventaire) et combien de jours d'énergie il faut. |
| **Vœux** | Tes jades, tes passes et ton pity. Un simulateur te donne tes chances d'avoir un perso ou un cône avec ce que tu as. L'estimation de tes vœux à venir compte les jades des nouveaux cycles d'endgame, selon ce que tu obtiens d'habitude dans chaque mode. Tu peux importer ton historique de vœux. |
| **Reliques** | Toutes tes reliques avec une note de S à D selon le type de perso (critique, rupture, soigneur…). Le bilan par perso est dans sa fiche. |
| **Équipes** | Composer des équipes pour la Mémoire du chaos, la Fiction pure et l'Ombre apocalyptique, avec des conseils (pas de soigneur, trop de DPS…). |
| **Actus** | Les annonces officielles regroupées par version : bannières, événements, combien de vœux on peut gagner pendant la version, et le cycle en cours de chaque mode d'endgame (Mémoire du chaos, Fiction pure, Ombre apocalyptique, Arbitre de l'instable) avec la date du suivant. |
| **Paramètres** | Langue (français / anglais), serveur du jeu (les heures de reset de l'endgame en dépendent ; trouvé tout seul d'après ton UID), rendement de farm, sauvegarde et restauration de tes données. |

### Remplir l'app avec ton compte

Tu n'es pas obligé de tout saisir à la main :

- **Ton compte complet** (persos, niveaux, traces, reliques, cônes, matériaux) : avec l'outil gratuit
  [Reliquary Archiver](https://github.com/IceDynamix/reliquary-archiver).
  Soit tu importes le fichier qu'il produit, soit tu le laisses tourner pendant que tu joues et l'app se met à jour en direct.
- **Ton historique de vœux** : ouvre l'historique des vœux dans le jeu, puis clique sur « Détection auto » dans l'onglet Vœux.
  L'app retrouve le lien toute seule dans le cache du jeu.

### D'où viennent les informations

- **Données du jeu** (persos, matériaux, coûts, images) : le dépôt communautaire StarRailRes.
  L'app vérifie s'il y a du nouveau toutes les 6 heures et se met à jour seule après une mise à jour du jeu.
- **Actus** : uniquement les annonces officielles de HoYoverse sur HoYoLAB. Pas de fuites.
- **Conseils de cônes et de reliques** : le site Prydwen.
- **Estimations** : l'EXP par palier, le rendement du farm et le modèle de pity sont des estimations,
  pas des valeurs officielles.

### Où sont mes données ?

Dans `%APPDATA%\fr.hsrcompanion.desktop\` sur ton PC. Rien n'est envoyé ailleurs.
Pour changer de PC : **Paramètres → Exporter**, puis **Importer** sur l'autre PC.

### Pour les développeurs

Il faut Node.js, Rust et (sous Windows) les Visual Studio Build Tools.

```bash
npm install
npm run dev     # lance l'app en mode développement
npm test        # tests JavaScript + tests Rust
npm run build   # crée l'installateur Windows
```

### Licence

Code sous licence [MIT](LICENSE). Honkai: Star Rail, ses personnages et ses images
appartiennent à HoYoverse.
