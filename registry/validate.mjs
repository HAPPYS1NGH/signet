import Ajv from "ajv-draft-04";
import { readFileSync } from "fs";
import { resolve } from "path";

// Fetch the official ERC-7730 v1 schema
const schemaUrl =
  "https://eips.ethereum.org/assets/eip-7730/erc7730-v1.schema.json";
const schemaRes = await fetch(schemaUrl);
if (!schemaRes.ok) {
  console.error(`Failed to fetch schema: ${schemaRes.status}`);
  process.exit(1);
}
const rawSchema = await schemaRes.text();

// The schema uses numeric `id` fields in definitions which ajv cannot process.
// Replace all `"id": <number>` occurrences with a string equivalent so ajv can
// resolve $ref pointers without crashing on `.replace()`.
const fixedSchema = rawSchema.replace(/"id"\s*:\s*(\d+)/g, '"id": "def-$1"');
const schema = JSON.parse(fixedSchema);

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

const files = [
  "jaw/eip712-jaw-useroperation.json",
  "jaw/calldata-jaw-permissions-manager.json",
  "jaw/calldata-jaw-account.json",
];

let allValid = true;

for (const file of files) {
  const fullPath = resolve("registry", file);
  const metadata = JSON.parse(readFileSync(fullPath, "utf-8"));
  const valid = validate(metadata);

  if (valid) {
    console.log(`\u2705 ${file} — valid`);
  } else {
    console.error(`\u274c ${file} — INVALID`);
    for (const err of validate.errors ?? []) {
      console.error(`   ${err.instancePath || "/"}: ${err.message}`);
      if (err.params) console.error(`     params:`, JSON.stringify(err.params));
    }
    allValid = false;
  }
}

console.log();
if (allValid) {
  console.log("All files valid against ERC-7730 v1 JSON schema.");
} else {
  console.error("Some files failed validation.");
  process.exit(1);
}