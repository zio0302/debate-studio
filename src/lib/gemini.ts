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

/**
 * Gemini API를 호출하여 응답을 받아옴
 * @param systemPrompt - 페르소나 정의 시스템 프롬프트
 * @param userMessage  - 실제 사용자/컨텍스트 메시지
 * @param apiKey       - 클라이언트에서 전달한 API 키 (없으면 env 변수 사용)
 * @param modelName    - 사용할 모델 (기본: gemini-2.0-flash)
 */
export async function callGemini(
  systemPrompt: string,
  userMessage: string,
  apiKey?: string,
  modelName: string = "gemini-2.5-flash"
): Promise<GeminiResponse> {
  // 클라이언트 제공 API 키 우선, 없으면 환경변수 사용
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini API 키가 설정되지 않았습니다. 설정 페이지에서 API 키를 입력해주세요.");

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
    safetySettings,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
    },
  });

  const result = await model.generateContent(userMessage);
  const response = result.response;
  const content = response.text();

  const usageMeta = response.usageMetadata;
  const tokenUsageInput = usageMeta?.promptTokenCount ?? 0;
  const tokenUsageOutput = usageMeta?.candidatesTokenCount ?? 0;

  return { content, tokenUsageInput, tokenUsageOutput };
}
