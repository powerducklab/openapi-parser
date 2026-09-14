import { upgradeOasTo32 } from "../dist/index.js";

const show = async (label, input) => {
  try {
    const doc = await upgradeOasTo32(input);
    console.log(`${label.padEnd(22)} -> ${doc.openapi}`);
    return doc;
  } catch (error) {
    console.log(`${label.padEnd(22)} -> ${error.message}`);
    if (error.issues?.length) {
      console.log(`${" ".repeat(25)}${error.issues.length} issue(s) attached`);
    }
    return undefined;
  }
};

const info = { title: "Petstore", version: "1.0.0" };
const paths = {
  "/pets": {
    get: {
      responses: { 200: { description: "ok" } },
    },
  },
};

console.log("--- parsed objects ---");
await show("swagger 2.0", { swagger: "2.0", info, paths });
await show("openapi 3.0.3", { openapi: "3.0.3", info, paths });
await show("openapi 3.1.0", { openapi: "3.1.0", info, paths });
await show("openapi 3.2.0", { openapi: "3.2.0", info, paths });

console.log("\n--- YAML text ---");
await show(
  "swagger 2.0 yaml",
  [
    'swagger: "2.0"',
    "info:",
    "  title: Petstore",
    '  version: "1.0.0"',
    "paths:",
    "  /pets:",
    "    get:",
    "      responses:",
    '        "200":',
    "          description: ok",
  ].join("\n"),
);
await show(
  "openapi 3.1.0 yaml",
  [
    'openapi: "3.1.0"',
    "info:",
    "  title: Petstore",
    '  version: "1.0.0"',
    "paths: {}",
  ].join("\n"),
);

console.log("\n--- JSON text ---");
await show(
  "openapi 3.0.3 json",
  JSON.stringify({ openapi: "3.0.3", info, paths }),
);

console.log("\n--- rejected inputs ---");
await show("no version field", { info, paths });
await show("openapi 4.0.0", { openapi: "4.0.0", info, paths });
await show("broken yaml", "openapi: [3.1.0\ninfo: {");

console.log("\n--- inspecting a result ---");
const doc = await show("for inspection", { openapi: "3.0.3", info, paths });
if (doc) {
  console.log(`title:     ${doc.info.title}`);
  console.log(`operation: ${Object.keys(doc.paths["/pets"]).join(", ")}`);
}
