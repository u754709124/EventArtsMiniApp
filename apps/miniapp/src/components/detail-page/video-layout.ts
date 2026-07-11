export function getVideoAspectRatioPadding(dimensions: {
  width: number | null;
  height: number | null;
}) {
  const { width, height } = dimensions;
  if (
    !width ||
    !height ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return "56.25%";
  }
  return `${(height / width) * 100}%`;
}
