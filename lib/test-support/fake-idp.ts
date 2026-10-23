import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import type { AddressInfo } from "node:net";

/**
 * Test support for Phase 40.3: an OpenID Connect provider on 127.0.0.1, enough for Better Auth's
 * generic OAuth to discover it, exchange a code (checking PKCE) and verify the ID token it signs.
 * The test plays the person at the provider: `authorize(url, who)` reads what the app asked for
 * (state, nonce, PKCE challenge) and returns the code the provider would redirect back with.
 * `tamper` makes the next ID tokens wrong in one way each, for the tests that must be refused.
 */

export type IdpPerson = { sub: string; email: string; email_verified?: boolean; name?: string };

type Grant = { who: IdpPerson; nonce: string | null; challenge: string | null; redirectUri: string };

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString("base64url");
}

export class FakeIdp {
  url = "";
  readonly clientId = "familyos-test";
  readonly clientSecret = "test-secret";
  /** Make the next ID tokens wrong: another key, another audience or issuer, or another (or no) nonce. */
  tamper: { otherKey?: boolean; aud?: string; iss?: string; nonce?: string | null } = {};

  private server: Server | null = null;
  private readonly key: KeyObject;
  private readonly otherKey: KeyObject;
  private readonly publicJwk: Record<string, unknown>;
  private readonly kid = "test-key";
  private readonly grants = new Map<string, Grant>();
  private readonly tokens = new Map<string, IdpPerson>();

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    this.key = privateKey;
    this.publicJwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
    this.otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      this.handle(req, res).catch(() => {
        res.writeHead(500).end();
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
  }

  get discoveryUrl(): string {
    return `${this.url}/.well-known/openid-configuration`;
  }

  /** What the app last asked the provider for (prompt=login, say). */
  lastAuthorization: URLSearchParams | null = null;

  /** The person signs in at the provider: returns the code and state to come back with. */
  authorize(authorizationUrl: string, who: IdpPerson): { code: string; state: string } {
    const u = new URL(authorizationUrl);
    this.lastAuthorization = u.searchParams;
    if (u.searchParams.get("client_id") !== this.clientId) throw new Error("wrong client");
    const code = randomBytes(16).toString("hex");
    this.grants.set(code, {
      who,
      nonce: u.searchParams.get("nonce"),
      challenge: u.searchParams.get("code_challenge"),
      redirectUri: u.searchParams.get("redirect_uri") ?? "",
    });
    return { code, state: u.searchParams.get("state") ?? "" };
  }

  private idToken(g: Grant): string {
    const now = Math.floor(Date.now() / 1000);
    const nonce = "nonce" in this.tamper ? this.tamper.nonce : g.nonce;
    const payload: Record<string, unknown> = {
      iss: this.tamper.iss ?? this.url,
      aud: this.tamper.aud ?? this.clientId,
      sub: g.who.sub,
      email: g.who.email,
      name: g.who.name ?? g.who.email,
      iat: now,
      exp: now + 300,
      ...(g.who.email_verified === undefined ? {} : { email_verified: g.who.email_verified }),
      ...(nonce === null || nonce === undefined ? {} : { nonce }),
    };
    const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: this.kid }));
    const body = b64url(JSON.stringify(payload));
    const signature = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), this.tamper.otherKey ? this.otherKey : this.key);
    return `${head}.${body}.${b64url(signature)}`;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? "/", this.url).pathname;
    const json = (status: number, data: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(data));

    if (path === "/.well-known/openid-configuration") {
      return void json(200, {
        issuer: this.url,
        authorization_endpoint: `${this.url}/authorize`,
        token_endpoint: `${this.url}/token`,
        userinfo_endpoint: `${this.url}/userinfo`,
        jwks_uri: `${this.url}/jwks`,
        id_token_signing_alg_values_supported: ["RS256"],
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (path === "/jwks") return void json(200, { keys: [{ ...this.publicJwk, kid: this.kid, alg: "RS256", use: "sig" }] });

    if (path === "/token" && req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      // A confidential client: the secret comes in the form or as HTTP Basic.
      const basic = Buffer.from((req.headers.authorization ?? "").replace(/^Basic /, ""), "base64").toString("utf8");
      const secret = form.get("client_secret") ?? decodeURIComponent(basic.split(":")[1] ?? "");
      if (secret !== this.clientSecret) return void json(401, { error: "invalid_client" });
      const grant = this.grants.get(form.get("code") ?? "");
      if (!grant) return void json(400, { error: "invalid_grant" });
      this.grants.delete(form.get("code") ?? "");
      // PKCE: the verifier must hash to the challenge the authorization asked with.
      const verifier = form.get("code_verifier") ?? "";
      if (!grant.challenge || b64url(createHash("sha256").update(verifier).digest()) !== grant.challenge) return void json(400, { error: "invalid_grant" });
      if (form.get("redirect_uri") !== grant.redirectUri) return void json(400, { error: "invalid_grant" });
      const access = randomBytes(16).toString("hex");
      this.tokens.set(access, grant.who);
      return void json(200, { access_token: access, token_type: "Bearer", expires_in: 3600, id_token: this.idToken(grant) });
    }

    if (path === "/userinfo") {
      const who = this.tokens.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));
      if (!who) return void json(401, { error: "invalid_token" });
      return void json(200, { sub: who.sub, email: who.email, email_verified: who.email_verified, name: who.name ?? who.email });
    }
    res.writeHead(404).end();
  }
}
