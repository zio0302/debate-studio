/**
 * Gemini REST API 직접 호출 유틸리티
 * ─────────────────────────────────────────────────────────────
 * 핵심 전략: 모델명/API 버전을 하드코딩하지 않고,
 * ListModels API로 실제 사용 가능한 모델을 먼저 탐지 후 사용합니다.
 *
 * 탐지 순서 (우선순위):
 *   1. v1 엔드포인트 → gemini-2.0-flash, 1.5-flash, 1.5-pro 순
 *   2. v1beta 엔드포인트 → 동일 순서
 * ─────────────────────────────────────────────────────────────
 */

export interface GeminiResponse {
  content: string;
  tokenUsageInput: number;
  tokenUsageOutput: number;
}

// ─── 모델 탐지 캐시 (API 키가 같으면 재탐지 생략) ─────────────

interface ModelConfig { model: string; baseUrl: string; }
let _cachedConfig: ModelConfig | null = null;
let _cachedKey: string | null = null;

/** 선호 모델 목록 (성능 좋은 것부터 순서대로) */
const PREFERRED_MODELS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
  "gemini-1.5-pro",
  "gemini-1.0-pro",
  "gemini-pro",
];

/**
 * API 키로 ListModels를 호출해 사용 가능한 모델 중 최적의 것을 선택합니다.
 * 결과는 API 키가 동일하면 캐시를 재사용합니다.
 */
async function detectModelConfig(key: string): Promise<ModelConfig> {
  // 캐시 히트
  if (_cachedKey === key && _cachedConfig) return _cachedConfig;

  const versions = ["v1", "v1beta"];

  for (const version of versions) {
    try {
      const baseUrl = `https://generativelanguage.googleapis.com/${version}`;
      const res = await fetch(`${baseUrl}/models?key=${key}`);
      if (!res.ok) continue;

      const json = await res.json();
      // API가 반환하는 모델명 형식: "models/gemini-1.5-flash"
      const available: string[] = (json.models ?? []).map(
        (m: { name: string }) => m.name.replace("models/", "")
      );

      // 선호 순서대로 사용 가능한 첫 모델 선택
      for (const model of PREFERRED_MODELS) {
        if (available.includes(model)) {
          const config: ModelConfig = { model, baseUrl };
          _cachedKey    = key;
          _cachedConfig = config;
          console.log(`[Gemini] 탐지된 모델: ${model} (${version})`);
          return config;
        }
      }
    } catch {
      // 네트워크 오류 → 다음 버전 시도
    }
  }

  // ListModels 실패 시 폴백: 가장 일반적인 조합 직접 사용
  console.warn("[Gemini] ListModels 실패 → 폴백 모델 사용");
  return { model: "gemini-1.5-flash", baseUrl: "https://generativelanguage.googleapis.com/v1" };
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

/** 시스템 프롬프트를 user message에 인라인 삽입 (systemInstruction 필드 대체) */
function buildBody(systemPrompt: string, userMessage: string) {
  return {
    contents: [
      {
        role: "user",
        parts: [{ text: `[시스템 지시사항]\n${systemPrompt}\n\n[사용자 메시지]\n${userMessage}` }],
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

// ─── callGemini (완성 응답) ────────────────────────────────────

export async function callGemini(
  systemPrompt: string,
  userMessage: string,
  apiKey?: string,
  _modelName?: string  // 무시: 자동 탐지로 결정
): Promise<GeminiResponse> {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini API 키가 설정되지 않았습니다.");

  const { model, baseUrl } = await detectModelConfig(key);
  const url  = `${baseUrl}/models/${model}:generateContent?key=${key}`;
  const body = JSON.stringify(buildBody(systemPrompt, userMessage));

  async function attempt(): Promise<GeminiResponse> {
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

export async function callGeminiStream(
  systemPrompt: string,
  userMessage: string,
  apiKey: string | undefined,
  onChunk: (text: string) => void,
  _modelName?: string  // 무시: 자동 탐지로 결정
): Promise<GeminiResponse> {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini API 키가 설정되지 않았습니다.");

  const { model, baseUrl } = await detectModelConfig(key);
  const url  = `${baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${key}`;
  const body = JSON.stringify(buildBody(systemPrompt, userMessage));

  const MAX_RETRIES = 2;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`[${res.status}] ${errText}`);
      }

      const reader  = res.body!.getReader();
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

    } catch (error) {
      if (isRateLimit(error) && attempt < MAX_RETRIES) {
        const wait = parseRetryDelay(error instanceof Error ? error.message : "");
        console.warn(`[Gemini Stream] 429 - ${wait / 1000}초 대기 후 재시도`);
        onChunk(`\n\n⏳ API 한도 초과. ${Math.round(wait / 1000)}초 후 재시도합니다...\n\n`);
        await sleep(wait);
        continue;
      }
      throw error;
    }
  }

  throw new Error("최대 재시도 횟수 초과");
}
