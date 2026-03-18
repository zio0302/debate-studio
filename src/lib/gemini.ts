/**
 * Gemini REST API 직접 호출 유틸리티
 * ─────────────────────────────────────────────────────────────
 * 핵심 전략: 여러 모델/엔드포인트 조합을 순서대로 실제 호출 테스트해
 * 성공하는 첫 번째 조합을 캐시하고 사용합니다.
 *
 * - gemini-2.0-flash 계열은 신규 API 키에서 ListModels엔 나오지만
 *   실제 generateContent 호출 시 404 → 명시적으로 제외
 * - systemInstruction 필드 미사용 (호환성 이슈로 인라인 삽입으로 대체)
 * ─────────────────────────────────────────────────────────────
 */

export interface GeminiResponse {
  content: string;
  tokenUsageInput: number;
  tokenUsageOutput: number;
}

// ─── 시도할 모델/엔드포인트 조합 (우선순위 순) ──────────────────
// gemini-2.0-flash 계열은 신규 키에서 generateContent 호출 시 막히므로 제외

interface Candidate { model: string; apiVersion: string; }

const CANDIDATES: Candidate[] = [
  { model: "gemini-1.5-flash",          apiVersion: "v1"     },
  { model: "gemini-1.5-flash-latest",   apiVersion: "v1"     },
  { model: "gemini-1.5-flash-002",      apiVersion: "v1"     },
  { model: "gemini-1.5-flash-001",      apiVersion: "v1"     },
  { model: "gemini-1.5-pro",            apiVersion: "v1"     },
  { model: "gemini-1.5-pro-latest",     apiVersion: "v1"     },
  { model: "gemini-1.5-flash",          apiVersion: "v1beta" },
  { model: "gemini-1.5-pro",            apiVersion: "v1beta" },
  { model: "gemini-1.0-pro",            apiVersion: "v1beta" },
  { model: "gemini-pro",                apiVersion: "v1beta" },
];

const BASE = "https://generativelanguage.googleapis.com";

// ─── 동작 모델 캐시 ───────────────────────────────────────────

let _cachedCandidate: Candidate | null = null;
let _cachedKey: string | null          = null;

/**
 * 실제 generateContent 호출로 동작하는 모델을 탐지합니다.
 * 한 번 성공하면 API 키가 같을 때 캐시를 재사용합니다.
 */
async function findWorkingCandidate(key: string): Promise<Candidate> {
  if (_cachedKey === key && _cachedCandidate) return _cachedCandidate;

  // 최소 페이로드로 각 조합 테스트
  const testBody = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: "test" }] }],
    generationConfig: { maxOutputTokens: 1 },
  });

  for (const candidate of CANDIDATES) {
    const url = `${BASE}/${candidate.apiVersion}/models/${candidate.model}:generateContent?key=${key}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: testBody,
      });
      // 200 또는 400(파라미터 오류지만 모델은 존재) → 사용 가능
      if (res.ok || res.status === 400) {
        console.log(`[Gemini] 사용 가능한 모델 발견: ${candidate.model} (${candidate.apiVersion})`);
        _cachedKey       = key;
        _cachedCandidate = candidate;
        return candidate;
      }
      // 404 → 다음 조합 시도
    } catch {
      // 네트워크 오류 → 다음 조합 시도
    }
  }
  throw new Error("사용 가능한 Gemini 모델을 찾지 못했습니다. API 키를 확인해주세요.");
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

/** 시스템 프롬프트를 user message에 인라인 삽입 */
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
  _modelName?: string
): Promise<GeminiResponse> {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini API 키가 설정되지 않았습니다.");

  const { model, apiVersion } = await findWorkingCandidate(key);
  const url  = `${BASE}/${apiVersion}/models/${model}:generateContent?key=${key}`;
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
  _modelName?: string
): Promise<GeminiResponse> {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini API 키가 설정되지 않았습니다.");

  const { model, apiVersion } = await findWorkingCandidate(key);
  const url  = `${BASE}/${apiVersion}/models/${model}:streamGenerateContent?alt=sse&key=${key}`;
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
        console.warn(`[Gemini Stream] 429 - ${wait / 1000}초 대기`);
        onChunk(`\n\n⏳ API 한도 초과. ${Math.round(wait / 1000)}초 후 재시도합니다...\n\n`);
        await sleep(wait);
        continue;
      }
      throw error;
    }
  }

  throw new Error("최대 재시도 횟수 초과");
}
