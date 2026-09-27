import type {Prisma} from "@prisma/client";
import {isAccountExpired} from "./policy";
import {UserManagementError} from "./errors";
/** Recheck authority in the same transaction as the mutation, after slow body/hash work. */
export async function assertAdminActor(tx: Prisma.TransactionClient, id: string, expectedVersion?: number, now = new Date()) {
 const actor = await tx.user.findUnique({where: {id}, select: {role: true, isActive: true, expiresAt: true, mustChangePassword: true, sessionVersion: true}});
 if (!actor || actor.role !== "admin" || !actor.isActive || actor.mustChangePassword || isAccountExpired(actor, now) || (expectedVersion !== undefined && actor.sessionVersion !== expectedVersion)) {
  throw new UserManagementError("ADMIN_AUTHORIZATION_REVOKED", 403);
 }
}
