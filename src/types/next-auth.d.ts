// NextAuth 세션 타입 확장
// session.user.id를 TypeScript에서 사용 가능하게 함
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
