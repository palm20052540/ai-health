import React from "react";

const paths = {
  health: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21.2l7.8-7.7 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />,
  recovery: <><path d="M4 19v-6" /><path d="M8 19V9" /><path d="M12 19V5" /><path d="M16 19v-8" /><path d="M20 19v-4" /></>,
  training: <><path d="M6.5 8v8" /><path d="M17.5 8v8" /><path d="M9 12h6" /><path d="M4 10v4" /><path d="M20 10v4" /></>,
  coach: <><circle cx="12" cy="12" r="9" /><path d="M12 6.5c.5 3.1 1.6 4.2 4.7 4.7-3.1.5-4.2 1.6-4.7 4.7-.5-3.1-1.6-4.2-4.7-4.7 3.1-.5 4.2-1.6 4.7-4.7Z" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
  sync: <><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 8A7 7 0 0 1 18 6l2 1" /><path d="M17.9 16A7 7 0 0 1 6 18l-2-1" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>,
  chevron: <path d="m9 18 6-6-6-6" />,
  sparkle: <path d="M12 3c.7 4.7 2.3 6.3 7 7-4.7.7-6.3 2.3-7 7-.7-4.7-2.3-6.3-7-7 4.7-.7 6.3-2.3 7-7Z" />,
  moon: <path d="M20 15.2A8.5 8.5 0 1 1 8.8 4 6.6 6.6 0 0 0 20 15.2Z" />,
  pulse: <path d="M3 12h4l2-7 4 14 2-7h6" />,
  dumbbell: <><path d="M6.5 8v8" /><path d="M17.5 8v8" /><path d="M9 12h6" /><path d="M4 10v4" /><path d="M20 10v4" /></>,
  shoe: <path d="M4 15c4 0 5-2 7-6l3 2 2-1 4 4c1 1 .4 3-1 3H6c-1.2 0-2-.8-2-2Z" />,
  heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21.2l7.8-7.7 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />,
  scale: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 8a4 4 0 0 1 6 0" /><path d="m12 8 2-1" /></>,
  flame: <path d="M12 22c4 0 7-3 7-7 0-3-2-5-4-7 0 3-1 4-2 5 0-4-2-7-5-10 0 5-3 7-3 12 0 4 3 7 7 7Z" />,
  camera: <><path d="M14.5 5 13 3h-2L9.5 5H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z" /><circle cx="12" cy="13" r="4" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  close: <><path d="m6 6 12 12" /><path d="m18 6-12 12" /></>,
};

export function Icon({ name, size = 24, className = "", strokeWidth = 1.8 }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  );
}
