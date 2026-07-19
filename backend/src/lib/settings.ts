// Thin helpers over the Setting key/value model (calm-mode, digest opt-ins, etc).
import database from "@/core/database";

export async function getSetting(userId: string, key: string): Promise<string | null> {
  const row = await database.setting.findUnique({ where: { userId_key: { userId, key } } });
  // A tombstoned setting reads as unset — otherwise deleting a consent flag
  // would leave it silently in force.
  if (!row || row.deletedAt) return null;
  return row.value;
}

export async function setSetting(userId: string, key: string, value: string): Promise<void> {
  await database.setting.upsert({
    where: { userId_key: { userId, key } },
    create: { userId, key, value },
    update: { value, deletedAt: null }, // re-setting revives a tombstoned key
  });
}

export async function isOn(userId: string, key: string): Promise<boolean> {
  return (await getSetting(userId, key)) === "on";
}
