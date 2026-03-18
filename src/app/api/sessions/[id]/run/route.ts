// AI 토론 실행 API - SSE 스트리밍 버전
// TransformStream을 이용해 SSE를 즉시 전송 → Vercel 60초 타임아웃 해결
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/prisma";
import { sessions } from "@/lib/schema";
import { runDebateSessionStream, PersonaConfig, SseSender } from "@/lib/orchestrator";
import { eq, and } from "drizzle-orm";
import { DEFAULT_PERSONAS } from "@/lib/prompts";

export const maxDuration = 300; // Vercel Pro/Hobby 최대 허용값 설정

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
  if (session.status === "running") {
    return new Response(
      `data: ${JSON.stringify({ type: "error", data: { message: "이미 실행 중인 세션입니다." } })}\n\n`,
      { status: 409, headers: { "Content-Type": "text/event-stream" } }
    );
  }
  if (session.status === "completed") {
    return new Response(
      `data: ${JSON.stringify({ type: "error", data: { message: "이미 완료된 세션입니다." } })}\n\n`,
      { status: 409, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  // 클라이언트에서 페르소나 설정과 API 키를 받아옴
  let body: { personas?: PersonaConfig[]; apiKey?: string; modelName?: string; apiVersion?: string } = {};
  try {
    body = await req.json();
  } catch {
    // body 없으면 기본값 사용
  }

  const personas: PersonaConfig[] = body.personas ?? DEFAULT_PERSONAS;
  const apiKey = body.apiKey || undefined;
  const modelName = body.modelName || undefined;   // 설정에서 선택한 모델
  const apiVersion = body.apiVersion || undefined; // 설정에서 선택한 API 버전

  // TransformStream으로 SSE 스트림 생성
  // - readable: Response에 전달되어 클라이언트로 전송됨
  // - writable: orchestrator에서 이벤트를 write함
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // SSE 이벤트 전송 헬퍼 - "data: {json}\n\n" 형식이 SSE 표준
  // async로 선언하여 writer.write가 완료될 때까지 대기 → Vercel 버퍼링 방지
  const send: SseSender = async (type, data) => {
    const payload = JSON.stringify({ type, data });
    await writer.write(encoder.encode(`data: ${payload}\n\n`));
  };

  // 오케스트레이터를 백그라운드로 실행 (await 없이)
  // 이렇게 해야 스트림이 먼저 Response로 반환되고, 이후 이벤트들이 순차 전달됨
  runDebateSessionStream(sessionId, personas, apiKey, send, modelName, apiVersion)
    .catch((error) => {
      const message = error instanceof Error ? error.message : "AI 토론 실행 중 오류가 발생했습니다.";
      console.error("[API/run] 오류:", error);
      send("error", { message });
    })
    .finally(() => {
      // 모든 처리가 끝나면 스트림을 닫아 클라이언트에 EOF 신호를 보냄
      writer.close().catch(console.error);
    });

  // SSE Response - 즉시 반환하여 클라이언트 연결 확립
  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Nginx 버퍼링 비활성화 (프록시 환경)
    },
  });
}
