// Small 20×20 icons for the construction tools (stroke = currentColor).
import type { ToolId } from './tools';

const dot = (x: number, y: number, r = 1.6) => <circle cx={x} cy={y} r={r} fill="currentColor" stroke="none" />;

const ICONS: Record<ToolId, JSX.Element> = {
  move: <path d="M5 3l10 6-4.5 1.2L8.5 15z" />,
  point: (
    <>
      {dot(8, 12, 2.2)}
      <path d="M11 6l3-3M13 3h1v1" />
    </>
  ),
  segment: (
    <>
      <path d="M4 15L16 5" />
      {dot(4, 15)}
      {dot(16, 5)}
    </>
  ),
  line: (
    <>
      <path d="M1 18L19 2" />
      {dot(6, 13.5)}
      {dot(14, 6.5)}
    </>
  ),
  polygon: (
    <>
      <path d="M3 16L10 3l7 13z" />
      {dot(3, 16)}
      {dot(10, 3)}
      {dot(17, 16)}
    </>
  ),
  perpendicular: (
    <>
      <path d="M2 15h16M10 15V2M10 12h3v3" />
    </>
  ),
  parallel: <path d="M2 13L14 3M6 17L18 7" />,
  perpBisector: (
    <>
      <path d="M3 14h14M10 18V2" />
      {dot(3, 14)}
      {dot(17, 14)}
    </>
  ),
  midpoint: (
    <>
      <path d="M3 15L17 5" />
      {dot(3, 15, 1.3)}
      {dot(17, 5, 1.3)}
      {dot(10, 10, 2.2)}
    </>
  ),
  intersect: (
    <>
      <path d="M3 3l14 14M17 3L3 17" />
      {dot(10, 10, 2.2)}
    </>
  ),
  foot: (
    <>
      <path d="M2 16h16M10 4v12" strokeDasharray="2 1.5" />
      {dot(10, 4)}
      {dot(10, 16, 2.2)}
    </>
  ),
  reflectLine: (
    <>
      <path d="M10 2v16" strokeDasharray="2 1.5" />
      {dot(5, 7)}
      {dot(15, 7)}
      <path d="M6.5 13h7M11.5 11l2 2-2 2" />
    </>
  ),
  reflectPoint: (
    <>
      <path d="M4 15L16 5" strokeDasharray="2 1.5" />
      {dot(4, 15)}
      {dot(16, 5)}
      {dot(10, 10, 1.2)}
    </>
  ),
  circumcenter: (
    <>
      <circle cx="10" cy="10.5" r="7.5" />
      <path d="M4 14.5L10 3l6 11.5z" />
      {dot(10, 10.5)}
    </>
  ),
  incenter: (
    <>
      <path d="M2 17L10 3l8 14z" />
      <circle cx="10" cy="12.3" r="4.2" />
      {dot(10, 12.3)}
    </>
  ),
  centroid: (
    <>
      <path d="M2 17L10 3l8 14z" />
      <path d="M10 3v14M2 17l12-7M18 17L6 10" strokeWidth="0.8" />
      {dot(10, 12.3)}
    </>
  ),
  orthocenter: (
    <>
      <path d="M2 17L8 3l10 14z" />
      <path d="M8 3v14M2 17l11-7" strokeWidth="0.8" strokeDasharray="1.5 1" />
      {dot(8, 12.5)}
    </>
  ),
  circle: (
    <>
      <circle cx="10" cy="10" r="7" />
      {dot(10, 10)}
      {dot(17, 10)}
    </>
  ),
  circle3: (
    <>
      <circle cx="10" cy="10" r="7" />
      {dot(3, 10)}
      {dot(13.5, 3.9)}
      {dot(13.5, 16.1)}
    </>
  ),
  incircle: (
    <>
      <path d="M2 17L10 3l8 14z" />
      <circle cx="10" cy="12.3" r="4.2" />
    </>
  ),
  rightAngle: <path d="M3 3v14h14M3 12h5v5" />,
  angleMark: <path d="M2 17L16 3M2 17h16M9 17a7 7 0 0 0-2-5" />,
};

export function ToolIcon({ id, size = 18 }: { id: ToolId; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[id]}
    </svg>
  );
}
