type IconProps = { className?: string };

export function IconChat(props: IconProps) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M4 5h16v10H7l-3 3V5zm2 2v6h11V7H6z" />
    </svg>
  );
}

export function IconSessions(props: IconProps) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M5 4h14v3H5V4zm0 5h14v3H5V9zm0 5h14v3H5v-3zm0 5h9v2H5v-2z" />
    </svg>
  );
}

export function IconMemory(props: IconProps) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M7 3h10v2H7V3zm-2 4h14v14H5V7zm2 2v10h10V9H7zm2 2h6v2H9v-2zm0 4h4v2H9v-2z" />
    </svg>
  );
}

export function IconPsyche(props: IconProps) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 3a7 7 0 0 1 7 7c0 2.6-1.4 4.9-3.5 6.1V19h-7v-2.9A7 7 0 0 1 5 10a7 7 0 0 1 7-7zm-2 18h4v2h-4v-2z" />
    </svg>
  );
}

export function IconFiles(props: IconProps) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M4 4h7l2 2h7v14H4V4zm2 4v10h12V8H6zm2 2h8v2H8v-2z" />
    </svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M10 3h4l.6 2.4 2.2 1.3 2.4-.4 2 3.4-1.8 1.7v2.2l1.8 1.7-2 3.4-2.4-.4-2.2 1.3L14 21h-4l-.6-2.4-2.2-1.3-2.4.4-2-3.4 1.8-1.7v-2.2L2.8 9.7l2-3.4 2.4.4 2.2-1.3L10 3zm2 6a3 3 0 1 0 .001 6.001A3 3 0 0 0 12 9z" />
    </svg>
  );
}
