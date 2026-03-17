// 세션 상세 조회 API - Drizzle 버전
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/prisma";
import { sessions, messages, finalSummaries } from "@/lib/schema";
import { eq, and, asc } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
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

  const [messageList, [finalSummary]] = await Promise.all([
    db.select().from(messages).where(eq(messages.sessionId, sessionId)).orderBy(asc(messages.createdAt)),
    db.select().from(finalSummaries).where(eq(finalSummaries.sessionId, sessionId)).limit(1),
  ]);

  return NextResponse.json({
    success: true,
    data: { ...session, messages: messageList, finalSummary: finalSummary ?? null },
    error: null,
  });
}
