import { CoffeeIcon } from "./SocialIcons";

export default function SupportLink({
  children = "Help cover hosting",
  iconOnly = false,
}: {
  children?: React.ReactNode;
  iconOnly?: boolean;
}) {
  return (
    <a
      href="https://ko-fi.com/W0N120R5I5"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={iconOnly ? "Help cover hosting on Ko-fi (opens in a new tab)" : undefined}
      title={iconOnly ? "Help cover hosting on Ko-fi" : undefined}
      className={iconOnly
        ? "flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-text-secondary transition-colors hover:bg-surface-2 hover:text-accent-hover"
        : "inline-flex min-h-11 items-center gap-1 rounded-lg text-xs text-text-secondary underline underline-offset-4 transition-colors hover:text-accent-hover"}
    >
      {iconOnly ? <CoffeeIcon /> : (
        <>
          {children}
          <span aria-hidden="true">↗</span>
          <span className="sr-only"> (opens in a new tab)</span>
        </>
      )}
    </a>
  );
}
