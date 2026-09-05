import { InstagramIcon, ObjktIcon, TwitterIcon } from "./SocialIcons";

export default function Footer() {
  return (
    <footer className="flex flex-col gap-4 border-t border-border-subtle pt-6 text-xs text-text-tertiary sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-display text-sm font-bold tracking-wide text-text-secondary">
          TzDeck
        </p>
        <p className="mt-1">Discover art on Tezos. Pull. Collect. Discover.</p>
      </div>
      <nav aria-label="Footer" className="flex flex-wrap items-center gap-2">
        <a
          title="Explore OBJKT"
          href="https://objkt.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-text-secondary transition-colors hover:bg-surface-2 hover:text-accent-hover"
        >
          <ObjktIcon />
          <span className="sr-only">Explore OBJKT (opens in a new tab)</span>
        </a>
        <a
          title="Twitter / X"
          href="https://x.com/tzdeckxyz"
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-text-secondary transition-colors hover:bg-surface-2 hover:text-accent-hover"
        >
          <TwitterIcon />
          <span className="sr-only">Twitter / X (opens in a new tab)</span>
        </a>
        <a
          title="Instagram"
          href="https://www.instagram.com/tzdeck/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-text-secondary transition-colors hover:bg-surface-2 hover:text-accent-hover"
        >
          <InstagramIcon />
          <span className="sr-only">Instagram (opens in a new tab)</span>
        </a>
      </nav>
    </footer>
  );
}
