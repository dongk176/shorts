export async function startProjectDownload(projectNumber: number, signal: AbortSignal) {
  const url = `/api/projects/${encodeURIComponent(projectNumber)}/download`;
  const response = await fetch(url, { method: "HEAD", cache: "no-store", signal });
  if (!response.ok) return response.status;
  const count = Number(response.headers.get("X-Shorts-Count"));
  if (!Number.isSafeInteger(count) || count <= 0) return 503;
  signal.throwIfAborted();
  // One same-origin attachment avoids competing navigations and the browser's
  // automatic-multiple-download restriction. Video bytes stay out of JS memory.
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `easycut-project-${projectNumber}.zip`;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
  return response.status;
}
