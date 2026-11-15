import {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
if (!existsSync(".env")) copyFileSync(".env.example", ".env");
const content = readFileSync(".env", "utf8");
const existing = content.match(/^AUTH_SECRET=(.*)$/m)?.[1]?.trim();
if (process.env.AUTH_SECRET) {
  if (process.env.AUTH_SECRET.length < 32)
    throw new Error(
      "Injected AUTH_SECRET must contain at least 32 characters.",
    );
} else if (existing) {
  if (existing.length < 32)
    throw new Error(
      "Existing AUTH_SECRET is too short; update it securely. The file was preserved.",
    );
} else {
  const line = `AUTH_SECRET=${randomBytes(48).toString("hex")}`;
  writeFileSync(
    ".env",
    /^AUTH_SECRET=.*$/m.test(content)
      ? content.replace(/^AUTH_SECRET=.*$/m, line)
      : content + "\n" + line + "\n",
    { mode: 0o600 },
  );
}
chmodSync(".env", 0o600);
console.log(
  "Local environment file prepared; secret values are not displayed.",
);
