/** One request per mounted account, with a short cooldown for passive events. */
export function createTemplateRefresher<T>({ load, apply, now = Date.now }: {
  load: (signal: AbortSignal) => Promise<T>;
  apply: (value: T) => void;
  now?: () => number;
}) {
  let disposed = false;
  let lastSuccess: number | null = null;
  let version = 0;
  let pending: Promise<void> | null = null;
  const controller = new AbortController();

  return {
    refresh(force = false): Promise<void> {
      if (disposed) return Promise.resolve();
      if (force) version += 1;
      if (pending) return pending;
      if (!force && lastSuccess !== null && now() - lastSuccess < 30_000) return Promise.resolve();
      const run = async () => {
        // A save during a read requires one more read; passive events share it.
        while (!disposed) {
          const requestedVersion = version;
          try {
            const value = await load(controller.signal);
            if (disposed) return;
            if (requestedVersion !== version) continue;
            apply(value);
            lastSuccess = now();
            return;
          } catch (error) {
            if (disposed) return;
            if (requestedVersion !== version) continue;
            throw error;
          }
        }
      };
      pending = run().finally(() => { pending = null; });
      return pending;
    },
    dispose() {
      disposed = true;
      controller.abort();
    },
  };
}
