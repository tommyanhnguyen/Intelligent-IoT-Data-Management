const decimalReading = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

export function parseSensorReading(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!decimalReading.test(trimmed)) return null;
    value = Number(trimmed);
  }

  return Number.isFinite(value) ? value : null;
}
