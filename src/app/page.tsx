// 루트 페이지 - 로그인 화면으로 리디렉션
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function Home() {
  const session = await auth();
  // 로그인된 경우 대시보드로, 아니면 로그인 페이지로
  if (session) redirect("/dashboard");
  else redirect("/login");
}
