/**
 * Invariants of the encryption layer (§5.1, §5.8).
 *
 * These are the properties the whole security model rests on: ciphertext can't
 * be moved between users/fields/rows, tampering is detected, and a wrapped DEK
 * is useless under the wrong KEK. They are pure functions, so there is no excuse
 * for them to be untested.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { seal, open, pack, unpack, sealToString, openFromString, randomBytes, KEY_BYTES } from "@/src/lib/crypto/aead";
import { encryptRecord, decryptRecord } from "@/src/lib/crypto/fieldCrypto";
import { loadKek, wrapDek, unwrapDek, beginKekRotation } from "@/src/lib/crypto/kek";

const key = randomBytes(KEY_BYTES);

test("seal/open round-trips", () => {
  const sealed = seal(key, Buffer.from("hello"));
  assert.equal(open(key, sealed).toString(), "hello");
});

test("open fails under a different key", () => {
  const sealed = seal(key, Buffer.from("hello"));
  assert.throws(() => open(randomBytes(KEY_BYTES), sealed));
});

test("tampering with ciphertext is detected", () => {
  const sealed = seal(key, Buffer.from("transfer 100"));
  sealed.ciphertext[0] ^= 0xff;
  assert.throws(() => open(key, sealed));
});

test("AAD binds a ciphertext to its context", () => {
  const sealed = seal(key, Buffer.from("secret"), Buffer.from("user-a:Todo:title"));
  // Right key, wrong context -> must not open.
  assert.throws(() => open(key, sealed, Buffer.from("user-b:Todo:title")));
  assert.equal(open(key, sealed, Buffer.from("user-a:Todo:title")).toString(), "secret");
});

test("pack/unpack preserves the sealed value", () => {
  const sealed = seal(key, Buffer.from("payload"));
  const reopened = unpack(pack(sealed));
  assert.equal(open(key, reopened).toString(), "payload");
});

test("unpack rejects a truncated buffer", () => {
  assert.throws(() => unpack(Buffer.alloc(4)));
});

test("nonces are never reused across seals", () => {
  const nonces = new Set<string>();
  for (let i = 0; i < 500; i++) nonces.add(seal(key, Buffer.from("x")).nonce.toString("hex"));
  assert.equal(nonces.size, 500);
});

test("field encryption seals the mapped fields and round-trips", () => {
  const row = { title: "Dentist", body: "bring card", estimatedDuration: 30 };
  const enc = encryptRecord("Block", "user-1", key, row);
  assert.notEqual(enc.title, "Dentist"); // actually encrypted
  assert.equal(enc.estimatedDuration, 30); // non-sensitive field untouched
  const dec = decryptRecord("Block", "user-1", key, enc);
  assert.equal(dec.title, "Dentist");
  assert.equal(dec.body, "bring card");
});

test("a field ciphertext cannot be replayed onto another user", () => {
  const enc = encryptRecord("Block", "user-1", key, { title: "Private" });
  assert.throws(() => decryptRecord("Block", "user-2", key, enc));
});

test("a field ciphertext cannot be replayed onto another field", () => {
  // The AAD binds the field name as well as the model, which is what stops a
  // title being lifted into the body column — and is also why merging three
  // tables needed every row re-sealed rather than just moved.
  const enc = encryptRecord("Block", "user-1", key, { title: "Private" });
  assert.throws(() => decryptRecord("Block", "user-1", key, { body: enc.title }));
});

test("a field ciphertext cannot be opened under a different model", () => {
  // This is the exact failure the blocks migration had to design around: rows
  // sealed as Todo could not be read as Block until they were re-sealed.
  const enc = encryptRecord("Block", "user-1", key, { title: "Private" });
  assert.throws(() => decryptRecord("Project", "user-1", key, { name: enc.title }));
});

test("null and undefined fields pass through unencrypted", () => {
  const enc = encryptRecord("Block", "user-1", key, { title: null, body: undefined });
  assert.equal(enc.title, null);
  assert.equal(enc.body, undefined);
});

test("DEK wrap/unwrap round-trips and is bound to the user", () => {
  loadKek(randomBytes(KEY_BYTES));
  const dek = randomBytes(KEY_BYTES);
  const wrapped = wrapDek(dek, "user-1");
  assert.deepEqual(unwrapDek(wrapped, "user-1"), dek);
  assert.throws(() => unwrapDek(wrapped, "user-2"));
});

test("KEK rotation re-wraps DEKs without changing them", () => {
  loadKek(randomBytes(KEY_BYTES));
  const dek = randomBytes(KEY_BYTES);
  const oldWrapped = wrapDek(dek, "user-1");

  const rewrap = beginKekRotation(randomBytes(KEY_BYTES));
  const newWrapped = rewrap(oldWrapped, "user-1");

  assert.notEqual(oldWrapped, newWrapped); // stored form changed
  assert.deepEqual(unwrapDek(newWrapped, "user-1"), dek); // key material did not
  // The pre-rotation blob is now useless — this is what makes break-glass work.
  assert.throws(() => unwrapDek(oldWrapped, "user-1"));
});

test("two XOR shares reconstruct a KEK that neither share alone yields", () => {
  const a = randomBytes(KEY_BYTES);
  const b = randomBytes(KEY_BYTES);
  loadKek(a, b);
  const dek = randomBytes(KEY_BYTES);
  const wrapped = wrapDek(dek, "user-1");

  loadKek(a); // share A alone
  assert.throws(() => unwrapDek(wrapped, "user-1"));

  loadKek(a, b);
  assert.deepEqual(unwrapDek(wrapped, "user-1"), dek);
});

test("sealToString/openFromString round-trip through base64", () => {
  const aad = Buffer.from("ctx");
  assert.equal(openFromString(key, sealToString(key, "café ☕", aad), aad), "café ☕");
});
