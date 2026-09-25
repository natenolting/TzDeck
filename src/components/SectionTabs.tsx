"use client";

import { useRef } from "react";

export type SectionTab<Id extends string> = {
  id: Id;
  label: string;
  /**
   * Shown instead of `label` on narrow screens, where the full labels don't
   * fit. It must be a word from `label`: the tab keeps `label` as its
   * accessible name, and the visible text has to be part of that name.
   */
  shortLabel?: string;
  icon: React.ReactNode;
  /** Trailing content after the label, such as a count or a status dot. */
  badge?: React.ReactNode;
};

/** The DOM id of a tab, so its panel can name it in `aria-labelledby`. */
export const sectionTabId = (id: string) => `section-tab-${id}`;

/** The DOM id of a tab's panel, so the tab can name it in `aria-controls`. */
export const sectionPanelId = (id: string) => `section-panel-${id}`;

/**
 * The app's top-level sections as a WAI-ARIA tablist. Only the selected tab is
 * in the Tab order; Left/Right move between tabs (wrapping) and Home/End jump
 * to the ends, selecting as focus moves because switching sections is instant
 * client state. Only the selected section's panel is rendered, so only the
 * selected tab points at it with `aria-controls`; that panel is expected to
 * carry `role="tabpanel"`, `id={sectionPanelId(id)}` and
 * `aria-labelledby={sectionTabId(id)}`.
 */
export default function SectionTabs<Id extends string>({
  tabs,
  selected,
  onSelect,
  label,
  className = "",
}: {
  tabs: SectionTab<Id>[];
  selected: Id;
  onSelect: (id: Id) => void;
  /** Accessible name for the tablist as a whole. */
  label: string;
  className?: string;
}) {
  const tabRefs = useRef(new Map<Id, HTMLButtonElement>());

  const selectAndFocus = (index: number) => {
    const tab = tabs[(index + tabs.length) % tabs.length];
    onSelect(tab.id);
    tabRefs.current.get(tab.id)?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    const target = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: tabs.length - 1,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    selectAndFocus(target);
  };

  return (
    <div role="tablist" aria-label={label} className={className}>
      {tabs.map((tab, index) => {
        const isSelected = tab.id === selected;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              if (node) tabRefs.current.set(tab.id, node);
              else tabRefs.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={sectionTabId(tab.id)}
            aria-selected={isSelected}
            aria-controls={isSelected ? sectionPanelId(tab.id) : undefined}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`section-tab flex min-h-10 items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors ${
              isSelected
                ? "tab-button-active"
                : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
            }`}
          >
            {tab.icon}
            <span className="inline-flex items-center gap-2">
              <span className={tab.shortLabel ? "tab-label tab-label-has-short" : "tab-label"}>{tab.label}</span>
              {tab.shortLabel && (
                <span aria-hidden="true" className="tab-label-short">
                  {tab.shortLabel}
                </span>
              )}
              {tab.badge}
            </span>
          </button>
        );
      })}
    </div>
  );
}
