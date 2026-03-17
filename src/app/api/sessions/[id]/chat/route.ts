// Moderator 채팅 API - 토론 완료 후 추가 질문/수정 요청 처리
// SSE 스트리밍으로 Moderator의 답변을 실시간 전송
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/prisma";
import { sessions } from "@/lib/schema";
import { runModeratorChat } from "@/lib/orchestrator";
import { eq, and } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const authSession = await auth();
  if (!authSession?.user?.id) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", data: { message: "로그인이 필요합니다." } })}\n\n`,
      { status: 401, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const { id: sessionId } = await params;

  // 완료된 세션만 채팅 허용
  const [session] = await db
    .select().from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, authSession.user.id)))
    .limit(1);

  if (!session) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", data: { message: "세션을 찾을 수 없습니다." } })}\n\n`,
      { status: 404, headers: { "Content-Type": "text/event-stream" } }
    );
  }
  if (session.status !== "completed") {
    return new Response(
      `data: ${JSON.stringify({ type: "error", data: { message: "완료된 토론 세션에서만 채팅할 수 있습니다." } })}\n\n`,
      { status: 400, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const body: { message: string; apiKey?: string } = await req.json();
  if (!body.message?.trim()) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", data: { message: "메시지를 입력해주세요." } })}\n\n`,
      { status: 400, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const apiKey = body.apiKey || undefined;

  // SSE 스트림 구성
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const sendChunk = (text: string) => {
    writer.write(encoder.encode(`data: ${JSON.stringify({ type: "chunk", data: { text } })}\n\n`)).catch(console.error);
  };

  // 채팅 응답을 백그라운드에서 스트리밍
  runModeratorChat({
    sessionId,
    userQuestion: body.message,
    apiKey,
    onChunk: sendChunk,
  })
    .then((fullContent) => {
      // 응답 완료 이벤트
      writer.write(encoder.encode(`data: ${JSON.stringify({ type: "done", data: { content: fullContent } })}\n\n`)).catch(console.error);
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : "Moderator 응답 중 오류가 발생했습니다.";
      console.error("[API/chat] 오류:", error);
      writer.write(encoder.encode(`data: ${JSON.stringify({ type: "error", data: { message } })}\n\n`)).catch(console.error);
    })
    .finally(() => {
      writer.close().catch(console.error);
    });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
