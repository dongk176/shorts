export const uploadMessages: Record<string, string>;
export class UploadFailure extends Error {
  constructor(code: string, stage: string, status?: number | null, reason?: string | null);
  code: string; stage: string; status: number | null; reason: string | null;
}
export function providerFailure(response: Response, stage: string): Promise<UploadFailure>;
export function uploadDiagnostic(error: unknown, stage: string): {code: string; stage: string; status: number | null; reason: string | null; message: string};
