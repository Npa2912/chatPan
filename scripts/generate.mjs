// Use Prisma's npm-distributed WASM/compiler and official generator; no native engine download.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { getGenerators } = require("@prisma/internals");
const { PrismaClientJsGenerator } = require("@prisma/client-generator-js");
const generators = await getGenerators({
  schemaPath: "prisma/schema.prisma",
  registry: {
    "prisma-client-js": {
      type: "in-process",
      generator: new PrismaClientJsGenerator({
        cliCommand: "npm run db:generate",
      }),
    },
  },
  skipDownload: true,
  cliCommand: "npm run db:generate",
});
try {
  for (const generator of generators) await generator.generate();
} finally {
  for (const generator of generators) generator.stop();
}
