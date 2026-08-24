import { templateConfigSchema, type CustomTemplate, type TemplateSnapshot } from "@/lib/template-config";
import type { TemplateId } from "@/lib/contracts";
import type { Row } from "postgres";

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function customTemplateFromRow(row: Row): CustomTemplate {
  return {
    id: String(row.id),
    name: String(row.name),
    baseTemplateId: String(row.baseTemplateId) as TemplateId,
    config: templateConfigSchema.parse(row.config),
    version: Number(row.version),
    createdAt: iso(row.createdAt as Date | string),
    updatedAt: iso(row.updatedAt as Date | string),
  };
}

export function templateSnapshotFromRow(row: Row): TemplateSnapshot {
  return {
    id: String(row.id),
    name: String(row.name),
    baseTemplateId: String(row.baseTemplateId) as TemplateId,
    config: templateConfigSchema.parse(row.config),
    version: Number(row.version),
  };
}
