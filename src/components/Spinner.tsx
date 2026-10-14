const sizeClasses = {
  md: "h-10 w-10",
  lg: "h-12 w-12",
} as const;

interface SpinnerProps {
  /** Announced as a status. Omit it when visible text beside the spinner already says what is loading. */
  label?: string;
  size?: keyof typeof sizeClasses;
}

export default function Spinner({ label, size = "md" }: SpinnerProps) {
  return (
    <div
      {...(label ? { role: "status", "aria-label": label } : { "aria-hidden": true })}
      className={`${sizeClasses[size]} animate-spin rounded-full border-4 border-accent border-t-transparent`}
    />
  );
}
