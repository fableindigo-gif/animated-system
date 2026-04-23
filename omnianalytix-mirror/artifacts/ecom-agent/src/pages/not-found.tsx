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

  // OS-aware shortcut hint for the command palette
  const isMac =
    typeof navigator !== "undefined" &&
    /(Mac|iPhone|iPad|iPod)/i.test(navigator.platform || navigator.userAgent || "");
  const modKey = isMac ? "⌘" : "Ctrl";

  const openPalette = () => {
    window.dispatchEvent(new CustomEvent("omni:open-command-palette"));
  };

  return (
    <div className="min-h-[80dvh] w-full flex items-center justify-center">
      <div className="text-center px-6 max-w-md">
        <span className="material-symbols-outlined text-[64px] text-outline-variant/40 mb-4 block">explore_off</span>
        <h1 className="text-3xl font-bold text-on-surface tracking-tight">Page not found</h1>
        <p className="mt-3 text-sm text-on-surface-variant leading-relaxed">
          The page you're looking for doesn't exist or may have been moved. Try one of these next steps:
        </p>
        <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/">
            <button className="inline-flex items-center gap-2 bg-primary-container text-white px-5 py-3 rounded-2xl text-sm font-semibold hover:bg-primary-m3 active:scale-[0.98] transition-all min-h-[44px]">
              <span className="material-symbols-outlined text-sm">arrow_back</span>
              Back to Dashboard
            </button>
          </Link>
          <button
            onClick={openPalette}
            className="inline-flex items-center gap-2 bg-white text-on-surface border border-outline-variant/40 px-5 py-3 rounded-2xl text-sm font-semibold hover:bg-surface-container-low active:scale-[0.98] transition-all min-h-[44px]"
          >
            <span className="material-symbols-outlined text-sm">search</span>
            Open Command Palette
            <kbd className="ml-1 text-[10px] font-mono text-on-surface-variant bg-surface border border-outline-variant/30 rounded px-1.5 py-0.5">{modKey} K</kbd>
          </button>
        </div>
        <p className="mt-5 text-[11px] text-on-surface-variant/80">
          Tip: press <kbd className="font-mono text-[10px] bg-surface border border-outline-variant/30 rounded px-1 py-0.5">{modKey} K</kbd> anywhere to search commands.
        </p>
      </div>
    </div>
  );
}
