type IconProps = {
  className?: string;
};

type HeartIconProps = IconProps & {
  filled?: boolean;
};

const base = "h-4 w-4 shrink-0";

function iconProps(className: string) {
  return {
    "aria-hidden": true,
    className,
    fill: "none",
    viewBox: "0 0 24 24",
    strokeWidth: 1.5,
    stroke: "currentColor",
  } as const;
}

export function CardsIcon({ className = base }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.75 3.75h9.75A2.25 2.25 0 0 1 18.75 6v12A2.25 2.25 0 0 1 16.5 20.25H6.75A2.25 2.25 0 0 1 4.5 18V6a2.25 2.25 0 0 1 2.25-2.25Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18.75 6.75h.75A1.5 1.5 0 0 1 21 8.25v9A1.5 1.5 0 0 1 19.5 18.75h-.75M4.5 6.75h-.75a1.5 1.5 0 0 0-1.5 1.5v9a1.5 1.5 0 0 0 1.5 1.5h.75"
      />
    </svg>
  );
}

export function DeckIcon({ className = base }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m3.75 7.5 8.25-3 8.25 3L12 10.5l-8.25-3Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m3.75 12 8.25 3 8.25-3M3.75 16.5l8.25 3 8.25-3"
      />
    </svg>
  );
}

export function InfoIcon({ className = base }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.25 11.25 12 10.5v5.25m0-9v.008M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      />
    </svg>
  );
}

export function SparklesIcon({ className = base }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.456-2.456L14.25 6l1.035-.259a3.375 3.375 0 0 0 2.456-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
      />
    </svg>
  );
}

export function HeartIcon({
  className = base,
  filled = false,
}: HeartIconProps) {
  return (
    <svg
      {...iconProps(className)}
      fill={filled ? "currentColor" : "none"}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733C11.285 4.876 9.623 3.75 7.688 3.75 5.099 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z"
      />
    </svg>
  );
}

export function SwordsIcon({ className = base }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4 2-2M14.5 6.5 18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3 2 2"
      />
    </svg>
  );
}

export function SoundOnIcon({ className = base }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 9.75H4.5A.75.75 0 0 0 3.75 10.5v3c0 .414.336.75.75.75h2.25L10.5 18V6L6.75 9.75Z"
      />
    </svg>
  );
}

export function SoundOffIcon({ className = base }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m15.75 9 4.5 4.5m0-4.5-4.5 4.5M6.75 9.75H4.5a.75.75 0 0 0-.75.75v3c0 .414.336.75.75.75h2.25L10.5 18V6L6.75 9.75Z"
      />
    </svg>
  );
}

export function SearchIcon({ className = base }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21-4.35-4.35m1.35-5.4a6.75 6.75 0 1 1-13.5 0 6.75 6.75 0 0 1 13.5 0Z"
      />
    </svg>
  );
}

export function RefreshIcon({ className = base }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.023 9.348h4.992V4.356m-.942 4.57a8.25 8.25 0 1 0 .895 5.21M2.985 19.644v-4.992m0 0h4.992"
      />
    </svg>
  );
}

export function CopyIcon({ className = base }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75m9 10.5h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v14.25c0 .621.504 1.125 1.125 1.125h6.375Z"
      />
    </svg>
  );
}

export function CheckIcon({ className = base }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m4.5 12.75 4.5 4.5 10.5-10.5"
      />
    </svg>
  );
}

export function ShareIcon({ className = base }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z"
      />
    </svg>
  );
}

export function ExternalLinkIcon({ className = base }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
      />
    </svg>
  );
}

export function ChevronLeftIcon({ className = base }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m15.75 19.5-7.5-7.5 7.5-7.5"
      />
    </svg>
  );
}

export function ChevronRightIcon({ className = base }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m8.25 4.5 7.5 7.5-7.5 7.5"
      />
    </svg>
  );
}

export function ImageOffIcon({ className = base }: IconProps) {
  return (
    <svg {...iconProps(className)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m3 3 18 18M10.5 6.75h7.125A2.625 2.625 0 0 1 20.25 9.375v8.25c0 .58-.188 1.116-.506 1.55M15.75 18.75H6.375a2.625 2.625 0 0 1-2.625-2.625v-6.75c0-.776.336-1.474.87-1.955m-.87 8.705 4.19-4.19a1.5 1.5 0 0 1 2.12 0l.94.94m1.5 1.5.94-.94a1.5 1.5 0 0 1 2.12 0l4.19 4.19M15.75 10.5h.008v.008h-.008V10.5Z"
      />
    </svg>
  );
}
