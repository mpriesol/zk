import { randomBytes, createECDH } from "node:crypto";
const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
console.log("BETTER_AUTH_SECRET=" + randomBytes(48).toString("base64url"));
console.log("VAPID_PUBLIC_KEY=" + ecdh.getPublicKey().toString("base64url"));
console.log("VAPID_PRIVATE_KEY=" + ecdh.getPrivateKey().toString("base64url"));
