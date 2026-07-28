export const PROJECT_EDIT_REFRESH_STORAGE_KEY = "easycut:project-edit-refresh:v1";

export type ProjectEditRefreshSignal = {
  projectNumber: number;
  shortId: string;
  appliedAt: number;
};

export function createProjectEditRefreshSignal(
  projectNumber: number,
  shortId: string,
  appliedAt = Date.now(),
) {
  return JSON.stringify({ projectNumber, shortId, appliedAt });
}

export function parseProjectEditRefreshSignal(
  value: string | null,
): ProjectEditRefreshSignal | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ProjectEditRefreshSignal>;
    if (
      !Number.isInteger(parsed.projectNumber)
      || Number(parsed.projectNumber) <= 0
      || typeof parsed.shortId !== "string"
      || parsed.shortId.trim().length === 0
      || typeof parsed.appliedAt !== "number"
      || !Number.isFinite(parsed.appliedAt)
    ) {
      return null;
    }
    return {
      projectNumber: Number(parsed.projectNumber),
      shortId: parsed.shortId,
      appliedAt: parsed.appliedAt,
    };
  } catch {
    return null;
  }
}
