-- Additive only: legacy users remain permanent and existing registration stays opt-in.
ALTER TABLE "User" ADD COLUMN "expiresAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "User" ADD COLUMN "aiAccessInitialized" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "User_expiresAt_idx" ON "User"("expiresAt");
CREATE TABLE "RegistrationSettings" (
 "id" TEXT NOT NULL PRIMARY KEY, "enabled" BOOLEAN NOT NULL DEFAULT false,
 "inviteRequired" BOOLEAN NOT NULL DEFAULT false, "defaultExpirationDays" INTEGER DEFAULT 7,
 "inviteDefaultLifetimeDays" INTEGER NOT NULL DEFAULT 30, "inviteDisplayEnabled" BOOLEAN NOT NULL DEFAULT false,
 "displayedInviteId" TEXT, "revision" INTEGER NOT NULL DEFAULT 1, "updatedAt" DATETIME NOT NULL
);
CREATE TABLE "InvitationCode" (
 "id" TEXT NOT NULL PRIMARY KEY, "codeHash" TEXT NOT NULL, "encryptedCode" TEXT NOT NULL,
 "maxUses" INTEGER NOT NULL DEFAULT 1, "usedCount" INTEGER NOT NULL DEFAULT 0,
 "expiresAt" DATETIME NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true,
 "revision" INTEGER NOT NULL DEFAULT 1, "createdById" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "InvitationCode_codeHash_key" ON "InvitationCode"("codeHash");
CREATE INDEX "InvitationCode_expiresAt_enabled_idx" ON "InvitationCode"("expiresAt", "enabled");
CREATE TABLE "InvitationUse" (
 "userId" TEXT NOT NULL PRIMARY KEY, "inviteId" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 FOREIGN KEY("inviteId") REFERENCES "InvitationCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "AuthRateLimit" ("key" TEXT NOT NULL PRIMARY KEY, "count" INTEGER NOT NULL DEFAULT 0, "windowEnd" DATETIME NOT NULL);
CREATE INDEX "AuthRateLimit_windowEnd_idx" ON "AuthRateLimit"("windowEnd");
CREATE TABLE "UserAuditEvent" ("id" TEXT NOT NULL PRIMARY KEY, "actorId" TEXT, "targetId" TEXT, "action" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "AiAccessPolicy" ("id" TEXT NOT NULL PRIMARY KEY, "revision" INTEGER NOT NULL DEFAULT 1, "initialized" BOOLEAN NOT NULL DEFAULT false);
CREATE TABLE "AiSiteModelAccess" ("modelId" TEXT NOT NULL PRIMARY KEY, "fingerprint" TEXT NOT NULL, "isAllowed" BOOLEAN NOT NULL DEFAULT true, "defaultRank" INTEGER, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL);
CREATE TABLE "AiUserModelGrant" (
 "userId" TEXT NOT NULL, "modelId" TEXT NOT NULL, "source" TEXT NOT NULL, "rank" INTEGER, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY("userId","modelId"),
 FOREIGN KEY("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 FOREIGN KEY("modelId") REFERENCES "AiSiteModelAccess"("modelId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "UserAiConfiguration" (
 "userId" TEXT NOT NULL PRIMARY KEY, "revision" INTEGER NOT NULL DEFAULT 1, "payload" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
 FOREIGN KEY("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
