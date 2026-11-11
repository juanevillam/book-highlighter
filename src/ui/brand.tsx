const BOOK_PATHS = [
  'M24 14 Q16 9.5 9 11 V34 Q16 32 24 37.5 Z',
  'M24 14 Q32 9.5 39 11 V34 Q32 32 24 37.5 Z',
] as const;

const INK = '#F5F5F5';

export const BrandMark = ({
  size,
  color = INK,
}: {
  size: number;
  color?: string;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 48 48"
    fill="none"
    aria-hidden="true"
  >
    {BOOK_PATHS.map(d => (
      <path
        key={d}
        d={d}
        stroke={color}
        strokeWidth={3.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ))}
    <line
      x1={28.3}
      y1={20.6}
      x2={35}
      y2={19.6}
      stroke={color}
      strokeWidth={3.6}
      strokeLinecap="round"
    />
    <line
      x1={28.3}
      y1={26.6}
      x2={33.8}
      y2={25.9}
      stroke={color}
      strokeWidth={2.5}
      strokeLinecap="round"
      opacity={0.58}
    />
  </svg>
);

const SQUIRCLE_N = 4.5;
const SQUIRCLE_STEPS = 256;

const squirclePath = (s: number) => {
  const r = s / 2;
  const exp = 2 / SQUIRCLE_N;
  const points: string[] = [];

  for (let i = 0; i <= SQUIRCLE_STEPS; i += 1) {
    const a = (i / SQUIRCLE_STEPS) * 2 * Math.PI;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const x = r + Math.sign(cos) * r * Math.abs(cos) ** exp;
    const y = r + Math.sign(sin) * r * Math.abs(sin) ** exp;

    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }

  return `M${points.join('L')}Z`;
};

const GRADIENT: [string, string][] = [
  ['0', '#727272'],
  ['0.008', '#5A5A59'],
  ['0.016', '#414141'],
  ['0.2', '#2C2D2D'],
  ['0.5', '#222222'],
  ['0.8', '#181817'],
  ['0.984', '#1E1D1E'],
  ['0.992', '#2E2E2D'],
  ['1', '#3E3E3E'],
];
const SHADOW = { opacity: 0.5, blur: 0.045, dy: 0.05 };
const SHADOW_PAD = 0.18;

export const BrandTile = ({ size }: { size: number }) => {
  const pad = Math.round(size * SHADOW_PAD);
  const canvas = size + pad * 2;
  const path = squirclePath(size);
  const glyph = size * 0.88;
  const scale = glyph / 48;
  const offset = pad + (size - glyph) / 2;

  return (
    <svg
      width={canvas}
      height={canvas}
      viewBox={`0 0 ${canvas} ${canvas}`}
      style={{ margin: -pad, display: 'block' }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="bh-tile-shine" x1="0" y1="0" x2="0" y2="1">
          {GRADIENT.map(([stop, color]) => (
            <stop key={stop} offset={stop} stopColor={color} />
          ))}
        </linearGradient>
        <filter
          id="bh-tile-shadow"
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
        >
          <feGaussianBlur stdDeviation={size * SHADOW.blur} />
        </filter>
      </defs>
      <path
        d={path}
        fill="#000000"
        opacity={SHADOW.opacity}
        filter="url(#bh-tile-shadow)"
        transform={`translate(${pad}, ${pad + size * SHADOW.dy})`}
      />
      <path
        d={path}
        fill="url(#bh-tile-shine)"
        transform={`translate(${pad}, ${pad})`}
      />
      <g transform={`translate(${offset}, ${offset}) scale(${scale})`}>
        {BOOK_PATHS.map(d => (
          <path
            key={d}
            d={d}
            stroke={INK}
            strokeWidth={3.25}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        <line
          x1={28.3}
          y1={20.6}
          x2={35}
          y2={19.6}
          stroke={INK}
          strokeWidth={3.6}
          strokeLinecap="round"
        />
        <line
          x1={28.3}
          y1={26.6}
          x2={33.8}
          y2={25.9}
          stroke={INK}
          strokeWidth={2.5}
          strokeLinecap="round"
          opacity={0.58}
        />
      </g>
    </svg>
  );
};
