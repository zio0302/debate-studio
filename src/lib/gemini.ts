/**
 * Gemini REST API 직접 호출 유틸리티
 * ─────────────────────────────────────────────────────────────
 * 핵심 전략:
 * 1. ListModels API로 이 API 키에서 실제 사용 가능한 모델 목록을 조회
 * 2. 선호 모델 순서대로 매칭되는 첫 번째 모델 선택 (신규키 제한 모델 제외)
 * 3. 선택된 모델로 generateContent 호출
 * ─────────────────────────────────────────────────────────────
 */

export interface GeminiResponse {
  content: string;
  tokenUsageInput: number;
  tokenUsageOutput: number;
}

const BASE = "https://generativelanguage.googleapis.com";
const API_VERSIONS = ["v1beta", "v1"];

// 신규 키에서 generateContent가 막힌 모델들 (ListModels엔 나오나 실제 호출 불가)
const BLOCKED_FOR_NEW_USERS = ["gemini-2.0-flash", "gemini-2.0-flash-lite"];

// 선호 모델 키워드 (이 순서대로 ListModels 결과에서 매칭)
const PREFERRED_KEYWORDS = [
  "gemini-2.5-pro",
  "gemini-2.0-flash-exp",
  "gemini-2.0-flash-thinking",
  "gemini-1.5-flash-8b",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-1.0-pro",
  "gemini-pro",
];

// ─── 캐시 ─────────────────────────────────────────────────────
interface ModelConfig { model: string; apiVersion: string; }
let _cached: ModelConfig | null = null;
let _cachedKey: string | null = null;

/**
 * ListModels API로 실제 사용 가능한 모델을 조회해 최적 모델을 선택합니다.
 * 결과는 API 키가 동일하면 캐시를 재사용합니다.
 */
async function detectModel(key: string): Promise<ModelConfig> {
  if (_cachedKey === key && _cached) return _cached;

  for (const apiVersion of API_VERSIONS) {
    try {
      const res = await fetch(`${BASE}/${apiVersion}/models?key=${key}`);
      if (!res.ok) {
        const errBody = await res.text();
        console.warn(`[Gemini] ListModels ${apiVersion} 실패 [${res.status}]: ${errBody.slice(0, 200)}`);
        continue;
      }

      const json = await res.json();
      // 응답 형식: { models: [{ name: "models/gemini-1.5-flash", supportedGenerationMethods: [...] }] }
      const allModels: string[] = (json.models ?? [])
        .filter((m: { supportedGenerationMethods?: string[] }) =>
          m.supportedGenerationMethods?.includes("generateContent")
        )
        .map((m: { name: string }) => m.name.replace("models/", ""));

      // 신규키 차단 모델 제외
      const candidates = allModels.filter(
        (m) => !BLOCKED_FOR_NEW_USERS.some((blocked) => m === blocked)
      );

      console.log(`[Gemini] ${apiVersion} 사용 가능 모델 목록:`, candidates);

      // 선호 순서대로 매칭
      for (const keyword of PREFERRED_KEYWORDS) {
        const found = candidates.find((m) => m.startsWith(keyword));
        if (found) {
          const config: ModelConfig = { model: found, apiVersion };
          _cached = config;
          _cachedKey = key;
          console.log(`[Gemini] ✅ 선택된 모델: ${found} (${apiVersion})`);
          return config;
        }
      }

      // 선호 모델 매칭 실패 시 첫 번째 모델 사용
      if (candidates.length > 0) {
        const config: ModelConfig = { model: candidates[0], apiVersion };
        _cached = config;
        _cachedKey = key;
        console.log(`[Gemini] ✅ 폴백 모델: ${candidates[0]} (${apiVersion})`);
        return config;
      }

    } catch (e) {
      console.warn(`[Gemini] ListModels ${apiVersion} 네트워크 오류:`, e);
    }
  }

  throw new Error(
    `이 API 키로 사용 가능한 Gemini 모델을 찾지 못했습니다.\n` +
    `AI Studio(aistudio.google.com)에서 발급한 키를 사용해주세요.\n` +
    `설정 페이지에서 API 키를 확인해주세요.`
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
    generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
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

  const { model, apiVersion } = await detectModel(key);
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
  onChunk: (text: string) => Promise<void> | void,
  _modelName?: string
): Promise<GeminiResponse> {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini API 키가 설정되지 않았습니다.");

  const { model, apiVersion } = await detectModel(key);
  const url  = `${BASE}/${apiVersion}/models/${model}:streamGenerateContent?alt=sse&key=${key}`;
  const body = JSON.stringify(buildBody(systemPrompt, userMessage));

  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      if (!res.ok) { const t = await res.text(); throw new Error(`[${res.status}] ${t}`); }

      const reader = res.body!.getReader(), decoder = new TextDecoder();
      let fullContent = "", inputTokens = 0, outputTokens = 0, buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const s = line.slice(6).trim();
          if (!s || s === "[DONE]") continue;
          try {
            const chunk = JSON.parse(s);
            const text: string = chunk.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
            if (text) { fullContent += text; await onChunk(text); }
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
