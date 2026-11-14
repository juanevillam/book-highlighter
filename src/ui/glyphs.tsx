const strokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export const CloseGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M6 6l12 12M18 6 6 18"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
    />
  </svg>
);

export const ChevronDownGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m6 9 6 6 6-6" {...strokeProps} strokeWidth={2} />
  </svg>
);

export const ChevronRightGlyph = () => (
  <svg viewBox="0 0 8 13" aria-hidden="true">
    <path d="M1.5 1.5 6.5 6.5l-5 5" {...strokeProps} strokeWidth={1.8} />
  </svg>
);

export const ChevronLeftGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" {...strokeProps} strokeWidth={2} />
  </svg>
);

export const PlusGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 5v14M5 12h14" {...strokeProps} strokeWidth={2} />
  </svg>
);

export const CheckGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m5 12.5 4.5 4.5L19 7.5" {...strokeProps} strokeWidth={2.2} />
  </svg>
);

export const TrashGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M4.5 6.5h15M9.5 6.5V4.8c0-.7.5-1.3 1.2-1.3h2.6c.7 0 1.2.6 1.2 1.3v1.7M6.5 6.5l.8 12.2c.1 1 .9 1.8 1.9 1.8h5.6c1 0 1.8-.8 1.9-1.8l.8-12.2"
      {...strokeProps}
    />
  </svg>
);

export const PencilGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M15.5 4.5l4 4L9 19l-5 1 1-5L15.5 4.5ZM13.5 6.5l4 4"
      {...strokeProps}
    />
  </svg>
);

export const ShareGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 15V3.5M8 7.5 12 3.5l4 4" {...strokeProps} strokeWidth={1.9} />
    <path
      d="M5.5 11.5v7A1.8 1.8 0 0 0 7.3 20.3h9.4a1.8 1.8 0 0 0 1.8-1.8v-7"
      {...strokeProps}
      strokeWidth={1.9}
    />
  </svg>
);

export const GearGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M10.16 4.32 L10.48 1.91 L13.52 1.91 L13.84 4.32 L16.13 5.26 L18.06 3.8 L20.2 5.94 L18.74 7.87 L19.68 10.16 L22.09 10.48 L22.09 13.52 L19.68 13.84 L18.74 16.13 L20.2 18.06 L18.06 20.2 L16.13 18.74 L13.84 19.68 L13.52 22.09 L10.48 22.09 L10.16 19.68 L7.87 18.74 L5.94 20.2 L3.8 18.06 L5.26 16.13 L4.32 13.84 L1.91 13.52 L1.91 10.48 L4.32 10.16 L5.26 7.87 L3.8 5.94 L5.94 3.8 L7.87 5.26Z"
      {...strokeProps}
      strokeWidth={1.6}
    />
    <circle cx="12" cy="12" r="3.3" {...strokeProps} strokeWidth={1.6} />
  </svg>
);

export const CameraGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M3.5 8.5a2 2 0 0 1 2-2h2.2l1.4-2h5.8l1.4 2h2.2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-9Z"
      {...strokeProps}
    />
    <circle cx="12" cy="12.8" r="3.4" {...strokeProps} />
  </svg>
);

export const BookOpenGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 6.8C9.2 4.8 5.8 5 3.5 5.6v12.2c2.3-.5 5.7-.7 8.5 1.3 2.8-2 6.2-1.8 8.5-1.3V5.6c-2.3-.6-5.7-.8-8.5 1.2Zm0 0v12.3"
      {...strokeProps}
    />
  </svg>
);

export const ContentsGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 6.5h12M8 12h12M8 17.5h12" {...strokeProps} strokeWidth={1.9} />
    <circle cx="4.3" cy="6.5" r="1.2" fill="currentColor" />
    <circle cx="4.3" cy="12" r="1.2" fill="currentColor" />
    <circle cx="4.3" cy="17.5" r="1.2" fill="currentColor" />
  </svg>
);

export const TextSizeGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M3.2 18.5 7.8 6.5l4.6 12M4.8 14.5h6M14.8 18.5l3-8 3 8M15.8 16h4"
      {...strokeProps}
      strokeWidth={1.9}
    />
  </svg>
);

export const SearchGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="10.8" cy="10.8" r="6.3" {...strokeProps} />
    <path d="m15.6 15.6 4.2 4.2" {...strokeProps} />
  </svg>
);

export const ReorderGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M8 19V5M4.5 8.5 8 5l3.5 3.5M16 5v14M12.5 15.5 16 19l3.5-3.5"
      {...strokeProps}
      strokeWidth={1.85}
    />
  </svg>
);
