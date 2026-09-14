/**
 * TypeScript demo: reading everything an OpenApiUpgradeError carries.
 */

import {
  OpenApiUpgradeError,
  upgradeOasTo32,
  type OpenApiDocument,
  type UpgradedDocument,
} from "../dist/index.js";

const describeFailure = (error: OpenApiUpgradeError): string => {
  const lines = [`upgrade failed: ${error.message}`];

  if (error.issues.length > 0) {
    lines.push(`${error.issues.length} validation issue(s):`);
    for (const issue of error.issues) {
      lines.push(`  - ${issue.message ?? JSON.stringify(issue)}`);
    }
  }

  if (error.cause instanceof Error) {
    lines.push(`caused by ${error.cause.name}: ${error.cause.message}`);
  } else if (error.cause !== undefined) {
    lines.push(`caused by: ${String(error.cause)}`);
  }

  return lines.join("\n");
};

/**
 * Turns a failed upgrade into a message a human can act on.
 *
 * The two failure modes are already distinguishable without re-validating:
 * a populated `issues` array means the input document itself was rejected,
 * while a bare `cause` means the input could not even be parsed.
 */
export const upgradeWithDiagnosis = async (
  document: OpenApiDocument | string,
): Promise<UpgradedDocument> => {
  try {
    return await upgradeOasTo32(document);
  } catch (error) {
    if (!(error instanceof OpenApiUpgradeError)) {
      throw error;
    }
    throw new Error(describeFailure(error), { cause: error });
  }
};

/* -------------------------------------------------------------------------- */
/* Demo entry point                                                           */
/* -------------------------------------------------------------------------- */

// "info" is required, so this is rejected before either upgrader runs.
const invalidDocument = {
  openapi: "3.1.0",
  paths: {},
} as unknown as OpenApiDocument;

const unparseableDocument = "openapi: [3.1.0\ninfo: {";

const goodDocument = {
  swagger: "2.0",
  info: { title: "Legacy API", version: "1.0.0" },
  paths: {},
} as unknown as OpenApiDocument;

const runDemo = async (): Promise<void> => {
  console.log("--- case 1: a document that fails validation ---");
  try {
    await upgradeWithDiagnosis(invalidDocument);
    console.log("unexpectedly succeeded");
  } catch (error) {
    console.log(error instanceof Error ? error.message : String(error));
  }

  console.log("\n--- case 2: text that cannot be parsed at all ---");
  try {
    await upgradeWithDiagnosis(unparseableDocument);
    console.log("unexpectedly succeeded");
  } catch (error) {
    console.log(error instanceof Error ? error.message : String(error));
  }

  console.log("\n--- case 3: a Swagger 2.0 document that upgrades cleanly ---");
  const upgraded = await upgradeWithDiagnosis(goodDocument);
  console.log("openapi:", upgraded.openapi);
};

runDemo().catch((error: unknown) => {
  console.error("demo crashed:", error);
  process.exitCode = 1;
});
