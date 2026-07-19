import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";
import { requestCrypto } from "@/src/lib/crypto/requestCrypto";

/** Projects with open-todo counts, for the Lists tab (§8.1, §8.5). */
const listProjects: Endpoint = async (request) => {
  const rows = await database.project.findMany({
    where: { userId: request.user.id, deletedAt: null },
    orderBy: { order: "asc" },
  });

  const counts = await database.block.groupBy({
    by: ["projectId"],
    where: { userId: request.user.id, deletedAt: null, status: { not: "done" } },
    _count: { _all: true },
  });
  const countByProject = new Map(counts.map((c: { projectId: string | null; _count: { _all: number } }) => [c.projectId, c._count._all]));

  const crypto = await requestCrypto(request, Math.max(rows.length, 1));
  const projects = crypto.decryptMany("Project", rows as Record<string, unknown>[]).map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    order: p.order,
    archived: p.archived,
    openTodoCount: countByProject.get(p.id as string) ?? 0,
  }));

  return { projects };
};

listProjects.httpMethod = "GET";
listProjects.path = "/";

export default listProjects;
