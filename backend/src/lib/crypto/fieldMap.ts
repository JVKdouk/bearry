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
  /**
   * Tasks, events and notes are one model now. The three old entries
   * (`Todo: [title, notes]`, `CalendarEvent: [title, description, location]`,
   * `Note: [title, bodyMarkdown]`) named the same three kinds of content under
   * six different field names.
   *
   * Rows migrated from those tables were sealed under the old model names —
   * the AAD binds `userId:Model:field` — and were re-sealed as `Block` by
   * scripts/reseal-blocks.ts. Nothing here reads the old names, so a row that
   * somehow escaped that pass fails loudly rather than decoding to garbage.
   */
  Block: ["title", "body", "location"],
  TaskStep: ["text"],
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
