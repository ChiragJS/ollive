interface Props {
  name:
    | "logo"
    | "gauge"
    | "list"
    | "layers"
    | "alert"
    | "settings"
    | "refresh"
    | "chevron-right"
    | "chevron-down"
    | "arrow-up"
    | "arrow-down"
    | "minus"
    | "x"
    | "search"
    | "external";
  size?: number;
  strokeWidth?: number;
}

export function Icon({ name, size = 16, strokeWidth = 1.7 }: Props) {
  const c = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "logo":
      return (
        <svg {...c} viewBox="0 0 24 24" strokeWidth={2.2}>
          <path d="M3 17 L8 7 L11 12 L14 5 L18 14 L21 9" />
        </svg>
      );
    case "gauge":
      return (
        <svg {...c}>
          <path d="M12 14 L17 9" />
          <circle cx="12" cy="14" r="1.4" fill="currentColor" stroke="none" />
          <path d="M3.5 14a8.5 8.5 0 0 1 17 0" />
          <path d="M5.5 18.5h13" />
        </svg>
      );
    case "list":
      return (
        <svg {...c}>
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
          <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "layers":
      return (
        <svg {...c}>
          <polygon points="12 2 22 8 12 14 2 8 12 2" />
          <polyline points="2 14 12 20 22 14" />
          <polyline points="2 18 12 24 22 18" transform="translate(0 -4)" />
        </svg>
      );
    case "alert":
      return (
        <svg {...c}>
          <path d="M10.3 3.8 1.8 18.2A2 2 0 0 0 3.5 21h17a2 2 0 0 0 1.7-2.8L13.7 3.8a2 2 0 0 0-3.4 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12" y2="17" />
        </svg>
      );
    case "settings":
      return (
        <svg {...c}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...c}>
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10" />
          <path d="M20.5 15a9 9 0 0 1-14.9 3.4L1 14" />
        </svg>
      );
    case "chevron-right":
      return (
        <svg {...c}>
          <polyline points="9 6 15 12 9 18" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg {...c}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      );
    case "arrow-up":
      return (
        <svg {...c}>
          <line x1="12" y1="19" x2="12" y2="5" />
          <polyline points="5 12 12 5 19 12" />
        </svg>
      );
    case "arrow-down":
      return (
        <svg {...c}>
          <line x1="12" y1="5" x2="12" y2="19" />
          <polyline points="19 12 12 19 5 12" />
        </svg>
      );
    case "minus":
      return (
        <svg {...c}>
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      );
    case "x":
      return (
        <svg {...c}>
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      );
    case "search":
      return (
        <svg {...c}>
          <circle cx="11" cy="11" r="7" />
          <line x1="20" y1="20" x2="16.5" y2="16.5" />
        </svg>
      );
    case "external":
      return (
        <svg {...c}>
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      );
  }
}
