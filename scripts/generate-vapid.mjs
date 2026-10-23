// Prints a fresh VAPID key pair for phone push (Phase 21.6). Paste the lines into .env.
// Changing these later means every phone has to turn phone alerts on again.
import { createECDH } from "node:crypto";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
console.log(`VAPID_PUBLIC_KEY="${ecdh.getPublicKey().toString("base64url")}"`);
// Node drops leading zero bytes; pad to the 32 bytes VAPID expects.
const d = ecdh.getPrivateKey();
console.log(`VAPID_PRIVATE_KEY="${Buffer.concat([Buffer.alloc(32 - d.length), d]).toString("base64url")}"`);
console.log('VAPID_SUBJECT="mailto:you@example.com"  # change to a real address');
