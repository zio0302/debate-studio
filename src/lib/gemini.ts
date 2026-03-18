/**
 * Gemini REST API 직접 호출 유틸리티
 * ─────────────────────────────────────────────────────────────
 * SDK(@google/generative-ai)가 v1beta를 하드코딩해 신규 API 키에서 404 발생.
 * → SDK 없이 fetch로 REST API를 직접 호출합니다.
 *
 * ⚠️ systemInstruction 필드는 일부 API 버전에서 미지원 → 시스템 프롬프트를
 *    user 메시지 앞에 인라인으로 삽입해 모든 환경에서 호환되도록 합니다.
 *
 * 시도 순서:
 *   1순위: v1beta (gemini-2.0-flash 계열 지원, 신규 키 막힘)
 *   2순위: v1     (gemini-1.5-flash 지원)
 * ─────────────────────────────────────────────────────────────
 */

export interface GeminiResponse {
  content: string;
  tokenUsageInput: number;
  tokenUsageOutput: number;
}

// ─── 상수 ─────────────────────────────────────────────────────

const DEFAULT_MODEL = "gemini-1.5-flash";

/** 시스템 프롬프트를 user 메시지 앞에 붙여 API 호환성 극대화 */
function buildInlinePrompt(systemPrompt: string, userMessage: string): string {
  return `[시스템 지시사항]\n${systemPrompt}\n\n[사용자 메시지]\n${userMessage}`;
}

/** 최소 요청 바디 - systemInstruction 없이 contents만 사용 (가장 넓은 호환성) */
function buildBody(systemPrompt: string, userMessage: string) {
  return {
    contents: [
      {
        role: "user",
        parts: [{ text: buildInlinePrompt(systemPrompt, userMessage) }],
      },
    ],
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
    ],
  };
}

// ─── 공통 유틸 ────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryDelay(msg: string): number {
  const m = msg.match(/retry in (\d+)/i);
  return m ? parseInt(m[1], 10) * 1000 + 5000 : 65000;
}

function isRateLimit(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes("429") || msg.includes("Too Many Requests") || msg.includes("RESOURCE_EXHAUSTED");
}

/**
 * 사용 가능한 API 버전을 순서대로 시도합니다.
 * v1: gemini-1.5-flash 계열 지원
 * v1beta: gemini-2.0-flash 계열 지원 (신규 키에선 모델이 막힐 수 있음)
 */
function getApiUrls(model: string, key: string, streaming: boolean): string[] {
  const action = streaming
    ? `streamGenerateContent?alt=sse&key=${key}`
    : `generateContent?key=${key}`;
  return [
    `https://generativelanguage.googleapis.com/v1/models/${model}:${action}`,
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}`,
  ];
}

// ─── callGemini (완성 응답) ────────────────────────────────────

export async function callGemini(
  systemPrompt: string,
  userMessage: string,
  apiKey?: string,
  modelName: string = DEFAULT_MODEL
): Promise<GeminiResponse> {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini API 키가 설정되지 않았습니다.");

  const urls = getApiUrls(modelName, key, false);
  const body = JSON.stringify(buildBody(systemPrompt, userMessage));

  async function attemptOnce(url: string): Promise<GeminiResponse> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`[${res.status}] ${errText}`);
    }
    const json = await res.json();
    const content: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const usage = json.usageMetadata ?? {};
    return {
      content,
      tokenUsageInput:  usage.promptTokenCount     ?? 0,
      tokenUsageOutput: usage.candidatesTokenCount ?? 0,
    };
  }

  // v1 → v1beta 순서로 시도, 중간에 429면 재시도
  let lastError: unknown;
  for (const url of urls) {
    try {
      return await attemptOnce(url);
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      // 404/모델 없음이면 다음 URL 시도
      if (msg.includes("404")) {
        console.warn(`[Gemini] ${url} → 404, 다음 엔드포인트 시도`);
        continue;
      }
      // 429면 대기 후 같은 URL 재시도
      if (isRateLimit(error)) {
        const wait = parseRetryDelay(msg);
        console.warn(`[Gemini] 429 - ${wait / 1000}초 대기 후 재시도`);
        await sleep(wait);
        return await attemptOnce(url);
      }
      throw error;
    }
  }
  throw lastError ?? new Error("모든 API 엔드포인트 실패");
}

// ─── callGeminiStream (SSE 스트리밍) ──────────────────────────

export async function callGeminiStream(
  systemPrompt: string,
  userMessage: string,
  apiKey: string | undefined,
  onChunk: (text: string) => void,
  modelName: string = DEFAULT_MODEL
): Promise<GeminiResponse> {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini API 키가 설정되지 않았습니다.");

  const urls = getApiUrls(modelName, key, true);
  const body = JSON.stringify(buildBody(systemPrompt, userMessage));

  async function attemptStream(url: string): Promise<GeminiResponse> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`[${res.status}] ${errText}`);
    }

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
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;
        try {
          const chunk = JSON.parse(jsonStr);
          const text: string = chunk.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
          if (text) { fullContent += text; onChunk(text); }
          if (chunk.usageMetadata) {
            inputTokens  = chunk.usageMetadata.promptTokenCount     ?? 0;
            outputTokens = chunk.usageMetadata.candidatesTokenCount ?? 0;
          }
        } catch { /* 불완전한 청크 무시 */ }
      }
    }
    return { content: fullContent, tokenUsageInput: inputTokens, tokenUsageOutput: outputTokens };
  }

  const MAX_RETRIES = 2;
  let lastError: unknown;

  for (const url of urls) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await attemptStream(url);
      } catch (error) {
        lastError = error;
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("404")) {
          console.warn(`[Gemini Stream] ${url} → 404, 다음 엔드포인트 시도`);
          break; // 다음 URL로
        }
        if (isRateLimit(error) && attempt < MAX_RETRIES) {
          const wait = parseRetryDelay(msg);
          console.warn(`[Gemini Stream] 429 - ${wait / 1000}초 대기 후 재시도`);
          onChunk(`\n\n⏳ API 한도 초과. ${Math.round(wait / 1000)}초 후 재시도합니다...\n\n`);
          await sleep(wait);
          continue;
        }
        throw error;
      }
    }
  }
  throw lastError ?? new Error("모든 API 엔드포인트 실패");
}
