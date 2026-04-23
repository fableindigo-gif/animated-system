import { useEffect } from "react";
import { Link } from "wouter";

export default function NotFound() {
  // SEO: SPA returns HTTP 200 for unknown paths, so the only crawler signal
  // we can give for a soft-404 is a `noindex` meta tag. Inject it on mount,
  // remove it on unmount so other pages don't inherit it. Also adjust the
  // document title for tab/back-button context.
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Not found · OmniAnalytix";

    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex,follow";
    document.head.appendChild(meta);

    return () => {
      document.title = previousTitle;
      meta.remove();
    };
  }, []);

  return (
    <div className="min-h-[80vh] w-full flex items-center justify-center">
      <div className="text-center px-6 max-w-md">
        <span className="material-symbols-outlined text-[64px] text-outline-variant/40 mb-4 block">explore_off</span>
        <h1 className="text-3xl font-bold text-on-surface tracking-tight">Page not found</h1>
        <p className="mt-3 text-sm text-on-surface-variant leading-relaxed">
          The page you're looking for doesn't exist or may have been moved.
        </p>
        <Link href="/">
          <button className="mt-6 inline-flex items-center gap-2 bg-primary-container text-white px-6 py-3 rounded-2xl text-sm font-semibold hover:bg-primary-m3 active:scale-[0.98] transition-all">
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            Back to Dashboard
          </button>
        </Link>
      </div>
    </div>
  );
}
