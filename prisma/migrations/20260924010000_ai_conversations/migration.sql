CREATE TABLE "AiConversation" (
 "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'active', "revision" INTEGER NOT NULL DEFAULT 0,
 "roundsUsed" INTEGER NOT NULL DEFAULT 0, "roundLimit" INTEGER NOT NULL DEFAULT 10,
 "roundOpen" BOOLEAN NOT NULL DEFAULT true, "roundAttempts" INTEGER NOT NULL DEFAULT 0,
 "attemptLimit" INTEGER NOT NULL DEFAULT 6, "roundElapsedMs" INTEGER NOT NULL DEFAULT 0,
 "timeLimitMs" INTEGER NOT NULL DEFAULT 600000, "activeJobId" TEXT, "payload" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
 CONSTRAINT "AiConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AiConversation_userId_updatedAt_idx" ON "AiConversation"("userId", "updatedAt");
CREATE TABLE "AiConversationAction" (
 "id" TEXT NOT NULL PRIMARY KEY, "conversationId" TEXT NOT NULL, "requestKey" TEXT NOT NULL, "payload" TEXT NOT NULL,
 CONSTRAINT "AiConversationAction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AiConversationAction_conversationId_requestKey_key" ON "AiConversationAction"("conversationId", "requestKey");
CREATE TABLE "AiDialogueSettings" ("id" TEXT NOT NULL PRIMARY KEY, "defaultRounds" INTEGER NOT NULL DEFAULT 10, "revision" INTEGER NOT NULL DEFAULT 0);
ALTER TABLE "AiJob" ADD COLUMN "conversationId" TEXT REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiJob" ADD COLUMN "startedAt" DATETIME;
ALTER TABLE "AiAttempt" ADD COLUMN "metadata" TEXT;

CREATE INDEX "AiJob_conversationId_createdAt_idx" ON "AiJob"("conversationId", "createdAt");
