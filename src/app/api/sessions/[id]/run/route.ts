// AI 토론 실행 API - 페르소나 설정 + API 키 클라이언트 수신 버전
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/prisma";
import { sessions, finalSummaries } from "@/lib/schema";
import { runDebateSession, PersonaConfig } from "@/lib/orchestrator";
import { eq, and } from "drizzle-orm";
import { DEFAULT_PERSONAS } from "@/lib/prompts";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
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

  // 클라이언트에서 페르소나 설정과 API 키를 받아옴
  let body: { personas?: PersonaConfig[]; apiKey?: string } = {};
  try {
    body = await req.json();
  } catch {
    // body 없으면 기본값 사용
  }

  // 페르소나 설정: 클라이언트 제공 or 기본값
  const personas: PersonaConfig[] = body.personas ?? DEFAULT_PERSONAS;
  // API 키: 클라이언트 제공 or 환경변수 (orchestrator 내부에서 처리)
  const apiKey = body.apiKey || undefined;

  try {
    await runDebateSession(sessionId, personas, apiKey);
    const [finalSummary] = await db.select().from(finalSummaries).where(eq(finalSummaries.sessionId, sessionId)).limit(1);
    return NextResponse.json({ success: true, data: { sessionId, finalSummary: finalSummary ?? null }, error: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI 토론 실행 중 오류가 발생했습니다.";
    console.error("[API] 토론 실행 오류:", err);
    return NextResponse.json(
      { success: false, data: null, error: message },
      { status: 500 }
    );
  }
}
