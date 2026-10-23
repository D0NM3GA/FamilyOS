import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";

/**
 * Phase 40.1c, for tests only: a tiny software passkey ("none" attestation, ES256) that answers
 * WebAuthn registration and sign-in challenges the way a device would, so the passkey flows can
 * be tested end to end without a browser. `userVerified: false` makes it skip the device's own
 * lock, which the app must refuse.
 */

type CborValue = number | string | Uint8Array | Map<CborValue, CborValue> | { [key: string]: CborValue };

function head(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 0x100) return Buffer.from([(major << 5) | 24, length]);
  if (length < 0x10000) return Buffer.from([(major << 5) | 25, length >> 8, length & 0xff]);
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(length, 1);
  return b;
}

/** Just enough CBOR for an attestation object and a COSE key. */
export function cbor(value: CborValue): Buffer {
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === "string") {
    const s = Buffer.from(value, "utf8");
    return Buffer.concat([head(3, s.length), s]);
  }
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), Buffer.from(value)]);
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)])]);
}

const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest();

const UP = 0x01;
const UV = 0x04;
const AT = 0x40;

export class SoftAuthenticator {
  readonly credentialId = randomBytes(32);
  private readonly key: KeyObject;
  private readonly publicKey: KeyObject;
  private counter = 0;

  constructor(
    private readonly rpID: string,
    private readonly origin: string,
  ) {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.key = privateKey;
    this.publicKey = publicKey;
  }

  private coseKey(): Buffer {
    const jwk = this.publicKey.export({ format: "jwk" });
    return cbor(
      new Map<CborValue, CborValue>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(jwk.x!, "base64url")],
        [-3, Buffer.from(jwk.y!, "base64url")],
      ]),
    );
  }

  private clientData(type: "webauthn.create" | "webauthn.get", challenge: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }));
  }

  /** A registration response to `options` (what generate-register-options returned). */
  register(options: { challenge: string }, { userVerified = true } = {}) {
    const flags = UP | AT | (userVerified ? UV : 0);
    const counter = Buffer.alloc(4);
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([sha256(this.rpID), Buffer.from([flags]), counter, Buffer.alloc(16), idLength, this.credentialId, this.coseKey()]);
    const attestationObject = cbor({ fmt: "none", attStmt: {}, authData });
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: "public-key",
      response: {
        clientDataJSON: b64url(this.clientData("webauthn.create", options.challenge)),
        attestationObject: b64url(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  /** A sign-in response to `options` (what generate-authenticate-options returned). */
  signIn(options: { challenge: string }, { userVerified = true } = {}) {
    this.counter += 1;
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    const authenticatorData = Buffer.concat([sha256(this.rpID), Buffer.from([UP | (userVerified ? UV : 0)]), counter]);
    const clientDataJSON = this.clientData("webauthn.get", options.challenge);
    const signature = createSign("SHA256").update(Buffer.concat([authenticatorData, sha256(clientDataJSON)])).sign(this.key);
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authenticatorData),
        signature: b64url(signature),
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
}
