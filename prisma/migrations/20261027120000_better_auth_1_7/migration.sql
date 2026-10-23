-- Phase 40.1: Better Auth 1.7.
--
-- 1. Microsoft accounts. Better Auth 1.7's Microsoft provider keys an account on the directory
--    object id (the `oid` claim) instead of the pairwise `sub` that 1.6 stored as `accountId`.
--    A row left on `sub` isn't found at sign-in, and with implicit linking off that person is
--    locked out, so every Microsoft row is rewritten here or the migration fails. The `oid`
--    comes from the ID token Better Auth stored at that sign-in (plaintext, server-side, from
--    the token endpoint over TLS: the same provenance lib/active-profile.ts relies on to read
--    role claims). SQL can't re-verify its signature; the source is trusted.
--    If this fails on "has no ID token with an oid": delete that person's `user` row (its
--    sessions and accounts go with it; their Person stays) and run it again; their next
--    Microsoft sign-in links them afresh. See docs/BUILD.md Phase 40.1a.

-- BEGIN jwt_claim (lib/better-auth-migration.db.test.ts runs this function on test tokens)
-- A token that isn't a well-formed JWT reads as having no claim, so it reaches the clear error
-- below rather than failing on a decoding error.
CREATE FUNCTION pg_temp.jwt_claim(token text, claim text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN convert_from(
    decode(
      translate(split_part(token, '.', 2), '-_', '+/')
        || repeat('=', (4 - length(split_part(token, '.', 2)) % 4) % 4),
      'base64'
    ),
    'UTF8'
  )::jsonb ->> claim;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END
$$;
-- END jwt_claim

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "account"
    WHERE "providerId" = 'microsoft'
      AND ("idToken" IS NULL OR pg_temp.jwt_claim("idToken", 'oid') IS NULL)
  ) THEN
    RAISE EXCEPTION 'Better Auth 1.7 upgrade: a Microsoft account has no ID token with an oid. See docs/BUILD.md Phase 40.1.';
  END IF;
END $$;

UPDATE "account"
SET "accountId" = pg_temp.jwt_claim("idToken", 'oid')
WHERE "providerId" = 'microsoft';

-- 2. One row per sign-in identity: Better Auth 1.7 refuses a lookup that matches two. Fails
--    here, loudly, if any pair is already duplicated.
CREATE UNIQUE INDEX "account_providerId_accountId_key" ON "account"("providerId", "accountId");

-- 3. Every passkey ceremony looks its challenge up by identifier.
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- 4. Passkeys (@better-auth/passkey). Public keys only.
CREATE TABLE "passkey" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "publicKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialID" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL,
    "transports" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "aaguid" TEXT,
    CONSTRAINT "passkey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "passkey_credentialID_key" ON "passkey"("credentialID");
CREATE INDEX "passkey_userId_idx" ON "passkey"("userId");
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
