-- Province-level division (省、自治区、直辖市) of a photo's location, for the map's province → city → county albums.
-- Docs: /docs/data/photos.md
-- NULL: not looked up yet (or the lookup failed); '' : looked up, no province there. The hourly region job fills both
-- this and a missing city or district from the reverse geocode, see /docs/architecture/cloudflare.md#定时任务.
ALTER TABLE photos ADD COLUMN province TEXT;
-- The rows the region job still has to visit; once filled, a row leaves this index.
CREATE INDEX IF NOT EXISTS photos_region_todo ON photos(id) WHERE province IS NULL;
