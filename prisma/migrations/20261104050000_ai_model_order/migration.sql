-- Preferences contain model IDs only. Existing accounts retain their current fallback order.
ALTER TABLE "User" ADD COLUMN "aiModelOrder" TEXT;
ALTER TABLE "User" ADD COLUMN "aiOrderRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiAccessPolicy" ADD COLUMN "defaultOrder" TEXT;
