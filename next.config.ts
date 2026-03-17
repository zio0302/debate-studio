// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma를 서버 사이드 번들에서 제외해 Edge 런타임과의 충돌 방지
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  // Turbopack 미사용 (prisma 호환을 위해)
  experimental: {},
};

export default nextConfig;
