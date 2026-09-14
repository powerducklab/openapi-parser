import { describe, expect, it } from "vitest";

import { OpenApiUpgradeError, upgradeOasTo32 } from "../src/index.js";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const captureRejection = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    (value) => {
      throw new Error(
        `expected a rejection, but the promise fulfilled with ${String(value)}`,
      );
    },
    (reason: unknown) => reason,
  );

const expectUpgradeError = (
  error: unknown,
): InstanceType<typeof OpenApiUpgradeError> => {
  if (!(error instanceof OpenApiUpgradeError)) {
    throw new Error(`expected OpenApiUpgradeError, received: ${String(error)}`);
  }
  return error;
};

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const swagger20 = {
  swagger: "2.0",
  info: { title: "Legacy API", version: "1.0.0" },
  host: "example.com",
  basePath: "/v1",
  schemes: ["https"],
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        produces: ["application/json"],
        parameters: [
          { name: "limit", in: "query", type: "integer", required: false },
        ],
        responses: {
          "200": { description: "ok", schema: { $ref: "#/definitions/Pet" } },
        },
      },
    },
  },
  definitions: {
    Pet: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "integer" }, name: { type: "string" } },
    },
  },
};

const oas30 = {
  openapi: "3.0.3",
  info: { title: "Old API", version: "1.0.0" },
  servers: [{ url: "https://example.com/v1" }],
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Pet" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: "object",
        nullable: true,
        properties: { id: { type: "integer", format: "int64" } },
      },
    },
  },
};

const oas31 = {
  openapi: "3.1.0",
  info: { title: "Current API", version: "1.0.0" },
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        responses: { "200": { description: "ok" } },
      },
    },
  },
};

const oas32 = {
  openapi: "3.2.0",
  info: { title: "Target API", version: "1.0.0" },
  paths: {},
};

/* -------------------------------------------------------------------------- */
/* Parsed objects                                                             */
/* -------------------------------------------------------------------------- */

describe("upgradeOasTo32 — parsed objects", () => {
  it.each([
    ["Swagger 2.0", swagger20],
    ["OpenAPI 3.0.3", oas30],
    ["OpenAPI 3.1.0", oas31],
    ["OpenAPI 3.2.0", oas32],
  ])("upgrades %s to 3.2", async (_label, document) => {
    const result = await upgradeOasTo32(structuredClone(document) as never);
    expect(result.openapi).toMatch(/^3\.2/);
  });

  it("preserves info across the upgrade", async () => {
    const result = await upgradeOasTo32(structuredClone(swagger20) as never);
    expect(result.info.title).toBe("Legacy API");
    expect(result.info.version).toBe("1.0.0");
  });

  it("keeps operations reachable after upgrading from 2.0", async () => {
    const result = await upgradeOasTo32(structuredClone(swagger20) as never);
    expect(result.paths?.["/pets"]?.get?.operationId).toBe("listPets");
  });

  it("turns the 2.0 host/basePath/schemes triple into servers", async () => {
    const result = await upgradeOasTo32(structuredClone(swagger20) as never);
    expect(result.servers?.[0]?.url).toContain("example.com");
  });

  it("moves 2.0 definitions into components.schemas", async () => {
    const result = await upgradeOasTo32(structuredClone(swagger20) as never);
    expect(result.components?.schemas?.Pet).toBeDefined();
  });

  it("rewrites 3.0 nullable into a type union", async () => {
    const result = await upgradeOasTo32(structuredClone(oas30) as never);
    const pet = result.components?.schemas?.Pet as Record<string, unknown>;
    expect(pet.nullable).toBeUndefined();
    expect(pet.type).toEqual(expect.arrayContaining(["object", "null"]));
  });

  it("does not modify the caller's document (zero input mutation)", async () => {
    // The library deep-copies the input before passing it to upstream
    // upgraders, so the caller's original object is never mutated.
    const input = structuredClone(oas30);
    const snapshot = structuredClone(input);
    await upgradeOasTo32(input as never);
    expect(input).toEqual(snapshot);
  });

  it("is idempotent when its own output is fed back in", async () => {
    const once = await upgradeOasTo32(structuredClone(oas30) as never);
    const twice = await upgradeOasTo32(structuredClone(once) as never);
    expect(twice).toEqual(once);
  });
});

/* -------------------------------------------------------------------------- */
/* YAML input                                                                 */
/* -------------------------------------------------------------------------- */

