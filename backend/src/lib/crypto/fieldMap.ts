/**
 * The central field-map (§5.8): which model fields are sensitive and must be
 * transparently encrypted on write / decrypted on read. Everything not listed
 * here is cleartext structural metadata that stays queryable and indexable.
 *
 * Keeping this in one place (rather than per-model annotations scattered around)
 * makes the encrypted/cleartext boundary auditable at a glance — the exact
 * split the security review checks (§13 Phase 10).
 */

export const ENCRYPTED_FIELDS: Record<string, readonly string[]> = {
  Project: ["name"],
  Todo: ["title", "notes"],
  Note: ["title", "bodyMarkdown"],
  TaskStep: ["text"],
  CalendarEvent: ["title", "description", "location"],
  TimeBlock: ["label"],
  BlockRegion: ["label"],
  CaptureItem: ["rawContent", "extractedFields"],
  GoogleAccount: ["encryptedRefreshToken", "encryptedAccessToken"],
  Reminder: ["triggerSpec"],
  Template: ["name", "payload"],
  Integration: ["encryptedCredential"],
};

export function encryptedFieldsFor(model: string | undefined): readonly string[] {
  if (!model) return [];
  return ENCRYPTED_FIELDS[model] ?? [];
}
