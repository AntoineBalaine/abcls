import * as fs from "fs";
import * as path from "path";
import * as libxml from "libxmljs2";

const SCHEMA_PATH = path.join(__dirname, "..", "schema", "musicxml.xsd");

let cachedSchema: libxml.Document | undefined;

function getSchema(): libxml.Document {
  if (!cachedSchema) {
    cachedSchema = libxml.parseXml(fs.readFileSync(SCHEMA_PATH, "utf8"), { baseUrl: SCHEMA_PATH, net: false } as never);
  }
  return cachedSchema;
}

export interface XsdValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateAgainstMusicXmlSchema(xml: string): XsdValidationResult {
  const doc = libxml.parseXml(xml, { net: false } as never);
  const valid = doc.validate(getSchema());
  const errors = (doc.validationErrors ?? []).map((e) => e.message.trim()).filter((message) => !message.includes("Skipping import of schema"));
  return { valid: valid && errors.length === 0, errors };
}
