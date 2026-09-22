CREATE TABLE "AiConfiguration" ("id" TEXT NOT NULL PRIMARY KEY, "revision" INTEGER NOT NULL DEFAULT 1, "payload" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL);
CREATE TABLE "AiJob" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "kind" TEXT NOT NULL, "state" TEXT NOT NULL DEFAULT 'pending', "requestKey" TEXT NOT NULL, "input" TEXT NOT NULL, "result" TEXT, "errorCode" TEXT, "attempts" INTEGER NOT NULL DEFAULT 0, "leaseOwner" TEXT, "leaseUntil" DATETIME, "cancelRequested" BOOLEAN NOT NULL DEFAULT false, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, "expiresAt" DATETIME NOT NULL);
CREATE UNIQUE INDEX "AiJob_userId_requestKey_key" ON "AiJob"("userId","requestKey");
CREATE INDEX "AiJob_state_createdAt_idx" ON "AiJob"("state","createdAt");
CREATE INDEX "AiJob_userId_createdAt_idx" ON "AiJob"("userId","createdAt");
CREATE TABLE "AiAttempt" ("id" TEXT NOT NULL PRIMARY KEY, "jobId" TEXT NOT NULL, "modelId" TEXT NOT NULL, "state" TEXT NOT NULL, "errorCode" TEXT, "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" DATETIME, CONSTRAINT "AiAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AiJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE TABLE "AiWorkerLease" ("id" TEXT NOT NULL PRIMARY KEY,"owner" TEXT NOT NULL,"until" DATETIME NOT NULL);
CREATE TABLE "AiCooldown" ("id" TEXT NOT NULL PRIMARY KEY,"until" DATETIME NOT NULL);
