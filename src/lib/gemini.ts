// Gemini API 호출 유틸리티
// 서버 측에서만 호출되어야 함 (API 키 보안)
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

// 안전 설정 (AI 토론 문맥에서 과도한 차단 방지)
const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

export interface GeminiResponse {
  content: string;
  tokenUsageInput: number;
  tokenUsageOutput: number;
}

// 429 오류 메시지에서 "retry in Xs" 초를 파싱하는 헬퍼
function parseRetryDelay(errorMessage: string): number {
  const match = errorMessage.match(/retry in (\d+)/i);
  // 명시된 대기 시간 + 5초 여유 (기본값 65초)
  return match ? parseInt(match[1], 10) * 1000 + 5000 : 65000;
}

// 지정한 ms만큼 대기
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 429 오류인지 확인
function isRateLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes("429") || msg.includes("Too Many Requests") || msg.includes("RESOURCE_EXHAUSTED");
}

/**
 * Gemini API를 호출하여 응답을 받아옴 (일반 버전 - 완성된 응답 반환)
 * 429 오류 시 자동으로 1회 재시도 (자동 대기 후)
 */
export async function callGemini(
  systemPrompt: string,
  userMessage: string,
  apiKey?: string,
  modelName: string = "gemini-2.0-flash"
): Promise<GeminiResponse> {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini API 키가 설정되지 않았습니다. 설정 페이지에서 API 키를 입력해주세요.");

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
    safetySettings,
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
  });

  async function attempt(): Promise<GeminiResponse> {
    const result = await model.generateContent(userMessage);
    const response = result.response;
    const content = response.text();
    const usageMeta = response.usageMetadata;
    return {
      content,
      tokenUsageInput: usageMeta?.promptTokenCount ?? 0,
      tokenUsageOutput: usageMeta?.candidatesTokenCount ?? 0,
    };
  }

  try {
    return await attempt();
  } catch (error) {
    if (isRateLimitError(error)) {
      const waitMs = parseRetryDelay(error instanceof Error ? error.message : "");
      console.warn(`[Gemini] 429 Rate Limit - ${waitMs / 1000}초 대기 후 재시도...`);
      await sleep(waitMs);
      return await attempt(); // 1회 재시도
    }
    throw error;
  }
}

/**
 * Gemini API 스트리밍 버전 - 청크 단위로 onChunk 콜백 호출
 * 429 오류 시 지정 대기 후 자동 재시도 (최대 2회)
 * 무료 티어: 분당 15회 제한 → 페르소나 간 딜레이(orchestrator)와 함께 사용
 */
export async function callGeminiStream(
  systemPrompt: string,
  userMessage: string,
  apiKey: string | undefined,
  onChunk: (text: string) => void,
  modelName: string = "gemini-2.0-flash"
): Promise<GeminiResponse> {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini API 키가 설정되지 않았습니다. 설정 페이지에서 API 키를 입력해주세요.");

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
    safetySettings,
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
  });

  // 최대 2번 재시도 (429 대기 포함)
  const MAX_RETRIES = 2;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await model.generateContentStream(userMessage);

      let fullContent = "";
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          fullContent += text;
          onChunk(text);
        }
      }

      const finalResponse = await result.response;
      const usageMeta = finalResponse.usageMetadata;
      return {
        content: fullContent,
        tokenUsageInput: usageMeta?.promptTokenCount ?? 0,
        tokenUsageOutput: usageMeta?.candidatesTokenCount ?? 0,
      };

    } catch (error) {
      const isLastAttempt = attempt === MAX_RETRIES;

      if (isRateLimitError(error) && !isLastAttempt) {
        // 429: 오류 메시지에서 대기 시간 파싱 후 자동 대기
        const waitMs = parseRetryDelay(error instanceof Error ? error.message : "");
        console.warn(`[Gemini Stream] 429 Rate Limit - ${waitMs / 1000}초 대기 후 재시도 (${attempt + 1}/${MAX_RETRIES})...`);
        // 클라이언트에 대기 중임을 알림 (빈 청크 대신 상태 알림)
        onChunk(`\n\n⏳ API 요청 한도 초과. ${Math.round(waitMs / 1000)}초 후 자동 재시도합니다...\n\n`);
        await sleep(waitMs);
        // 재시도 전 이전에 보낸 임시 메시지 제거를 알림
        continue;
      }

      throw error; // 마지막 시도 실패이거나 429가 아닌 오류면 그냥 throw
    }
  }

  // 여기까지 오면 안 되지만 타입 만족을 위해
  throw new Error("최대 재시도 횟수 초과");
}
