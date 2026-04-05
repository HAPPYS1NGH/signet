"use client";

interface LogoProps {
  className?: string;
  showWordmark?: boolean;
  size?: "sm" | "md" | "lg";
}

export function Logo({ className = "", showWordmark = true, size = "md" }: LogoProps) {
  const sizes = {
    sm: { icon: 24, font: 16, gap: 8 },
    md: { icon: 32, font: 20, gap: 10 },
    lg: { icon: 40, font: 26, gap: 12 },
  };

  const s = sizes[size];

  return (
    <div className={`flex items-center gap-${Math.round(s.gap / 4)} ${className}`}>
      {/* Seal Icon */}
      <svg
        width={s.icon}
        height={s.icon}
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Outer ring */}
        <circle
          cx="18"
          cy="18"
          r="16"
          stroke="var(--accent)"
          strokeWidth="2"
        />
        {/* Inner accent ring */}
        <circle
          cx="18"
          cy="18"
          r="12"
          stroke="var(--accent)"
          strokeWidth="1"
          opacity="0.5"
        />
        {/* S Monogram */}
        <text
          x="18"
          y="24"
          textAnchor="middle"
          fontFamily="var(--font-syne), Syne, sans-serif"
          fontSize="14"
          fontWeight="800"
          fill="var(--accent)"
        >
          S
        </text>
        {/* Cardinal dots */}
        <circle cx="18" cy="3" r="1.5" fill="var(--accent)" />
        <circle cx="18" cy="33" r="1.5" fill="var(--accent)" />
        <circle cx="3" cy="18" r="1.5" fill="var(--accent)" />
        <circle cx="33" cy="18" r="1.5" fill="var(--accent)" />
      </svg>

      {/* Wordmark */}
      {showWordmark && (
        <span
          className="font-[var(--font-syne)] font-bold tracking-tight text-[var(--foreground)]"
          style={{ fontSize: s.font }}
        >
          Signet
        </span>
      )}
    </div>
  );
}

export function LogoIcon({ className = "", size = 32 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Outer ring */}
      <circle cx="18" cy="18" r="16" stroke="var(--accent)" strokeWidth="2" />
      {/* Inner accent ring */}
      <circle cx="18" cy="18" r="12" stroke="var(--accent)" strokeWidth="1" opacity="0.5" />
      {/* S Monogram */}
      <text
        x="18"
        y="24"
        textAnchor="middle"
        fontFamily="var(--font-syne), Syne, sans-serif"
        fontSize="14"
        fontWeight="800"
        fill="var(--accent)"
      >
        S
      </text>
      {/* Cardinal dots */}
      <circle cx="18" cy="3" r="1.5" fill="var(--accent)" />
      <circle cx="18" cy="33" r="1.5" fill="var(--accent)" />
      <circle cx="3" cy="18" r="1.5" fill="var(--accent)" />
      <circle cx="33" cy="18" r="1.5" fill="var(--accent)" />
    </svg>
  );
}
