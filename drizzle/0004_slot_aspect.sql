ALTER TABLE `slots` ADD `aspect` real;--> statement-breakpoint
UPDATE `slots` SET `aspect` = (SELECT CAST(`media`.`width` AS real) / `media`.`height` FROM `media` WHERE `media`.`id` = `slots`.`media_id` AND `media`.`width` > 0 AND `media`.`height` > 0) WHERE `media_id` IS NOT NULL;
