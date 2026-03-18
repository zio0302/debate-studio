// 실행 중단된 세션을 pending으로 리셋하는 API
// "이미 실행 중인 세션입니다" 오류 해결용
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/prisma";
import { sessions } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  void req; // 사용하지 않는 파라미터 명시적 처리
  const authSession = await auth();
  if (!authSession?.user?.id) {
    return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { id: sessionId } = await params;

  // 내 세션인지 확인 후 pending으로 리셋
  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, authSession.user.id)))
    .limit(1);

  if (!session) {
    return Response.json({ error: "세션을 찾을 수 없습니다." }, { status: 404 });
  }

  if (session.status === "completed") {
    return Response.json({ error: "완료된 세션은 리셋할 수 없습니다." }, { status: 400 });
  }

  // running/failed 상태를 pending으로 리셋
  await db
    .update(sessions)
    .set({ status: "pending", startedAt: null })
    .where(eq(sessions.id, sessionId));

  return Response.json({ success: true, message: "세션이 대기 상태로 리셋되었습니다." });
}
