import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EdgeOneCredentialField = "secretId" | "secretKey";

type CredentialEnvelopeV1 = {
  version: 1;
  algorithm: "AES-256-GCM";
  iv: string;
  ciphertext: string;
  authTag: string;
};

const credentialEnvelopeVersion = 1;
const ivLength = 12;
const authTagLength = 16;

export class EdgeOneCredentialEncryptionUnavailableError extends Error {
  readonly code = "EDGEONE_CREDENTIAL_ENCRYPTION_UNAVAILABLE";

  constructor() {
    super("EdgeOne credential encryption is unavailable");
    this.name = "EdgeOneCredentialEncryptionUnavailableError";
  }
}

export class EdgeOneCredentialDecryptionError extends Error {
  readonly code = "EDGEONE_CREDENTIAL_DECRYPTION_FAILED";

  constructor() {
    super("EdgeOne credential ciphertext could not be authenticated");
    this.name = "EdgeOneCredentialDecryptionError";
  }
}

export function requireEdgeOneCredentialEncryptionKey(key: Buffer | null | undefined) {
  if (!key || key.byteLength !== 32) {
    throw new EdgeOneCredentialEncryptionUnavailableError();
  }
  return key;
}

function additionalAuthenticatedData(field: EdgeOneCredentialField) {
  return Buffer.from(
    `event-arts:system-config:edgeone:v${credentialEnvelopeVersion}:${field}`,
    "utf8"
  );
}

function encodeBase64Url(value: Buffer) {
  return value.toString("base64url");
}

function decodeCanonicalBase64Url(value: unknown, expectedLength?: number) {
  if (typeof value !== "string" || !value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new EdgeOneCredentialDecryptionError();
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.toString("base64url") !== value ||
    (expectedLength !== undefined && decoded.byteLength !== expectedLength)
  ) {
    throw new EdgeOneCredentialDecryptionError();
  }
  return decoded;
}

function parseEnvelope(value: string): CredentialEnvelopeV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new EdgeOneCredentialDecryptionError();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new EdgeOneCredentialDecryptionError();
  }
  const envelope = parsed as Record<string, unknown>;
  if (
    Object.keys(envelope).length !== 5 ||
    envelope.version !== credentialEnvelopeVersion ||
    envelope.algorithm !== "AES-256-GCM" ||
    typeof envelope.iv !== "string" ||
    typeof envelope.ciphertext !== "string" ||
    typeof envelope.authTag !== "string"
  ) {
    throw new EdgeOneCredentialDecryptionError();
  }
  return envelope as CredentialEnvelopeV1;
}

export function encryptEdgeOneCredential(
  plaintext: string,
  field: EdgeOneCredentialField,
  encryptionKey: Buffer | null | undefined
) {
  const key = requireEdgeOneCredentialEncryptionKey(encryptionKey);
  if (!plaintext) throw new EdgeOneCredentialEncryptionUnavailableError();

  const iv = randomBytes(ivLength);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength });
  cipher.setAAD(additionalAuthenticatedData(field));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const envelope: CredentialEnvelopeV1 = {
    version: credentialEnvelopeVersion,
    algorithm: "AES-256-GCM",
    iv: encodeBase64Url(iv),
    ciphertext: encodeBase64Url(ciphertext),
    authTag: encodeBase64Url(cipher.getAuthTag())
  };
  return JSON.stringify(envelope);
}

export function decryptEdgeOneCredential(
  value: string,
  field: EdgeOneCredentialField,
  encryptionKey: Buffer | null | undefined
) {
  const key = requireEdgeOneCredentialEncryptionKey(encryptionKey);
  try {
    const envelope = parseEnvelope(value);
    const iv = decodeCanonicalBase64Url(envelope.iv, ivLength);
    const ciphertext = decodeCanonicalBase64Url(envelope.ciphertext);
    const authTag = decodeCanonicalBase64Url(envelope.authTag, authTagLength);
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength });
    decipher.setAAD(additionalAuthenticatedData(field));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof EdgeOneCredentialEncryptionUnavailableError) throw error;
    throw new EdgeOneCredentialDecryptionError();
  }
}
