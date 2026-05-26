// Gráfico de dona en SVG puro. No depende de librerías externas.
// Acepta una serie de items {label, value, color} y muestra:
//   - dona con segmentos coloreados
//   - total en el centro
//   - leyenda con valores y porcentaje
//   - tooltip nativo al pasar el cursor sobre cada segmento

import { useMemo, useState } from "react";

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

interface Props {
  title: string;
  data: DonutSlice[];
  centerLabel?: string;
  size?: number;
}

export default function DonutChart({ title, data, centerLabel = "Total", size = 200 }: Props) {
  const total = useMemo(() => data.reduce((acc, d) => acc + d.value, 0), [data]);
  const [hover, setHover] = useState<number | null>(null);

  const radius = size / 2 - 6;
  const innerRadius = radius * 0.62;
  const cx = size / 2;
  const cy = size / 2;
  const TAU = Math.PI * 2;

  function polar(angle: number, r: number) {
    return { x: cx + Math.cos(angle - Math.PI / 2) * r, y: cy + Math.sin(angle - Math.PI / 2) * r };
  }

  let startAngle = 0;
  const slices = data.map((d, i) => {
    const fraction = total > 0 ? d.value / total : 0;
    const endAngle = startAngle + fraction * TAU;
    const large = endAngle - startAngle > Math.PI ? 1 : 0;
    const p1 = polar(startAngle, radius);
    const p2 = polar(endAngle, radius);
    const p3 = polar(endAngle, innerRadius);
    const p4 = polar(startAngle, innerRadius);
    const path =
      total > 0
        ? `M ${p1.x} ${p1.y} A ${radius} ${radius} 0 ${large} 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${innerRadius} ${innerRadius} 0 ${large} 0 ${p4.x} ${p4.y} Z`
        : "";
    const slice = { ...d, fraction, path, index: i };
    startAngle = endAngle;
    return slice;
  });

  return (
    <div className="card">
      <h3 className="mb-3 text-sm font-semibold text-uta-900">{title}</h3>
      {total === 0 ? (
        <p className="py-6 text-center text-xs text-gray-500">Sin datos.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-5">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
            {slices.map((s) => (
              <path
                key={s.label}
                d={s.path}
                fill={s.color}
                stroke="#fff"
                strokeWidth={2}
                onMouseEnter={() => setHover(s.index)}
                onMouseLeave={() => setHover(null)}
                style={{
                  cursor: "pointer",
                  opacity: hover === null || hover === s.index ? 1 : 0.55,
                  transition: "opacity 120ms ease",
                }}
              >
                <title>
                  {s.label}: {s.value} ({(s.fraction * 100).toFixed(1)}%)
                </title>
              </path>
            ))}
            <text
              x={cx}
              y={cy - 6}
              textAnchor="middle"
              className="fill-gray-500"
              style={{ fontSize: 11, fontWeight: 600 }}
            >
              {centerLabel}
            </text>
            <text
              x={cx}
              y={cy + 14}
              textAnchor="middle"
              className="fill-gray-900"
              style={{ fontSize: 22, fontWeight: 700 }}
            >
              {total}
            </text>
          </svg>
          <ul className="flex-1 space-y-1.5 text-xs">
            {slices.map((s) => (
              <li
                key={s.label}
                className={`flex items-center justify-between gap-2 rounded px-2 py-1 transition ${
                  hover === s.index ? "bg-gray-100" : ""
                }`}
                onMouseEnter={() => setHover(s.index)}
                onMouseLeave={() => setHover(null)}
              >
                <span className="flex items-center gap-2 truncate">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ background: s.color }}
                  />
                  <span className="truncate text-gray-700">{s.label}</span>
                </span>
                <span className="whitespace-nowrap font-semibold text-gray-900">
                  {s.value}
                  <span className="ml-1 text-gray-500">
                    {(s.fraction * 100).toFixed(0)}%
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
