/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  output: "standalone",
  serverExternalPackages: ["postgres"],
  outputFileTracingIncludes: {
    "/api/ebooks/*/download": ["./private/ebooks/*.pdf"],
  },
  poweredByHeader: false,
  images: {
    minimumCacheTTL: 2_678_400,
  },
  async headers() {
    const immutableShowcaseHeaders = [
      { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
    ];
    const revalidatingStaticMediaHeaders = [
      { key: "Cache-Control", value: "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400" },
    ];
    const paymentTestHeaders = [
      { key: "Cache-Control", value: "no-store, max-age=0" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://pay.nicepay.co.kr https://sandbox-pay.nicepay.co.kr" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
    ];
    return [
      { source: "/transformation-showcase/:path*", headers: immutableShowcaseHeaders },
      { source: "/showcase-examples/:path*", headers: immutableShowcaseHeaders },
      { source: "/template-backgrounds/:path*", headers: revalidatingStaticMediaHeaders },
      { source: "/ebook-previews/:path*", headers: revalidatingStaticMediaHeaders },
      { source: "/east-cut-logo.png", headers: revalidatingStaticMediaHeaders },
      { source: "/easy-cut-og-1200x630-v3.jpg", headers: immutableShowcaseHeaders },
      { source: "/payment-test", headers: paymentTestHeaders },
      { source: "/api/payment-test/:path*", headers: paymentTestHeaders },
    ];
  },
};

export default nextConfig;
