/** @type {import('next').NextConfig} */
const nextConfig = {
  // imapflow/mailparser are native-ish Node packages — they must stay external
  // rather than be bundled into the serverless function.
  //
  // This was `serverExternalPackages`, which is the Next 15 spelling. On 14.2.5
  // that key isn't recognised: Next warned "invalid-next-config" and ignored it,
  // so the packages got bundled anyway. Renamed to the 14.x location.
  experimental: {
    serverComponentsExternalPackages: ["imapflow", "mailparser"],
  },
};
module.exports = nextConfig;
