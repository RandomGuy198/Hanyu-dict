/** Original icon set: simple geometric marks drawn for this project, no third-party icon
 *  pack and no reference-app artwork. */

import type { ReactNode } from 'react';

type IconProps = { className?: string; title?: string };

function Svg({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const IconSearch = ({ className, title }: IconProps) => (
  <span className={className}>
    <Svg title={title}>
      <circle cx={10.5} cy={10.5} r={6} />
      <path d="M15 15l4.5 4.5" />
    </Svg>
  </span>
);

export const IconBook = ({ className, title }: IconProps) => (
  <span className={className}>
    <Svg title={title}>
      <path d="M4 5.5A2.5 2.5 0 016.5 3H19v15H6.5A2.5 2.5 0 004 20.5z" />
      <path d="M4 5.5v15" />
      <path d="M9 7.5h6M9 11h6" />
    </Svg>
  </span>
);

export const IconGrid = ({ className, title }: IconProps) => (
  <span className={className}>
    <Svg title={title}>
      <rect x={4} y={4} width={7} height={7} rx={1.5} />
      <rect x={13} y={4} width={7} height={7} rx={1.5} />
      <rect x={4} y={13} width={7} height={7} rx={1.5} />
      <rect x={13} y={13} width={7} height={7} rx={1.5} />
    </Svg>
  </span>
);

export const IconCards = ({ className, title }: IconProps) => (
  <span className={className}>
    <Svg title={title}>
      <rect x={3.5} y={7} width={13} height={12} rx={2} />
      <path d="M7.5 4h11a2 2 0 012 2v11" />
      <path d="M7 12h6M7 15.5h4" />
    </Svg>
  </span>
);

export const IconCamera = ({ className, title }: IconProps) => (
  <span className={className}>
    <Svg title={title}>
      <path d="M3.5 8.5A2 2 0 015.5 6.5h2L9 4.5h6l1.5 2h2a2 2 0 012 2v8a2 2 0 01-2 2H5.5a2 2 0 01-2-2z" />
      <circle cx={12} cy={12.5} r={3.2} />
    </Svg>
  </span>
);

export const IconPen = ({ className, title }: IconProps) => (
  <span className={className}>
    <Svg title={title}>
      <path d="M4 20l1.2-4.2L16 5l3 3L8.2 18.8z" />
      <path d="M14 7l3 3" />
    </Svg>
  </span>
);

export const IconSpark = ({ className, title }: IconProps) => (
  <span className={className}>
    <Svg title={title}>
      <path d="M12 3.5l2.2 5.3 5.3 2.2-5.3 2.2L12 18.5l-2.2-5.3-5.3-2.2 5.3-2.2z" />
      <path d="M18.5 4v3M20 5.5h-3" />
    </Svg>
  </span>
);

export const IconGear = ({ className, title }: IconProps) => (
  <span className={className}>
    <Svg title={title}>
      <circle cx={12} cy={12} r={3.2} />
      <path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7" />
    </Svg>
  </span>
);

export const IconSpeaker = ({ className, title }: IconProps) => (
  <span className={className}>
    <Svg title={title}>
      <path d="M4 9.5h3L11 6v12L7 14.5H4z" />
      <path d="M14.5 9.5a3.5 3.5 0 010 5M17 7a7 7 0 010 10" />
    </Svg>
  </span>
);

export const IconStar = ({ className, title }: IconProps) => (
  <span className={className}>
    <Svg title={title}>
      <path d="M12 4l2.4 5 5.6.7-4.1 3.8 1.1 5.5L12 16.3 7 19l1.1-5.5L4 9.7l5.6-.7z" />
    </Svg>
  </span>
);

export const IconChevronLeft = ({ className, title }: IconProps) => (
  <span className={className}>
    <Svg title={title}>
      <path d="M14.5 5.5L8 12l6.5 6.5" />
    </Svg>
  </span>
);

export const IconTrash = ({ className, title }: IconProps) => (
  <span className={className}>
    <Svg title={title}>
      <path d="M5 7h14M9 7V4.5h6V7M7 7l.8 12.5h8.4L17 7" />
    </Svg>
  </span>
);

export const IconDownload = ({ className, title }: IconProps) => (
  <span className={className}>
    <Svg title={title}>
      <path d="M12 4v10M8 11l4 4 4-4M4.5 19.5h15" />
    </Svg>
  </span>
);

export const IconCheck = ({ className, title }: IconProps) => (
  <span className={className}>
    <Svg title={title}>
      <path d="M5 13l4.5 4.5L19 7" />
    </Svg>
  </span>
);

export const IconAlert = ({ className, title }: IconProps) => (
  <span className={className}>
    <Svg title={title}>
      <path d="M12 4l8.5 15H3.5z" />
      <path d="M12 9.5v4.5M12 16.5v.5" />
    </Svg>
  </span>
);

/** The product mark: an abstract seal/square with a stroke, not any existing logo. */
export const BrandMark = () => (
  <span className="brand-mark" aria-hidden="true">
    语
  </span>
);
