import type { Sql } from "postgres";
export const SHORT_EMBEDDING_MODEL: "text-embedding-3-small";
export const SHORT_EMBEDDING_DIMENSIONS: 768;
type EmbeddingResult = {vectors: number[][]; tokens: number};
export function createShortEmbeddings(inputs: string[], options?: {apiKey?: string; fetcher?: typeof fetch; timeoutMs?: number}): Promise<EmbeddingResult>;
export function indexShortVideoBatch(db: Sql, options?: {apiKey?: string; limit?: number; embed?: typeof createShortEmbeddings}): Promise<{claimed: number; saved: number; tokens: number; skipped?: string}>;
