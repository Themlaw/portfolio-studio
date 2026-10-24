-- 0030 (lot 75 « Une seule écriture media-look ») : migration de CONTENU seulement (aucune colonne) : l'habillage des places d'« Images qui
-- défilent » passe de cinq cartes par place (look.slotFrame, slotBg, slotRadius, slotPano, slotVideo) à une seule (look.slotLook[place]).
-- Jouée par src/lib/db/slot-look.ts (seedSlotLooks) juste après ce fichier (src/lib/db/bootstrap.ts, DATA_MIGRATIONS), dans la même
-- transaction. Le fichier lui-même ne fait rien : le journal des migrations n'exécute une migration de contenu qu'avec un fichier SQL.
SELECT 1;
