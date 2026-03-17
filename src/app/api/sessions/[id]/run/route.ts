// AI 토론 실행 API - 페르소나 설정 + API 키 클라이언트 수신 버전
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/prisma";
import { sessions, finalSummaries } from "@/lib/schema";
import { runDebateSession, PersonaConfig } from "@/lib/orchestrator";
import { eq, and } from "drizzle-orm";
import { DEFAULT_PERSONAS } from "@/lib/prompts";

// Vercel 서버리스 함수 최대 실행 시간 설정 (초)
// 왜: AI 토론은 여러 번의 Gemini API 호출이 순차적으로 일어나므로 긴 실행 시간 필요
// Hobby: 최대 60초, Pro: 최대 300초로 자동 조정됨
export const maxDuration = 300;

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
  // 왜: Vercel Hobby 플랜의 60초 타임아웃으로 세션이 running 상태로 잠길 수 있음
  // 5분 이상 running이면 stuck으로 간주하고 재실행 허용
  if (session.status === "running") {
    const startedAt = session.startedAt ? new Date(session.startedAt).getTime() : 0;
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    if (startedAt > fiveMinutesAgo) {
      return NextResponse.json({ success: false, data: null, error: "이미 실행 중인 세션입니다. 5분 후 재시도해주세요." }, { status: 409 });
    }
    // 5분 이상 stuck → 상태 리셋 후 재실행 허용
    console.log(`[API] 세션 ${sessionId}이 5분 이상 running 상태 → 리셋 후 재실행`);
  }
  if (session.status === "completed") {
    return NextResponse.json({ success: false, data: null, error: "이미 완료된 세션입니다." }, { status: 409 });
  }

  // 클라이언트에서 페르소나 설정과 API 키를 받아옴
  let body: { personas?: PersonaConfig[]; apiKey?: string; globalDirective?: string } = {};
  try {
    body = await req.json();
  } catch {
    // body 없으면 기본값 사용
  }

  const personas: PersonaConfig[] = body.personas ?? DEFAULT_PERSONAS;
  const apiKey = body.apiKey || undefined;
  const globalDirective = body.globalDirective || undefined;

  try {
    // 왜: globalDirective를 전달해야 상위 지침이 모든 페르소나에 적용됨
    await runDebateSession(sessionId, personas, apiKey, globalDirective);
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
