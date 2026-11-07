/**
 * Inline SVG Icons matching Lucide (Zero CDN dependency, Zero Preact VDOM conflict, 100% Offline).
 */
import type { JSX } from 'preact';

interface IconProps {
  class?: string;
}

export function IconPlay({ class: cls = 'w-3.5 h-3.5' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  );
}

export function IconPause({ class: cls = 'w-3.5 h-3.5' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

export function IconUndo({ class: cls = 'w-4 h-4' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
  );
}

export function IconRedo({ class: cls = 'w-4 h-4' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
    </svg>
  );
}

export function IconSave({ class: cls = 'w-4 h-4' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

export function IconDownload({ class: cls = 'w-4 h-4' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export function IconTrash({ class: cls = 'w-3.5 h-3.5' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function IconEye({ class: cls = 'w-3.5 h-3.5' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconClose({ class: cls = 'w-4 h-4' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function IconBoard({ class: cls = 'w-3.5 h-3.5' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="3" width="18" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <path d="M7 12l3-3 2 2 5-5" />
    </svg>
  );
}

export function IconCursor({ class: cls = 'w-3.5 h-3.5' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M4 4l7.07 17 2.51-7.39L21 11.07z" />
    </svg>
  );
}

export function IconPen({ class: cls = 'w-3.5 h-3.5' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="M2 2l7.586 7.586" />
    </svg>
  );
}

export function IconHighlighter({ class: cls = 'w-3.5 h-3.5' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m9 11-6 6v3h9l3-3" />
      <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
    </svg>
  );
}

export function IconEraser({ class: cls = 'w-3.5 h-3.5' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
      <path d="M22 21H7" />
      <path d="m5 11 9 9" />
    </svg>
  );
}

export function IconHome({ class: cls = 'w-3.5 h-3.5' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="3" />
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
    </svg>
  );
}

export function IconSkipBack({ class: cls = 'w-3.5 h-3.5' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="19 20 9 12 19 4 19 20" fill="currentColor" />
      <line x1="5" y1="19" x2="5" y2="5" />
    </svg>
  );
}

export function IconStepBack({ class: cls = 'w-3 h-3' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

export function IconStepForward({ class: cls = 'w-3 h-3' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export function IconSliders({ class: cls = 'w-3.5 h-3.5' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

export function IconSidebarToggle({ class: cls = 'w-3.5 h-3.5' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );
}

export function IconEyeOff({ class: cls = 'w-3.5 h-3.5' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export function IconChevronDown({ class: cls = 'w-3.5 h-3.5' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function IconChevronRight({ class: cls = 'w-3.5 h-3.5' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export function IconTarget({ class: cls = 'w-3.5 h-3.5' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

export function IconFunction({ class: cls = 'w-3.5 h-3.5' }: IconProps): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M9 17c2 0 2.8-1 2.8-2.8V10c0-2 1-3.3 3.2-3" />
      <path d="M9 11.2h5.7" />
    </svg>
  );
}


