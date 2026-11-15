export function Logo({ className, label }: { className?: string; label?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <rect x="20" y="5" width="4.2" height="11" rx="2.1" fill="currentColor" />
      <rect x="39.8" y="5" width="4.2" height="11" rx="2.1" fill="currentColor" />
      <rect x="7" y="13" width="50" height="44" rx="7" fill="none" stroke="currentColor" strokeWidth="3.4" />
      <rect x="15.5" y="23" width="8.2" height="8.2" rx="1.6" fill="currentColor" />
      <rect x="27.9" y="23" width="8.2" height="8.2" rx="1.6" fill="currentColor" />
      <rect x="40.3" y="23" width="8.2" height="8.2" rx="1.6" fill="currentColor" />
      <rect x="15.5" y="35.4" width="8.2" height="8.2" rx="1.6" fill="currentColor" />
      <rect x="27.9" y="35.4" width="8.2" height="8.2" rx="1.6" fill="currentColor" />
      <path d="M40.3 39.5h8.2M44.4 35.4v8.2" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

export function faviconHref(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="20" y="5" width="4.2" height="11" rx="2.1" fill="${color}"/><rect x="39.8" y="5" width="4.2" height="11" rx="2.1" fill="${color}"/><rect x="7" y="13" width="50" height="44" rx="7" fill="none" stroke="${color}" stroke-width="3.4"/><rect x="15.5" y="23" width="8.2" height="8.2" rx="1.6" fill="${color}"/><rect x="27.9" y="23" width="8.2" height="8.2" rx="1.6" fill="${color}"/><rect x="40.3" y="23" width="8.2" height="8.2" rx="1.6" fill="${color}"/><rect x="15.5" y="35.4" width="8.2" height="8.2" rx="1.6" fill="${color}"/><rect x="27.9" y="35.4" width="8.2" height="8.2" rx="1.6" fill="${color}"/><path d="M40.3 39.5h8.2M44.4 35.4v8.2" fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
