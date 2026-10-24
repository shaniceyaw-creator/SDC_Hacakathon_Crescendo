import { useId } from 'react';

/** OpusEvents logo: a cream "O" ring holding three rising amber bars (a crescendo). Same drawing as public/favicon.svg. */
export function BrandMark({ size = 34 }: { size?: number }) {
  const gid = `${useId().replace(/:/g, '')}-bg`;
  return (
    <svg className="eo-brandmark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#34917c" />
          <stop offset="1" stopColor="#1b5d4f" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${gid})`} />
      <circle cx="32" cy="32" r="19" fill="none" stroke="#fffdf5" strokeWidth="6" />
      <rect x="23.5" y="34" width="5" height="7" rx="2.5" fill="#f4b860" />
      <rect x="30" y="29" width="5" height="12" rx="2.5" fill="#f4b860" />
      <rect x="36.5" y="23" width="5" height="18" rx="2.5" fill="#f4b860" />
    </svg>
  );
}
