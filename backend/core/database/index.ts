import { PrismaClient } from "../../.generated";
import { PrismaPg } from "@prisma/adapter-pg";
import { CONFIG } from "../config";

const adapter = new PrismaPg({
  connectionString: CONFIG.DATABASE_URL,
});

// Hot reload can cause Prisma to spawn multiple DB instances. The
// conditional checks below allow for setting a single global prisma instance
const globalForPrisma = globalThis as unknown as { database: PrismaClient };
export const database =
  globalForPrisma.database || new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.database = database;
export default database;
