export function createGtagCommandQueue(dataLayer: unknown[]): (...args: unknown[]) => void {
  return function gtag() {
    // Google Tag expects each queued command to be an Arguments object, not a rest-parameter array.
    // eslint-disable-next-line prefer-rest-params
    dataLayer.push(arguments);
  };
}
