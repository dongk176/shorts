/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    const paymentTestHeaders = [
      { key: "Cache-Control", value: "no-store, max-age=0" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
    ];
    return [
      { source: "/payment-test", headers: paymentTestHeaders },
      { source: "/api/payment-test/:path*", headers: paymentTestHeaders },
    ];
  },
};

export default nextConfig;
