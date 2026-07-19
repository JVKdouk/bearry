/**
 * Decrypt audit log (§5.4) — append-only.
 *
 * Every DEK unwrap and every batch decrypt writes a row: who (actor/session),
 * for whom (user), how much (record count), and the request context. Mass
 * exfiltration becomes *visible*. The table is append-only by convention (no
 * update/delete endpoints touch it) and is shipped off-box in production so a DB
 * wipe can't erase the evidence — here we best-effort mirror it to the debug log
 * sink as the off-box stand-in.
 */

import database from "@/core/database";
import { WinstonLogger } from "@/core/logging/winston";

export type AuditAction = "dek_unwrap" | "batch_decrypt";

export type AuditEntry = {
  userId: string;
  actorSessionId: string;
  action: AuditAction;
  recordCount: number;
  requestContext?: string;
};

/**
 * Append an audit row. Best-effort and non-blocking: an audit-sink failure must
 * never take down a user request, but it is loudly logged. The off-box mirror
 * (WinstonLogger → logs/debug.log, a separate sink from Postgres) means the
 * evidence survives a DB wipe.
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  // Off-box mirror first — cheap and survives a DB compromise.
  WinstonLogger.log(
    "debug",
    `AUDIT ${entry.action} actor=${entry.actorSessionId} user=${entry.userId} n=${entry.recordCount} ctx=${entry.requestContext ?? "-"}`,
  );

  try {
    await database.auditLog.create({
      data: {
        userId: entry.userId,
        actorSessionId: entry.actorSessionId,
        action: entry.action,
        recordCount: entry.recordCount,
        requestContext: entry.requestContext ?? null,
      },
    });
  } catch (err) {
    // Never fail the request on an audit-write error, but make it loud.
    console.error("Audit log write failed", err);
  }
}
