// AI 토론 오케스트레이터 - SSE 스트리밍 버전
// 각 페르소나 발언을 청크 단위로 실시간 전송하여 Vercel 60초 타임아웃 해결
import { db } from "./prisma";
import { sessions, messages, finalSummaries } from "./schema";
import { callGeminiStream, callGemini } from "./gemini";
import { MODERATOR_SYSTEM_PROMPT, buildDebateContext } from "./prompts";
import { eq, asc } from "drizzle-orm";

// 페르소나 정의 타입 - 클라이언트에서 커스터마이징 가능
export interface PersonaConfig {
  id: "a" | "b" | "c" | "d";
  name: string;          // 표시 이름 (예: "전략 기획가 A")
  systemPrompt: string;  // 이 페르소나의 역할/성향 정의
  active: boolean;       // 토론 참가 여부
}

// SSE 이벤트 타입 정의 - 클라이언트와 서버 간 통신 계약
export type SseEventType =
  | "start"         // 새 발언자 시작 (누가 말하기 시작했는지)
  | "chunk"         // 텍스트 청크 (타이핑 효과)
  | "message_done"  // 해당 발언자 발언 완료 + DB 저장 완료
  | "done"          // 전체 토론 완료 + 최종 기획안
  | "error";        // 에러 발생

// SSE 이벤트 데이터 페이로드 타입별 정의
export interface SseEventData {
  start: { speaker: string; roundNo: number; roleType: string };
  chunk: { text: string };
  message_done: { speaker: string; roundNo: number; content: string; roleType: string };
  done: { sessionId: string };
  error: { message: string };
}

// send 함수 타입 - route.ts에서 구현해서 넘겨줌
export type SseSender = <T extends SseEventType>(
  type: T,
  data: SseEventData[T]
) => void;

// 메시지 저장 헬퍼
async function saveMessage(params: {
  sessionId: string;
  roleType: string;
  speaker: string;
  roundNo: number;
  content: string;
  tokenUsageInput?: number;
  tokenUsageOutput?: number;
}) {
  await db.insert(messages).values({
    sessionId: params.sessionId,
    roleType: params.roleType,
    speaker: params.speaker,
    roundNo: params.roundNo,
    content: params.content,
    tokenUsageInput: params.tokenUsageInput ?? 0,
    tokenUsageOutput: params.tokenUsageOutput ?? 0,
  });
}

// 현재까지의 세션 메시지 조회
async function getSessionMessages(sessionId: string) {
  return db
    .select({ speaker: messages.speaker, content: messages.content, roleType: messages.roleType })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.createdAt));
}

/**
 * SSE 스트리밍 방식으로 토론 세션을 실행하는 메인 함수
 * - 각 페르소나 발언을 청크 단위로 즉시 클라이언트에 전송
 * - Vercel 60초 타임아웃 해결: 첫 이벤트 전송 후 연결이 유지됨
 *
 * @param sessionId - 실행할 세션 ID
 * @param personas  - 활성화된 페르소나 배열 (2~4명)
 * @param apiKey    - 클라이언트에서 전달한 Gemini API 키
 * @param send      - SSE 이벤트 전송 함수 (route.ts에서 구현)
 */
