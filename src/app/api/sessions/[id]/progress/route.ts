// 세션 진행률 경량 조회 API - 폴링 최적화
// 왜: 토론 실행 중 3초 간격으로 호출되므로 최소한의 데이터만 반환
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/prisma";
import { sessions, messages } from "@/lib/schema";
import { eq, and, count } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const authSession = await auth();
  if (!authSession?.user?.id) {
    return NextResponse.json({ success: false, error: "인증 필요" }, { status: 401 });
  }

  const { id: sessionId } = await params;

  // 세션 기본 정보 조회
  const [session] = await db
    .select({
      status: sessions.status,
      rounds: sessions.rounds,
    })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, authSession.user.id)))
    .limit(1);

  if (!session) {
    return NextResponse.json({ success: false, error: "세션 없음" }, { status: 404 });
  }

  // 저장된 메시지 수로 진행률 계산
  const [{ value: messageCount }] = await db
    .select({ value: count() })
    .from(messages)
    .where(eq(messages.sessionId, sessionId));

  // 최근 메시지의 speaker 가져오기 (현재 단계 표시용)
  const recentMessages = await db
    .select({ speaker: messages.speaker, roleType: messages.roleType, roundNo: messages.roundNo })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt)
    .limit(50);

  const lastMessage = recentMessages.length > 0 ? recentMessages[recentMessages.length - 1] : null;

  return NextResponse.json({
    success: true,
    data: {
      status: session.status,
      messageCount,
      rounds: session.rounds ?? 2,
      lastSpeaker: lastMessage?.speaker ?? null,
      lastRound: lastMessage?.roundNo ?? 0,
    },
  });
}
