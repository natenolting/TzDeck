// Screenshots one element with true alpha. A screenshot is a rectangle, so a rounded card
// would otherwise carry the page background into its corners, along with the corner arcs of
// any ring or glow drawn outside its edge (a box-shadow the rectangle only half crops). For
// the shot, everything outside the element loses its background, the page itself is omitted,
// and the element is clipped to its own rounded border.
const MARK = 'data-reel-shot';
const ISOLATE = `
  :not([${MARK}]):not([${MARK}] *) { background: transparent !important; box-shadow: none !important; }
  :not([${MARK}]):not([${MARK}] *)::before, :not([${MARK}]):not([${MARK}] *)::after { opacity: 0 !important; }
`;

export async function shotAlone(locator, path) {
  await locator.evaluate((el, mark) => {
    el.setAttribute(mark, '');
    el.dataset.reelClip = el.style.clipPath;
    el.style.clipPath = `inset(0 round ${getComputedStyle(el).borderRadius})`;
  }, MARK);
  await locator.screenshot({ path, omitBackground: true, style: ISOLATE });
  await locator.evaluate((el, mark) => {
    el.removeAttribute(mark);
    el.style.clipPath = el.dataset.reelClip;
    delete el.dataset.reelClip;
  }, MARK);
}
