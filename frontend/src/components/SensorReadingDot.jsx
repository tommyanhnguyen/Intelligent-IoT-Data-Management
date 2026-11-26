const SensorReadingDot = ({
  cx, cy, index, points, stroke, strokeOpacity, dataKey, payload,
}) => {
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;

  if (payload[`__anomaly_${dataKey}`]) {
    return <circle cx={cx} cy={cy} r={6} fill="#dc2626" stroke="#ffffff" strokeWidth={2} />;
  }

  // A reading surrounded by gaps has no line segment to make it visible.
  if (Number.isFinite(points[index - 1]?.y) || Number.isFinite(points[index + 1]?.y)) {
    return null;
  }

  return <circle className="sensor-reading-dot" cx={cx} cy={cy} r={3} fill={stroke} fillOpacity={strokeOpacity} />;
};

export default SensorReadingDot;
