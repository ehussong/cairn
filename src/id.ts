export function encodeId(parts: string[]): string {
  return parts.map(encodePart).join(":");
}

export function decodeId(id: string): string[] {
  return id.split(":").map(decodePart);
}

function encodePart(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodePart(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}
