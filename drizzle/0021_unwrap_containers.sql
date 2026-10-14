-- 0021 (v0.19) : migration de CONTENU seulement (aucune colonne) : le conteneur « Projet mis en avant »
-- (featured-project) disparaît. Chaque conteneur, dans les pages publiées, les brouillons et les conteneurs
-- imbriqués, est « déballé » : ses composants deviennent des blocs de premier niveau, à la même place et dans le
-- même ordre ; le projet du conteneur est porté en dur par la Planche et le Titre lié, le lien « voir plus »
-- devient un bloc « Lien vers une page ». Jouée par src/lib/db/unwrap.ts (unwrapContainers) juste après ce
-- fichier (src/lib/db/bootstrap.ts, DATA_MIGRATIONS), dans la même transaction.
SELECT 1;
