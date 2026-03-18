/**
 * Gemini REST API 직접 호출 유틸리티
 * ─────────────────────────────────────────────────────────────
 * @google/generative-ai SDK는 내부적으로 v1beta 엔드포인트를
 * 하드코딩해서 신규 API 키에서 404가 발생합니다.
 * → SDK 없이 fetch로 v1 REST API를 직접 호출해 문제를 근본 해결합니다.
 *
 * API endpoint: https://generativelanguage.googleapis.com/v1/models/{model}:generateContent
 * Streaming:    https://generativelanguage.googleapis.com/v1/models/{model}:streamGenerateContent?alt=sse
 * ─────────────────────────────────────────────────────────────
 */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1/models";
const DEFAULT_MODEL = "gemini-1.5-flash";

// ─── 타입 정의 ────────────────────────────────────────────────

export interface GeminiResponse {
  content: string;
  tokenUsageInput: number;
  tokenUsageOutput: number;
}

/** Gemini REST API 요청 바디 형식 */
interface GeminiRequestBody {
  system_instruction?: { parts: [{ text: string }] };
  contents: { role: string; parts: { text: string }[] }[];
  generationConfig?: Record<string, unknown>;
  safetySettings?: { category: string; threshold: string }[];
}

// ─── 안전 설정 (과도한 차단 방지) ──────────────────────────────

const SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
];

// ─── 공통 유틸 ────────────────────────────────────────────────

/** 지정한 ms만큼 대기 */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 429 오류 메시지에서 'retry in Xs' 초를 파싱 */
function parseRetryDelay(msg: string): number {
  const m = msg.match(/retry in (\d+)/i);
  return m ? parseInt(m[1], 10) * 1000 + 5000 : 65000;
}

/** 429 여부 확인 */
function isRateLimit(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes("429") || msg.includes("Too Many Requests") || msg.includes("RESOURCE_EXHAUSTED");
}

/** REST API 요청 바디 조립 */
function buildBody(systemPrompt: string, userMessage: string): GeminiRequestBody {
  return {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userMessage }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
    safetySettings: SAFETY_SETTINGS,
  };
}

// ─── callGemini (일반 / 완성 응답) ────────────────────────────

/**
 * Gemini에 요청해 완성된 응답 텍스트를 반환합니다.
 * 429 발생 시 1회 자동 재시도합니다.
 */
export async function callGemini(
  systemPrompt: string,
  userMessage: string,
  apiKey?: string,
  modelName: string = DEFAULT_MODEL
): Promise<GeminiResponse> {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini API 키가 설정되지 않았습니다.");

  const url = `${GEMINI_BASE}/${modelName}:generateContent?key=${key}`;

  async function attempt(): Promise<GeminiResponse> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildBody(systemPrompt, userMessage)),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`[${res.status}] ${errText}`);
    }

    const json = await res.json();
    const content: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const usageMeta = json.usageMetadata ?? {};

    return {
      content,
      tokenUsageInput:  usageMeta.promptTokenCount     ?? 0,
      tokenUsageOutput: usageMeta.candidatesTokenCount ?? 0,
    };
  }

  try {
    return await attempt();
  } catch (error) {
    if (isRateLimit(error)) {
      const wait = parseRetryDelay(error instanceof Error ? error.message : "");
      console.warn(`[Gemini] 429 - ${wait / 1000}초 대기 후 재시도`);
      await sleep(wait);
      return await attempt();
    }
    throw error;
  }
}

// ─── callGeminiStream (SSE 스트리밍) ──────────────────────────

/**
 * Gemini SSE 스트리밍 버전.
 * 청크가 올 때마다 onChunk 콜백을 호출합니다.
 * 429 발생 시 최대 2회 자동 재시도합니다.
 */
export async function callGeminiStream(
  systemPrompt: string,
  userMessage: string,
  apiKey: string | undefined,
  onChunk: (text: string) => void,
  modelName: string = DEFAULT_MODEL
): Promise<GeminiResponse> {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini API 키가 설정되지 않았습니다.");

  const url = `${GEMINI_BASE}/${modelName}:streamGenerateContent?alt=sse&key=${key}`;
  const MAX_RETRIES = 2;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody(systemPrompt, userMessage)),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`[${res.status}] ${errText}`);
      }

      // SSE 스트림을 줄 단위로 파싱
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // 마지막 불완전한 줄은 버퍼에 보관

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;

          try {
            const chunk = JSON.parse(jsonStr);
            const text: string = chunk.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
            if (text) {
              fullContent += text;
              onChunk(text);
            }
            // 마지막 청크에 usageMetadata 포함될 수 있음
            if (chunk.usageMetadata) {
              inputTokens  = chunk.usageMetadata.promptTokenCount     ?? 0;
              outputTokens = chunk.usageMetadata.candidatesTokenCount ?? 0;
            }
          } catch {
            // JSON 파싱 실패 무시 (불완전한 청크)
          }
        }
      }

      return { content: fullContent, tokenUsageInput: inputTokens, tokenUsageOutput: outputTokens };

    } catch (error) {
      if (isRateLimit(error) && attempt < MAX_RETRIES) {
        const wait = parseRetryDelay(error instanceof Error ? error.message : "");
        console.warn(`[Gemini Stream] 429 - ${wait / 1000}초 대기 후 재시도 (${attempt + 1}/${MAX_RETRIES})`);
        onChunk(`\n\n⏳ API 한도 초과. ${Math.round(wait / 1000)}초 후 자동 재시도합니다...\n\n`);
        await sleep(wait);
        continue;
      }
      throw error;
    }
  }

  throw new Error("최대 재시도 횟수 초과");
}
