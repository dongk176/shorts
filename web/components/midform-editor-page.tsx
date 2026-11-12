"use client";

import { useCallback } from "react";
import { MidformWorkspace } from "./midform-workspace";

export function MidformEditorPage({ projectNumber, shortId }: { projectNumber: number; shortId: string }) {
  const close = useCallback(() => { window.location.href = "/projects"; }, []);
  return <MidformWorkspace active cloudShortId={shortId} projectNumber={projectNumber} onClose={close} />;
}