export async function runDebateSessionStream(
  sessionId: string,
  personas: PersonaConfig[],
  apiKey: string | undefined,
  send: SseSender
): Promise<void> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (!session) throw new Error(`세션을 찾을 수 없음: ${sessionId}`);
  if (session.status === "completed") throw new Error("이미 완료된 세션입니다.");

  // 활성화된 페르소나만 필터링
  const activePersonas = personas.filter((p) => p.active);
  if (activePersonas.length < 2) throw new Error("최소 2명의 페르소나가 필요합니다.");

  await db.update(sessions)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(sessions.id, sessionId));

  try {
    const totalRounds = session.rounds ?? 2;

    // === 페르소나 토론 라운드 ===
    for (let round = 1; round <= totalRounds; round++) {
      for (const persona of activePersonas) {
        const prevMessages = await getSessionMessages(sessionId);

        // 라운드 및 순서에 따른 발언 지시 생성
        const isFirstRound = round === 1;
        const isFirstSpeaker = prevMessages.filter((m) => m.roleType === `persona_${persona.id}`).length === 0;
        const otherSpeakers = activePersonas
          .filter((p) => p.id !== persona.id)
          .map((p) => p.name)
          .join(", ");

        const task = isFirstRound && isFirstSpeaker
          ? `이 기획안을 당신의 관점에서 처음으로 분석하고, 문제점뿐만 아니라 구체적인 개선 방향까지 제시하세요.`
          : `라운드 ${round}입니다. ${otherSpeakers}의 최근 발언을 참고하여, 당신의 관점에서 논점을 발전시키고 더 구체적인 대안을 제시하세요.`;

        const context = buildDebateContext({
          rawInput: session.rawInput,
          additionalConstraints: session.additionalConstraints,
          previousMessages: prevMessages,
          currentTask: task,
          outputTone: session.outputTone ?? "standard",
        });

        // 발언 시작 이벤트 - 클라이언트에서 새 말풍선 생성
        send("start", {
          speaker: persona.name,
          roundNo: round,
          roleType: `persona_${persona.id}`,
        });

        // 스트리밍으로 Gemini 호출 - 각 청크를 즉시 클라이언트에 전송
        let accumulatedContent = "";
        const response = await callGeminiStream(
          persona.systemPrompt,
          context,
          apiKey,
          (text) => {
            accumulatedContent += text;
            send("chunk", { text });
          }
        );

        // DB에 저장 후 완료 이벤트 전송
        await saveMessage({
          sessionId,
          roleType: `persona_${persona.id}`,
          speaker: persona.name,
          roundNo: round,
          content: response.content,
          tokenUsageInput: response.tokenUsageInput,
          tokenUsageOutput: response.tokenUsageOutput,
        });

        send("message_done", {
          speaker: persona.name,
          roundNo: round,
          content: response.content,
          roleType: `persona_${persona.id}`,
        });
      }
    }

    // === Moderator 최종 기획안 ===
    const allMessages = await getSessionMessages(sessionId);
    const participantNames = activePersonas.map((p) => p.name).join(", ");
    const moderatorContext = buildDebateContext({
      rawInput: session.rawInput,
      additionalConstraints: session.additionalConstraints,
      previousMessages: allMessages,
      currentTask: `${participantNames}의 전체 토론 내용을 바탕으로, 원본 기획안을 대폭 발전시킨 완성된 기획서를 작성하세요. 단순 요약이 아닌, 실제 개발에 착수 가능한 수준의 구체적인 기획서여야 합니다.`,
      outputTone: session.outputTone ?? "standard",
    });

    // Moderator도 스트리밍으로 실행
    send("start", {
      speaker: "Moderator",
      roundNo: 0,
      roleType: "moderator",
    });

    const moderatorResponse = await callGeminiStream(
      MODERATOR_SYSTEM_PROMPT,
      moderatorContext,
      apiKey,
      (text) => {
        send("chunk", { text });
      }
    );

    // Moderator 메시지 DB 저장
    await saveMessage({
      sessionId,
      roleType: "moderator",
      speaker: "Moderator",
      roundNo: 0,
      content: moderatorResponse.content,
      tokenUsageInput: moderatorResponse.tokenUsageInput,
      tokenUsageOutput: moderatorResponse.tokenUsageOutput,
    });

    send("message_done", {
      speaker: "Moderator",
      roundNo: 0,
      content: moderatorResponse.content,
      roleType: "moderator",
    });

    // finalSummaries 테이블에도 파싱해서 저장
    const finalContent = moderatorResponse.content;
    await db.insert(finalSummaries).values({
      sessionId,
      finalBrief: extractSection(finalContent, "최종 컨셉") || extractSection(finalContent, "제품 컨셉") || "최종 기획안을 확인하세요.",
      keyIssues: JSON.stringify(extractList(finalContent, "핵심 기능")),
      recommendedMvp: extractSection(finalContent, "MVP") || finalContent.substring(0, 500),
      risks: JSON.stringify(extractList(finalContent, "리스크")),
      nextActions: JSON.stringify(extractList(finalContent, "로드맵")),
    });

    await db.update(sessions)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(sessions.id, sessionId));

    // 전체 완료 이벤트 - 클라이언트에서 최종 데이터 재로드
    send("done", { sessionId });

  } catch (error) {
    await db.update(sessions).set({ status: "failed" }).where(eq(sessions.id, sessionId));
    console.error(`[Orchestrator] 세션 ${sessionId} 실패:`, error);
    const message = error instanceof Error ? error.message : "AI 토론 실행 중 오류가 발생했습니다.";
    send("error", { message });
    throw error;
  }
}

/**
 * Moderator 채팅용 - 일반(비스트리밍) 호출
 * 토론 기록 + 최종 기획안을 컨텍스트로 Moderator가 추가 질문에 답변
 */
export async function runModeratorChat(params: {
  sessionId: string;
  userQuestion: string;
  apiKey?: string;
  onChunk: (text: string) => void;
}): Promise<string> {
  const { sessionId, userQuestion, apiKey, onChunk } = params;

  // 토론 기록 불러오기
  const sessionMessages = await getSessionMessages(sessionId);

  // Moderator 최종안을 컨텍스트에 포함하여 연속성 유지
  const chatContext = `## 이전 토론 기록
${sessionMessages.map((m) => `**[${m.speaker}]**\n${m.content}`).join("\n\n---\n\n")}

## 사용자 추가 질문
${userQuestion}

## 지시
위 토론 내용과 최종 기획안을 바탕으로 사용자의 질문에 구체적으로 답변하세요.
기획안을 수정하거나 특정 부분을 더 구체화해달라는 요청이라면, 해당 섹션을 완전히 다시 작성하여 제시하세요.`;

  const MODERATOR_CHAT_PROMPT = `${MODERATOR_SYSTEM_PROMPT}

## 채팅 모드 추가 지시
- 사용자가 기획안 특정 부분 수정을 요청하면 해당 섹션 전체를 다시 작성
- 추가 정보나 구체화를 요청하면 기존 기획안 맥락에서 확장하여 답변
- 항상 실행 가능하고 구체적인 내용만 포함`;

  const response = await callGeminiStream(MODERATOR_CHAT_PROMPT, chatContext, apiKey, onChunk);
  return response.content;
}

// ─── 파싱 유틸리티 ───────────────────────────────
function extractSection(text: string, sectionTitle: string): string {
  const regex = new RegExp(`###[^#]*${sectionTitle}[\\s\\S]*?\\n([^#]+)`, "i");
  const match = text.match(regex);
  return match ? match[1].trim() : "";
}

function extractList(text: string, sectionTitle: string): string[] {
  const section = extractSection(text, sectionTitle);
  if (!section) return [];
  return section.split("\n").map((l) => l.replace(/^[-*\d.]+\s*/, "").trim()).filter((l) => l.length > 0);
}
