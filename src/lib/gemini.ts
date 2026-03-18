/**
 * Gemini REST API 직접 호출 유틸리티
 * ─────────────────────────────────────────────────────────────
 * 모델/버전 조합을 순서대로 시도해 첫 번째 동작하는 것을 캐시합니다.
 * 실패 시 실제 Google 에러 메시지를 그대로 사용자에게 전달합니다.
 * ─────────────────────────────────────────────────────────────
 */

export interface GeminiResponse {
  content: string;
  tokenUsageInput: number;
  tokenUsageOutput: number;
}

const BASE = "https://generativelanguage.googleapis.com";

interface Candidate { model: string; apiVersion: string; }

/**
 * 신규 계정 우선 순위 (Google의 신규 키 정책 반영):
 * - gemini-2.5-pro 계열: 신규 키에서 권장
 * - gemini-2.0-flash-exp: 실험적이지만 신규 키 허용
 * - gemini-1.5-flash 계열: v1 엔드포인트
 * - gemini-1.0-pro / gemini-pro: 가장 구형, 폴백
 */
const CANDIDATES: Candidate[] = [
  { model: "gemini-2.5-pro-exp-03-25",          apiVersion: "v1beta" },
  { model: "gemini-2.5-pro-preview-03-25",       apiVersion: "v1beta" },
  { model: "gemini-2.0-flash-exp",               apiVersion: "v1beta" },
  { model: "gemini-2.0-flash-thinking-exp-01-21",apiVersion: "v1beta" },
  { model: "gemini-1.5-flash",                   apiVersion: "v1"     },
  { model: "gemini-1.5-flash-latest",            apiVersion: "v1"     },
  { model: "gemini-1.5-flash-002",               apiVersion: "v1"     },
  { model: "gemini-1.5-flash-001",               apiVersion: "v1"     },
  { model: "gemini-1.5-pro",                     apiVersion: "v1"     },
  { model: "gemini-1.5-pro-latest",              apiVersion: "v1"     },
  { model: "gemini-1.5-flash",                   apiVersion: "v1beta" },
  { model: "gemini-1.5-pro",                     apiVersion: "v1beta" },
  { model: "gemini-1.0-pro",                     apiVersion: "v1beta" },
  { model: "gemini-pro",                         apiVersion: "v1beta" },
];

// ─── 캐시 ─────────────────────────────────────────────────────
let _cachedCandidate: Candidate | null = null;
let _cachedKey: string | null = null;

/**
 * GET /models/{model} 로 모델 존재 여부를 확인합니다.
 * POST generateContent 보다 훨씬 가볍고 안정적입니다.
 */
async function findWorkingCandidate(key: string): Promise<Candidate> {
  if (_cachedKey === key && _cachedCandidate) return _cachedCandidate;

  const errors: string[] = [];

  for (const candidate of CANDIDATES) {
    const infoUrl = `${BASE}/${candidate.apiVersion}/models/${candidate.model}?key=${key}`;
    try {
      const res = await fetch(infoUrl);
      const body = await res.text();

      if (res.ok) {
        // 모델 정보 조회 성공 → 사용 가능
        console.log(`[Gemini] ✅ 사용 가능: ${candidate.model} (${candidate.apiVersion})`);
        _cachedKey = key;
        _cachedCandidate = candidate;
        return candidate;
      }

      // 404: 이 버전/키에서 모델 없음 → 다음 시도
      // 400/403/401: API 키 문제일 수 있음 → 기록만
      const preview = body.slice(0, 200);
      errors.push(`${candidate.model}(${candidate.apiVersion}): [${res.status}] ${preview}`);
      console.warn(`[Gemini] ❌ ${candidate.model}(${candidate.apiVersion}): ${res.status}`);

    } catch (e) {
      errors.push(`${candidate.model}(${candidate.apiVersion}): 네트워크 오류 - ${e}`);
    }
  }

  // 모든 후보 실패 → 첫 번째 실제 에러가 가장 유용한 정보
  const firstError = errors[0] ?? "알 수 없는 오류";
  throw new Error(
    `Gemini API 호출 실패. 실제 오류:\n${firstError}\n\n` +
    `API 키가 유효한지, AI Studio(aistudio.google.com)에서 발급한 키인지 확인해주세요.`
  );
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

// ─── callGemini ───────────────────────────────────────────────

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
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (!res.ok) { const t = await res.text(); throw new Error(`[${res.status}] ${t}`); }
    const json = await res.json();
    const content: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const usage = json.usageMetadata ?? {};
    return { content, tokenUsageInput: usage.promptTokenCount ?? 0, tokenUsageOutput: usage.candidatesTokenCount ?? 0 };
  }

  try {
    return await attempt();
  } catch (error) {
    if (isRateLimit(error)) {
      const wait = parseRetryDelay(error instanceof Error ? error.message : "");
      await sleep(wait);
      return await attempt();
    }
    throw error;
  }
}

// ─── callGeminiStream ─────────────────────────────────────────

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
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      if (!res.ok) { const t = await res.text(); throw new Error(`[${res.status}] ${t}`); }

      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullContent = "", inputTokens = 0, outputTokens = 0, buffer = "";

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
          } catch { /* 불완전 청크 무시 */ }
        }
      }
      return { content: fullContent, tokenUsageInput: inputTokens, tokenUsageOutput: outputTokens };

    } catch (error) {
      if (isRateLimit(error) && attempt < MAX_RETRIES) {
        const wait = parseRetryDelay(error instanceof Error ? error.message : "");
        onChunk(`\n\n⏳ API 한도 초과. ${Math.round(wait / 1000)}초 후 재시도합니다...\n\n`);
        await sleep(wait);
        continue;
      }
      throw error;
    }
  }
  throw new Error("최대 재시도 횟수 초과");
}
