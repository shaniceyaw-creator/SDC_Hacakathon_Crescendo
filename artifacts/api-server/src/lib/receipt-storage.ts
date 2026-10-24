import { Storage } from "@google-cloud/storage";

// Replit's standard sidecar credentials. No static cloud key is stored in this app.
const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const client = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export function receiptFile(eventId: string, receiptId: string) {
  const dir = process.env.PRIVATE_OBJECT_DIR;
  if (!dir) throw new Error("Receipt storage is not configured.");
  const parts = dir.replace(/^\/+|\/+$/g, "").split("/");
  const bucket = parts.shift()!;
  return client.bucket(bucket).file([...parts, "opus-receipts", eventId, receiptId].join("/"));
}
