// AI 토론 오케스트레이터 - PostgreSQL(Supabase) 버전
// UUID는 DB가 자동 생성하므로 crypto.randomUUID() 제거
import { db } from "./prisma";
import { sessions, messages, finalSummaries } from "./schema";
import { callGemini } from "./gemini";
import { PERSONA_A_SYSTEM_PROMPT, PERSONA_B_SYSTEM_PROMPT, MODERATOR_SYSTEM_PROMPT, buildDebateContext } from "./prompts";
import { eq, asc } from "drizzle-orm";

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

async function getSessionMessages(sessionId: string) {
  return db
    .select({ speaker: messages.speaker, content: messages.content, roleType: messages.roleType })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.createdAt));
}

export async function runDebateSession(sessionId: string): Promise<void> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (!session) throw new Error(`세션을 찾을 수 없음: ${sessionId}`);
  if (session.status === "completed") throw new Error("이미 완료된 세션입니다.");

  await db.update(sessions)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(sessions.id, sessionId));

  try {
    for (let round = 1; round <= (session.rounds ?? 2); round++) {
      const prevMessages = await getSessionMessages(sessionId);

      // Persona A 발언
      const aTask = round === 1
        ? "이 기획안을 전략적 관점에서 처음으로 검토하세요. 시장성, 차별화, 수익 구조를 중심으로 비판적으로 분석하세요."
        : `라운드 ${round}입니다. Persona B의 최근 반론에 대해 전략적 관점에서 재반박하고, 당신의 주장을 강화하세요.`;

      const aContext = buildDebateContext({
        rawInput: session.rawInput,
        additionalConstraints: session.additionalConstraints,
        previousMessages: prevMessages,
        currentTask: aTask,
        outputTone: session.outputTone ?? "standard",
      });

      let aResponse;
      try { aResponse = await callGemini(PERSONA_A_SYSTEM_PROMPT, aContext); }
      catch { aResponse = await callGemini(PERSONA_A_SYSTEM_PROMPT, aContext); }

      await saveMessage({ sessionId, roleType: "persona_a", speaker: "전략 기획가 A", roundNo: round, content: aResponse.content, tokenUsageInput: aResponse.tokenUsageInput, tokenUsageOutput: aResponse.tokenUsageOutput });

      // Persona B 발언
      const bMessages = await getSessionMessages(sessionId);
      const bTask = round === 1
        ? "이 기획안을 실행 관점에서 검토하고, Persona A의 전략적 비판에 대해 실행 가능성 측면에서 반론하거나 보완 의견을 제시하세요."
        : `라운드 ${round}입니다. Persona A의 재반박에 대해 실행 관점에서 응수하고, MVP 범위와 구체적 실행 계획을 제시하세요.`;

      const bContext = buildDebateContext({
        rawInput: session.rawInput,
        additionalConstraints: session.additionalConstraints,
        previousMessages: bMessages,
        currentTask: bTask,
        outputTone: session.outputTone ?? "standard",
      });

      let bResponse;
      try { bResponse = await callGemini(PERSONA_B_SYSTEM_PROMPT, bContext); }
      catch { bResponse = await callGemini(PERSONA_B_SYSTEM_PROMPT, bContext); }

      await saveMessage({ sessionId, roleType: "persona_b", speaker: "실행 책임자 B", roundNo: round, content: bResponse.content, tokenUsageInput: bResponse.tokenUsageInput, tokenUsageOutput: bResponse.tokenUsageOutput });
    }

    // Moderator 최종 정리
    const allMessages = await getSessionMessages(sessionId);
    const moderatorContext = buildDebateContext({
      rawInput: session.rawInput,
      additionalConstraints: session.additionalConstraints,
      previousMessages: allMessages,
      currentTask: "지금까지의 전체 토론 내용을 종합하여 최종 기획안 초안을 작성하세요.",
      outputTone: session.outputTone ?? "standard",
    });

    let moderatorResponse;
    try { moderatorResponse = await callGemini(MODERATOR_SYSTEM_PROMPT, moderatorContext); }
    catch { moderatorResponse = await callGemini(MODERATOR_SYSTEM_PROMPT, moderatorContext); }

    await saveMessage({ sessionId, roleType: "moderator", speaker: "Moderator", roundNo: 0, content: moderatorResponse.content, tokenUsageInput: moderatorResponse.tokenUsageInput, tokenUsageOutput: moderatorResponse.tokenUsageOutput });

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
