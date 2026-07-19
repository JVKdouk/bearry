import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "src/models",
  migrations: {
    path: "core/database/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
