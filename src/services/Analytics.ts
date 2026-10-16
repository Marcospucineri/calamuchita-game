type Params = Record<string, string | number | boolean>;
const id = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;
const analyticsWindow = window as unknown as { dataLayer: unknown[]; gtag?: (...args: unknown[]) => void };
/** No profile names, emails, auth tokens, or exact player coordinates are sent. */
export const analytics = {
  init(): void {
    if (!id || !/^G-[A-Z0-9]+$/.test(id) || navigator.doNotTrack === '1') return;
    analyticsWindow.dataLayer ??= [];
    analyticsWindow.gtag = function (..._args: unknown[]) { analyticsWindow.dataLayer.push(arguments); };
    analyticsWindow.gtag('js', new Date());
    analyticsWindow.gtag('config', id, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
    // OAuth recovery URLs may contain tokens. Never send the current query/hash.
    analyticsWindow.gtag('set', { page_location: location.origin + location.pathname, page_referrer: '' });
    analyticsWindow.gtag('event', 'page_view', { page_location: location.origin + location.pathname });
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    document.head.appendChild(script);
  },
  event(name: string, params: Params = {}): void { analyticsWindow.gtag?.('event', name, params); },
};
