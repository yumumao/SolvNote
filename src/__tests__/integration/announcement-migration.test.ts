// @vitest-environment node
import {it, expect} from "vitest";
import {PrismaClient} from "@prisma/client";
import {mkdtempSync, mkdirSync, cpSync, readdirSync, copyFileSync} from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
it("adds only notice tables, preserves every old table and does not re-seed edited notices", async () => {
    mkdirSync(".codex/tmp", {recursive: true});
    const dir = mkdtempSync(path.resolve(".codex/tmp/notice-upgrade-")), schemaDir = path.join(dir, "prisma");
    mkdirSync(path.join(schemaDir, "migrations"), {recursive: true});
    copyFileSync("prisma/schema.prisma", path.join(schemaDir, "schema.prisma"));
    const migration = "20260926010000_announcements";
    for (const entry of readdirSync("prisma/migrations")) if (entry !== migration)
        cpSync(path.join("prisma/migrations", entry), path.join(schemaDir, "migrations", entry), {recursive: true});
    const url = "file:" + path.join(dir, "fixture.db").replaceAll("\\", "/");
    const deploy = () => execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", path.join(schemaDir, "schema.prisma")], {env: {...process.env, DATABASE_URL: url}, windowsHide: true, stdio: "pipe"});
    deploy();
    const db = new PrismaClient({datasources: {db: {url}}});
    try {
        await db.user.create({data: {id: "fixture-user", email: "fixture@example.invalid", password: "synthetic-not-used"}});
        await db.subject.create({data: {id: "fixture-subject", name: "Synthetic", userId: "fixture-user"}});
        await db.aiConfiguration.create({data: {id: "site", payload: "synthetic-opaque-preserve-exactly"}});
        await db.aiConversation.create({data: {id: "fixture-conversation", userId: "fixture-user", payload: "synthetic-only"}});
        await db.aiJob.create({data: {id: "fixture-job", userId: "fixture-user", requestKey: "fixture", kind: "analyze", input: "synthetic-only", expiresAt: new Date("2099-01-01")}});
        const tables = (await db.$queryRaw<{name: string}[]>`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations'`).map(t => t.name).sort();
        const snapshot = async () => {
            const result: Record<string, unknown> = {};
            for (const table of tables) {
                if (!/^[A-Za-z_]+$/.test(table)) throw Error("UNEXPECTED_FIXTURE_TABLE");
                result[table] = await db.$queryRawUnsafe(`SELECT * FROM "${table}" ORDER BY rowid`);
            }
            return result;
        };
        const before = await snapshot();
        cpSync(path.join("prisma/migrations", migration), path.join(schemaDir, "migrations", migration), {recursive: true});
        deploy();expect(await snapshot()).toEqual(before);expect(await db.announcement.count()).toBe(3);
        expect(await db.announcementRead.count()).toBe(0);
        await db.announcement.update({where: {id: "welcome-solving-records"}, data: {titleZh: "管理员修改", status: "hidden"}});
        await db.announcementRead.create({data: {userId: "fixture-user", announcementId: "notice-check-answers"}});
        deploy();expect(await db.announcement.count()).toBe(3);expect(await db.announcementRead.count()).toBe(1);
        expect(await db.announcement.findUnique({where: {id: "welcome-solving-records"}})).toMatchObject({titleZh: "管理员修改", status: "hidden"});
        expect(await snapshot()).toEqual(before);
        expect(await db.$queryRaw`PRAGMA foreign_key_check`).toEqual([]);
    } finally {await db.$disconnect();}
}, 30000);
