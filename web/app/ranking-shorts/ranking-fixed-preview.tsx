'use client';
import { useEffect } from 'react';

export function FixedPreview() {
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>('.ranking-refreshed');
    if (!shell) return;
    let workspace: HTMLElement | null = null;
    let frame = 0;
    const update = () => {
      frame = 0;
      const current = shell.querySelector<HTMLElement>('.ranking-workspace');
      if (current !== workspace) {
        if (workspace) resize.unobserve(workspace);
        workspace = current;
        if (workspace) resize.observe(workspace);
      }
      if (window.innerWidth <= 850 || !workspace?.isConnected) return;
      const rect = workspace.getBoundingClientRect();
      if (rect.width <= 0 || rect.right <= 0) return;
      const columns = getComputedStyle(workspace).gridTemplateColumns.split(' ');
      const columnWidth = parseFloat(columns[columns.length - 1]) || 320;
      const availableWidth = Math.min(columnWidth, (window.innerHeight - 190) * 9 / 16 + 25);
      const width = Math.max(150, (availableWidth - 25) * 0.9 + 25);
      shell.style.setProperty('--local-preview-width', `${width}px`);
      shell.style.setProperty('--local-preview-left', `${Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16))}px`);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const resize = new ResizeObserver(schedule);
    resize.observe(shell);
    // Draft loading or hot updates can replace the workspace. Never measure a detached node.
    const mutations = new MutationObserver(schedule);
    mutations.observe(shell, {childList: true, subtree: true});
    schedule();
    window.addEventListener('resize', schedule);
    return () => { cancelAnimationFrame(frame); mutations.disconnect(); resize.disconnect(); window.removeEventListener('resize', schedule); };
  }, []);
  return null;
}
