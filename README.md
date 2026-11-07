# HSR Companion

Une application de bureau Windows pour les joueurs de **Honkai: Star Rail**.
Elle réunit au même endroit ce qu'on cherche d'habitude sur plusieurs sites :
ses persos, ce qu'il reste à farmer, ses vœux, ses reliques, ses équipes et les actus du jeu.

> Application de fan non officielle, sans lien avec HoYoverse. Tout reste sur ton PC.

## Ce que fait l'app

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

## Remplir l'app avec ton compte

Tu n'es pas obligé de tout saisir à la main :

- **Ton compte complet** (persos, niveaux, traces, reliques, cônes, matériaux) : avec l'outil gratuit
  [Reliquary Archiver](https://github.com/IceDynamix/reliquary-archiver).
  Soit tu importes le fichier qu'il produit, soit tu le laisses tourner pendant que tu joues et l'app se met à jour en direct.
- **Ton historique de vœux** : ouvre l'historique des vœux dans le jeu, puis clique sur « Détection auto » dans l'onglet Vœux.
  L'app retrouve le lien toute seule dans le cache du jeu.

## D'où viennent les informations

- **Données du jeu** (persos, matériaux, coûts, images) : le dépôt communautaire StarRailRes.
  L'app vérifie s'il y a du nouveau toutes les 6 heures et se met à jour seule après une mise à jour du jeu.
- **Actus** : uniquement les annonces officielles de HoYoverse sur HoYoLAB. Pas de fuites.
- **Conseils de cônes et de reliques** : le site Prydwen.
- **Estimations** : l'EXP par palier, le rendement du farm et le modèle de pity sont des estimations,
  pas des valeurs officielles.

## Où sont mes données ?

Dans `%APPDATA%\fr.hsrcompanion.desktop\` sur ton PC. Rien n'est envoyé ailleurs.
Pour changer de PC : **Paramètres → Exporter**, puis **Importer** sur l'autre PC.

## Pour les développeurs

Il faut Node.js, Rust et (sous Windows) les Visual Studio Build Tools.

```bash
npm install
npm run dev     # lance l'app en mode développement
npm test        # tests JavaScript + tests Rust
npm run build   # crée l'installateur Windows
```

## Licence

Code sous licence [MIT](LICENSE). Honkai: Star Rail, ses personnages et ses images
appartiennent à HoYoverse.
