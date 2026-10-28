import type { RowLayoutDto } from "../../shared/types";

const LANE_WIDTH = 14;
const EDGE_PAD = 8;

const LANE_COLORS = [
  "#6ea8fe",
  "#f0a35e",
  "#71c78e",
  "#d98adf",
  "#e0c14f",
  "#6fd3d8",
  "#e07f9a",
  "#9d9df0",
];

export function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

export function graphWidth(laneCount: number): number {
  return EDGE_PAD * 2 + Math.max(1, laneCount) * LANE_WIDTH;
}

interface GraphCellProps {
  layout: RowLayoutDto;
  laneCount: number;
  height: number;
}

export function GraphCell({ layout, laneCount, height }: GraphCellProps) {
  const width = graphWidth(laneCount);
  const x = (lane: number) => EDGE_PAD + lane * LANE_WIDTH + LANE_WIDTH / 2;
  const nodeX = x(layout.lane);
  const nodeY = height / 2;
  const converging = new Set(layout.converging_lanes);
  const passing = layout.before_lanes
    .map((oid, lane) => ({ oid, lane }))
    .filter(({ oid, lane }) => oid !== null && lane !== layout.lane && !converging.has(lane));

  return (
    <svg
      className="graph-cell"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {passing.map(({ lane }) => (
        <line
          key={`pass-${lane}`}
          x1={x(lane)}
          y1={0}
          x2={x(lane)}
          y2={height}
          stroke={laneColor(lane)}
          strokeWidth={2}
        />
      ))}
      {layout.converging_lanes.map((lane) => (
        <path
          key={`converge-${lane}`}
          d={`M ${x(lane)} 0 C ${x(lane)} ${nodeY}, ${nodeX} ${nodeY * 0.4}, ${nodeX} ${nodeY}`}
          fill="none"
          stroke={laneColor(lane)}
          strokeWidth={2}
        />
      ))}
      {layout.parents.map((edge) => (
        <path
          key={`edge-${edge.parent}`}
          d={`M ${nodeX} ${nodeY} C ${nodeX} ${nodeY + height * 0.3}, ${x(edge.lane)} ${
            height - height * 0.3
          }, ${x(edge.lane)} ${height}`}
          fill="none"
          stroke={laneColor(layout.lane)}
          strokeWidth={2}
          strokeDasharray={edge.pending ? "3 3" : undefined}
          opacity={edge.pending ? 0.7 : 1}
        />
      ))}
      <circle
        cx={nodeX}
        cy={nodeY}
        r={layout.parents.length > 1 ? 4.5 : 4}
        fill={laneColor(layout.lane)}
        stroke="#16181d"
        strokeWidth={1.5}
      />
    </svg>
  );
}
