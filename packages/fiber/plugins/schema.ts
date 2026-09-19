/**
 * Schema generation helpers for fiberPlugin.
 *
 *   src/domains/schema.ts  →  src/.generated/schema.ts   (runtime module)
 *                          →  src/migrations/schema.sql  (derived SQL)
 *                          →  src/domains/db-types.d.ts  (model types)
 */

import { dirname, join } from "path";
import { createHash } from "node:crypto";
import { writeFile, mkdir, unlink, rename } from "node:fs/promises";
import { build as esbuild } from "esbuild";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { generateDbTypesContent, type SchemaDef } from "../src/schema";
import { serializeSchemaDef, serializeSchemaSql } from "../src/schema/serialize";
import type { ResolvedFiberPaths } from "./options";

/**
 * Load the app's schema module: bundle the TS source (resolving the
 * spindlework import to the framework DSL) and execute it for the
 * SchemaDef.
 */
export async function loadSchemaModule(
  projectRoot: string,
  schemaPath: string,
): Promise<SchemaDef> {
  const result = await esbuild({
    entryPoints: [schemaPath],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
  });

  const code = result.outputFiles[0].text;
  const tmpFile = join(
    tmpdir(),
    `spindlework-schema-${createHash("sha1").update(schemaPath).digest("hex").slice(0, 12)}-${Date.now()}.mjs`,
  );
  await writeFile(tmpFile, code, "utf-8");
  try {
    const mod = (await import(pathToFileURL(tmpFile).href)) as {
      schema: SchemaDef;
    };
    return mod.schema;
  } finally {
    // Clean up the temp file best-effort (may still be referenced in dev).
    await unlink(tmpFile).catch(() => {});
  }
}

/**
 * Write the runtime schema module — the first output of the fiber pipeline,
 * because the seed spec imports it and sql type inference reads it.
 */
export async function writeRuntimeSchema(
  paths: ResolvedFiberPaths,
  schema: SchemaDef,
): Promise<void> {
  await mkdir(dirname(paths.runtimeSchemaPath), { recursive: true });
  // Write atomically: Vite may scan this module while it is being generated,
  // and a half-written file would be read as empty / "no exports".
  const tmpPath = `${paths.runtimeSchemaPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, serializeSchemaDef(schema), "utf-8");
  await rename(tmpPath, paths.runtimeSchemaPath);
}

/**
 * Write the derived schema.sql and the model types — the latter typed with
 * literal lookup-row unions from the seed spec (checkRef columns).
 */
export async function writeSchemaOutputs(
  paths: ResolvedFiberPaths,
  schema: SchemaDef,
  lookups: Map<string, Record<string, unknown>[]>,
): Promise<void> {
  await mkdir(dirname(paths.schemaSqlPath), { recursive: true });
  await writeFile(paths.schemaSqlPath, serializeSchemaSql(schema), "utf-8");

  await mkdir(dirname(paths.dbTypesPath), { recursive: true });
  await writeFile(
    paths.dbTypesPath,
    generateDbTypesContent(schema, paths.tableNameOverrides, lookups),
    "utf-8",
  );
}