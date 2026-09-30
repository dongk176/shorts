export const UPDATE_PAGE_SIZE = 8;
export function updatePage(value: string | string[] | undefined, count: number) {
  const totalPages = Math.max(1, Math.ceil(Math.max(0, count - 1) / UPDATE_PAGE_SIZE));
  if (value === undefined) return { page: 1, totalPages };
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) && page <= totalPages ? { page, totalPages } : null;
}
