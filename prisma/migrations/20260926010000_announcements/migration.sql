-- Additive only: never rebuild or reset learning/configuration tables.
CREATE TABLE "Announcement" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "titleZh" TEXT NOT NULL, "bodyZh" TEXT NOT NULL,
 "titleEn" TEXT NOT NULL DEFAULT '', "bodyEn" TEXT NOT NULL DEFAULT '',
 "href" TEXT NOT NULL DEFAULT '', "status" TEXT NOT NULL DEFAULT 'draft',
 "pinned" BOOLEAN NOT NULL DEFAULT false, "pinOrder" INTEGER NOT NULL DEFAULT 0,
 "readPolicy" TEXT NOT NULL DEFAULT 'keep', "startsAt" DATETIME, "endsAt" DATETIME,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
);
CREATE TABLE "AnnouncementRead" (
 "announcementId" TEXT NOT NULL, "userId" TEXT NOT NULL,
 "readAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("announcementId", "userId"),
 CONSTRAINT "AnnouncementRead_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "AnnouncementRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Announcement_status_pinned_pinOrder_createdAt_idx" ON "Announcement"("status", "pinned", "pinOrder", "createdAt");
CREATE INDEX "AnnouncementRead_userId_readAt_idx" ON "AnnouncementRead"("userId", "readAt");
-- Replace the former hard-coded notices once. Admin edits are never re-seeded on restart.
INSERT INTO "Announcement" ("id","titleZh","bodyZh","titleEn","bodyEn","href","status","readPolicy","updatedAt") VALUES
('welcome-solving-records','解题记录有了独立入口','会话与直接解题受理即记录、长期保留。同题追问归入同一会话，是否存入错题本另行决定。','Solving records have their own home','Conversations and direct solves are recorded on acceptance and retained long-term. Follow-ups stay in the same conversation; notebook storage is a separate choice.','/solving-records','published','keep',CURRENT_TIMESTAMP),
('notice-check-answers','完成不等于答对','请核对识图文字、答案和辅助线示意。统计中心分别统计解题记录、复习练习和已记录AI调用，不混算正确率。','Completion is not correctness','Check recognized text, answers and auxiliary diagrams yourself. Statistics distinguish solving records, review practice and recorded AI attempts.','/stats','published','persistent',CURRENT_TIMESTAMP),
('notice-full-backup','完整备份不只是JSON','错题本JSON导出不含解题会话、公告及已阅状态，完整备份需配对数据库、配置及原秘密变量。绘图等临时任务仍在24小时后过期。','Back up more than notebook JSON','Notebook JSON excludes solving records, announcements and read receipts. Preserve the database, configuration and original secrets together. Temporary drawing tasks still expire after 24 hours.','/release-notes','published','persistent',CURRENT_TIMESTAMP);
