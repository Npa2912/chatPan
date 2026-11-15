import "dotenv/config";
import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
const require = createRequire(import.meta.url);
const runtime = await import("@prisma/schema-engine-wasm/schema_engine_bg");
const wasmBytes = await readFile(
  new URL(
    "schema_engine_bg.wasm",
    import.meta.resolve("@prisma/schema-engine-wasm"),
  ),
);
const wasmInstance = await WebAssembly.instantiate(wasmBytes, {
  "./schema_engine_bg.js": runtime,
});
runtime.__wbg_set_wasm(wasmInstance.instance.exports);
wasmInstance.instance.exports.__wbindgen_start();
const { bindSqlAdapterFactory } = require("@prisma/driver-adapter-utils");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const datamodel = await readFile("prisma/schema.prisma", "utf8");
const engine = await runtime.SchemaEngine.new(
  { datamodels: [["prisma/schema.prisma", datamodel]] },
  () => {},
  bindSqlAdapterFactory(new PrismaPg(pool)),
);
const filters = { externalTables: [], externalEnums: [] };
try {
  const dirs = (await readdir("prisma/migrations", { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const migrations = await Promise.all(
    dirs.map(async (path) => ({
      path,
      migrationFile: {
        path: "migration.sql",
        content: {
          tag: "ok",
          value: await readFile(
            `prisma/migrations/${path}/migration.sql`,
            "utf8",
          ),
        },
      },
    })),
  );
  console.log(
    await engine.applyMigrations({
      migrationsList: {
        baseDir: process.cwd() + "/prisma/migrations",
        shadowDbInitScript: "",
        lockfile: {
          path: "migration_lock.toml",
          content: await readFile(
            "prisma/migrations/migration_lock.toml",
            "utf8",
          ),
        },
        migrationDirectories: migrations,
      },
      filters,
    }),
  );
} finally {
  engine.free();
  await pool.end();
}
