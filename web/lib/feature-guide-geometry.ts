export type GuideTargetRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
  borderRadius: number;
};

export type GuideSpotlightGeometry = {
  top: number;
  left: number;
  width: number;
  height: number;
  borderRadius: number;
};

function snapToDevicePixel(value: number, devicePixelRatio: number) {
  const ratio = Number.isFinite(devicePixelRatio)
    ? Math.max(1, devicePixelRatio)
    : 1;
  return Math.round(value * ratio) / ratio;
}

export function resolveGuideSpotlightGeometry({
  target,
  viewportWidth,
  viewportHeight,
  requestedPadding,
  viewportMargin,
  devicePixelRatio,
}: {
  target: GuideTargetRect;
  viewportWidth: number;
  viewportHeight: number;
  requestedPadding: number;
  viewportMargin: number;
  devicePixelRatio: number;
}): GuideSpotlightGeometry {
  const availablePadding = Math.min(
    target.left - viewportMargin,
    target.top - viewportMargin,
    viewportWidth - viewportMargin - target.right,
    viewportHeight - viewportMargin - target.bottom,
  );
  const padding = Math.max(0, Math.min(requestedPadding, availablePadding));
  const left = snapToDevicePixel(target.left - padding, devicePixelRatio);
  const top = snapToDevicePixel(target.top - padding, devicePixelRatio);
  const right = snapToDevicePixel(target.right + padding, devicePixelRatio);
  const bottom = snapToDevicePixel(target.bottom + padding, devicePixelRatio);

  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    borderRadius: snapToDevicePixel(
      Math.max(8, target.borderRadius + padding),
      devicePixelRatio,
    ),
  };
}
