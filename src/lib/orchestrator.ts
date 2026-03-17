// AI 토론 오케스트레이터 - 4명 페르소나 동적 토론 지원 버전
import { db } from "./prisma";
import { sessions, messages, finalSummaries } from "./schema";
import { callGemini } from "./gemini";
import { MODERATOR_SYSTEM_PROMPT, buildDebateContext } from "./prompts";
import { eq, asc } from "drizzle-orm";

// 페르소나 정의 타입 - 클라이언트에서 커스터마이징 가능
export interface PersonaConfig {
  id: "a" | "b" | "c" | "d";
  name: string;          // 표시 이름 (예: "전략 기획가 A")
  systemPrompt: string;  // 이 페르소나의 역할/성향 정의
  active: boolean;       // 토론 참가 여부
}

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
 * 토론 세션 실행 메인 함수
 * @param sessionId   - 실행할 세션 ID
 * @param personas    - 활성화된 페르소나 배열 (2~4명)
 * @param apiKey      - 클라이언트에서 전달한 Gemini API 키
 */
export async function runDebateSession(
  sessionId: string,
  personas: PersonaConfig[],
  apiKey?: string,
  globalDirective?: string
): Promise<void> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (!session) throw new Error(`세션을 찾을 수 없음: ${sessionId}`);
  if (session.status === "completed") throw new Error("이미 완료된 세션입니다.");

  // 활성화된 페르소나만 필터링
  const activePersonas = personas.filter((p) => p.active);
  if (activePersonas.length < 2) throw new Error("최소 2명의 페르소나가 필요합니다.");

  // 왜: stuck된 세션 재실행 시 기존 상태를 리셋해야 함
  // running/failed 상태의 세션이 재시작될 때 startedAt을 갱신
  await db.update(sessions)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(sessions.id, sessionId));

  try {
    const totalRounds = session.rounds ?? 2;

    for (let round = 1; round <= totalRounds; round++) {
      // 각 라운드에서 활성화된 페르소나들이 순서대로 발언
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
          ? `이 기획안을 당신의 관점에서 처음으로 검토하세요.`
          : `라운드 ${round}입니다. ${otherSpeakers}의 최근 발언에 대해 당신의 관점에서 응답하고, 논점을 발전시키세요.`;

        const context = buildDebateContext({
          rawInput: session.rawInput,
          additionalConstraints: session.additionalConstraints,
          previousMessages: prevMessages,
          currentTask: task,
          outputTone: session.outputTone ?? "standard",
        });

        // 상위 지침이 있으면 시스템 프롬프트의 최상단에 절대적 우선순위로 주입
        // 왜: 사용자가 설정한 비즈니스 맥락/제약 조건이 모든 페르소나의 개별 역할보다 우선해야 함
        const fullSystemPrompt = globalDirective
          ? `###### ⚠️ 절대적 상위 지침 (SUPREME DIRECTIVE) ⚠️ ######
아래 상위 지침은 당신의 모든 판단과 발언에 최우선으로 적용됩니다.
이 지침에 위배되는 의견이나 제안은 절대로 하지 마세요.
당신의 전문 역할(페르소나)은 반드시 이 상위 지침의 범위 안에서만 수행하세요.
토론의 모든 판단 기준, 제안, 평가는 이 지침을 기반으로 해야 합니다.

${globalDirective}

###### 상위 지침 끝 ######

${persona.systemPrompt}`
          : persona.systemPrompt;

        let response;
        try {
          response = await callGemini(fullSystemPrompt, context, apiKey);
        } catch {
          // 1회 재시도 (공통 지침 포함된 프롬프트로 재시도)
          response = await callGemini(fullSystemPrompt, context, apiKey);
        }

        await saveMessage({
          sessionId,
          roleType: `persona_${persona.id}`,
          speaker: persona.name,
          roundNo: round,
          content: response.content,
          tokenUsageInput: response.tokenUsageInput,
          tokenUsageOutput: response.tokenUsageOutput,
        });
      }
    }

    // Moderator 최종 정리
    const allMessages = await getSessionMessages(sessionId);
    const participantNames = activePersonas.map((p) => p.name).join(", ");
    const moderatorContext = buildDebateContext({
      rawInput: session.rawInput,
      additionalConstraints: session.additionalConstraints,
      previousMessages: allMessages,
      currentTask: `${participantNames}의 전체 토론 내용을 종합하여 최종 기획안 초안을 작성하세요.`,
      outputTone: session.outputTone ?? "standard",
    });

    let moderatorResponse;
    try {
      moderatorResponse = await callGemini(MODERATOR_SYSTEM_PROMPT, moderatorContext, apiKey);
    } catch {
      moderatorResponse = await callGemini(MODERATOR_SYSTEM_PROMPT, moderatorContext, apiKey);
    }

    await saveMessage({
      sessionId,
      roleType: "moderator",
      speaker: "Moderator",
      roundNo: 0,
      content: moderatorResponse.content,
      tokenUsageInput: moderatorResponse.tokenUsageInput,
      tokenUsageOutput: moderatorResponse.tokenUsageOutput,
    });

    const finalContent = moderatorResponse.content;
    await db.insert(finalSummaries).values({
      sessionId,
      finalBrief: extractSection(finalContent, "최종 컨셉 정의") || "최종 컨셉을 확인하세요.",
      keyIssues: JSON.stringify(extractList(finalContent, "핵심 쟁점")),
      recommendedMvp: extractSection(finalContent, "MVP 범위") || finalContent.substring(0, 500),
      risks: JSON.stringify(extractList(finalContent, "핵심 리스크")),
      nextActions: JSON.stringify(extractList(finalContent, "실행 로드맵")),
    });

    await db.update(sessions)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(sessions.id, sessionId));

  } catch (error) {
    await db.update(sessions).set({ status: "failed" }).where(eq(sessions.id, sessionId));
    console.error(`[Orchestrator] 세션 ${sessionId} 실패:`, error);
    throw error;
  }
}

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
