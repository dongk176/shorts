import { forwardRef, lazy } from 'react';
export const usePathname = () => '/ranking-shorts';
export const useRouter = () => ({push() {}, replace() {}, prefetch() {}});
export const useSearchParams = () => new URLSearchParams();
export const useUsageState = () => ({refreshUsage: async () => {}});
export const useRankingDraft = () => ({loaded: true, status: '로컬 전송량 시험', clear: async () => {}});
export const Link = forwardRef<HTMLAnchorElement, any>(function Link({href, prefetch: _prefetch, ...props}, ref) {
  return <a ref={ref} href={href} {...props} />;
});
export const dynamic = (loader: any) => lazy(loader);