describe("upgradeOasTo32 — YAML input", () => {
  const yaml20 = `
swagger: "2.0"
info:
  title: YAML Legacy
  version: 1.0.0
host: example.com
basePath: /v1
schemes:
  - https
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        "200":
          description: ok
`;

  const yaml31 = `
openapi: 3.1.0
info:
  title: YAML Current
  version: 1.0.0
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        "200":
          description: ok
`;

  it("upgrades a Swagger 2.0 YAML string", async () => {
    const result = await upgradeOasTo32(yaml20);
    expect(result.openapi).toMatch(/^3\.2/);
    expect(result.info.title).toBe("YAML Legacy");
  });

  it("upgrades a 3.1 YAML string", async () => {
    const result = await upgradeOasTo32(yaml31);
    expect(result.openapi).toMatch(/^3\.2/);
    expect(result.info.title).toBe("YAML Current");
  });

  it("tolerates a leading document separator", async () => {
    const result = await upgradeOasTo32(`---\n${yaml31.trim()}\n`);
    expect(result.openapi).toMatch(/^3\.2/);
  });

  it("tolerates CRLF line endings", async () => {
    const result = await upgradeOasTo32(yaml31.replace(/\n/g, "\r\n"));
    expect(result.openapi).toMatch(/^3\.2/);
  });

  it("rejects structurally broken YAML", async () => {
    const error = await captureRejection(
      upgradeOasTo32("openapi: 3.1.0\n  info:\n bad: [unclosed"),
    );
    expectUpgradeError(error);
  });

  it("rejects an empty string", async () => {
    expectUpgradeError(await captureRejection(upgradeOasTo32("")));
  });

  it("rejects a whitespace-only string", async () => {
    expectUpgradeError(await captureRejection(upgradeOasTo32("   \n\t  ")));
  });

  it("rejects YAML that parses to a scalar", async () => {
    expectUpgradeError(await captureRejection(upgradeOasTo32("just a string")));
  });

  it("rejects YAML that parses to a list", async () => {
    expectUpgradeError(await captureRejection(upgradeOasTo32("- a\n- b\n")));
  });
});

/* -------------------------------------------------------------------------- */
/* JSON input                                                                 */
/* -------------------------------------------------------------------------- */

describe("upgradeOasTo32 — JSON input", () => {
  it("upgrades a 3.0 JSON string", async () => {
    const result = await upgradeOasTo32(JSON.stringify(oas30));
    expect(result.openapi).toMatch(/^3\.2/);
    expect(result.info.title).toBe("Old API");
  });

  it("upgrades a Swagger 2.0 JSON string", async () => {
    const result = await upgradeOasTo32(JSON.stringify(swagger20));
    expect(result.openapi).toMatch(/^3\.2/);
  });

  it("produces the same result from a JSON string and the parsed object", async () => {
    const fromText = await upgradeOasTo32(JSON.stringify(oas30));
    const fromObject = await upgradeOasTo32(structuredClone(oas30) as never);
    expect(fromText).toEqual(fromObject);
  });

  it("accepts pretty-printed JSON", async () => {
    const result = await upgradeOasTo32(JSON.stringify(oas31, null, 2));
    expect(result.openapi).toMatch(/^3\.2/);
  });

  it("rejects truncated JSON", async () => {
    const error = await captureRejection(
      upgradeOasTo32('{"openapi": "3.1.0", "info": {'),
    );
    expectUpgradeError(error);
  });

  it("rejects a JSON array", async () => {
    expectUpgradeError(await captureRejection(upgradeOasTo32("[]")));
  });

  it("rejects a JSON null literal", async () => {
    expectUpgradeError(await captureRejection(upgradeOasTo32("null")));
  });
});

/* -------------------------------------------------------------------------- */
/* Rejected documents                                                         */
/* -------------------------------------------------------------------------- */

describe("upgradeOasTo32 — rejected documents", () => {
  it("rejects a document with no version field", async () => {
    const error = expectUpgradeError(
      await captureRejection(
        upgradeOasTo32({
          info: { title: "x", version: "1" },
          paths: {},
        } as never),
      ),
    );
    expect(error.message).toContain("not a valid OpenAPI document");
    expect(error.issues.length).toBeGreaterThan(0);
  });

  it("rejects an unsupported major version", async () => {
    const error = expectUpgradeError(
      await captureRejection(
        upgradeOasTo32({ ...oas31, openapi: "4.0.0" } as never),
      ),
    );
    expect(error.issues.length).toBeGreaterThan(0);
  });

  it("rejects Swagger 1.2", async () => {
    expectUpgradeError(
      await captureRejection(
        upgradeOasTo32({ swagger: "1.2", info: {} } as never),
      ),
    );
  });

  it("rejects a non-string version", async () => {
    expectUpgradeError(
      await captureRejection(upgradeOasTo32({ openapi: 3.1 } as never)),
    );
  });

  it("rejects an empty object", async () => {
    expectUpgradeError(await captureRejection(upgradeOasTo32({} as never)));
  });

  it("rejects null", async () => {
    expectUpgradeError(await captureRejection(upgradeOasTo32(null as never)));
  });

  it("rejects undefined", async () => {
    expectUpgradeError(
      await captureRejection(upgradeOasTo32(undefined as never)),
    );
  });

  it("rejects a number", async () => {
    expectUpgradeError(await captureRejection(upgradeOasTo32(3.2 as never)));
  });

  it("always fails with OpenApiUpgradeError, never a raw upstream error", async () => {
    const inputs = [null, undefined, 42, "", "[]", {}, { openapi: "4.0.0" }];
    for (const input of inputs) {
      const error = await captureRejection(upgradeOasTo32(input as never));
      expect(error).toBeInstanceOf(OpenApiUpgradeError);
    }
  });
});
