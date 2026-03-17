"use client";
// NextAuth 세션 Provider를 앱 전체에 적용
import { SessionProvider } from "next-auth/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
