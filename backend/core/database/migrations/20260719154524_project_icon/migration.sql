-- A single emoji per list.
--
-- Cleartext, unlike the name: an icon carries no content, and keeping it
-- readable is what lets the sidebar draw a list without a decryption
-- round-trip. Nullable rather than defaulted — every existing list would
-- otherwise acquire an icon nobody chose.
ALTER TABLE "projects" ADD COLUMN "icon" TEXT;
