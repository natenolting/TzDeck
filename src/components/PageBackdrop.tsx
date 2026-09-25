/**
 * The app's background: two slow-drifting glows with a film-grain layer over
 * them to smooth the gradients' banding (see `.page-vignette` and
 * `.page-grain` in globals.css). Both layers are fixed to the viewport, so the
 * content drawn over them needs `relative z-10`, and no ancestor may set a
 * transform, filter or backdrop-filter, which would pin them to that ancestor
 * instead of the viewport.
 */
export default function PageBackdrop() {
  return (
    <>
      <div className="page-vignette pointer-events-none fixed inset-0" aria-hidden="true" />
      <div className="page-grain pointer-events-none fixed inset-0" aria-hidden="true" />
    </>
  );
}
