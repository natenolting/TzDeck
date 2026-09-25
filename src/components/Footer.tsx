import { ObjktIcon, TwitterIcon } from "./SocialIcons";
import SupportLink from "./SupportLink";

const SOCIAL_LINKS = [
  { label: "Explore OBJKT", href: "https://objkt.com", Icon: ObjktIcon },
  { label: "Twitter / X", href: "https://x.com/tzdeckxyz", Icon: TwitterIcon },
];

export default function Footer() {
  return (
    <footer className="flex items-center justify-between gap-4 border-t border-border-subtle pt-6 text-xs text-text-tertiary">
      <div>
        <p className="font-display text-sm font-bold tracking-wide text-text-secondary">
          TzDeck
        </p>
        <p className="mt-1">Discover art on Tezos.</p>
      </div>
      <nav aria-label="Footer" className="flex flex-wrap items-center gap-2">
        <SupportLink iconOnly />
        {SOCIAL_LINKS.map(({ label, href, Icon }) => (
          <a
            key={href}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${label} (opens in a new tab)`}
            title={label}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-text-secondary transition-colors hover:bg-surface-2 hover:text-accent-hover"
          >
            <Icon />
          </a>
        ))}
      </nav>
    </footer>
  );
}
