// AI 토론 실행 API - Drizzle 버전
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/prisma";
import { sessions, finalSummaries } from "@/lib/schema";
import { runDebateSession } from "@/lib/orchestrator";
import { eq, and } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const authSession = await auth();
  if (!authSession?.user?.id) {
    return NextResponse.json({ success: false, data: null, error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { id: sessionId } = await params;

  const [session] = await db
    .select().from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, authSession.user.id)))
    .limit(1);

  if (!session) {
    return NextResponse.json({ success: false, data: null, error: "세션을 찾을 수 없습니다." }, { status: 404 });
  }
  if (session.status === "running") {
    return NextResponse.json({ success: false, data: null, error: "이미 실행 중인 세션입니다." }, { status: 409 });
  }
  if (session.status === "completed") {
    return NextResponse.json({ success: false, data: null, error: "이미 완료된 세션입니다." }, { status: 409 });
  }

  try {
    await runDebateSession(sessionId);
    const [finalSummary] = await db.select().from(finalSummaries).where(eq(finalSummaries.sessionId, sessionId)).limit(1);
    return NextResponse.json({ success: true, data: { sessionId, finalSummary: finalSummary ?? null }, error: null });
  } catch (err) {
    console.error("[API] 토론 실행 오류:", err);
    return NextResponse.json(
      { success: false, data: null, error: "AI 토론 실행 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." },
      { status: 500 }
    );
  }
}
