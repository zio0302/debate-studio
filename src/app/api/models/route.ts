// /api/models - 이 API 키로 사용 가능한 Gemini 모델 목록을 반환
import { NextResponse } from "next/server";

const BASE = "https://generativelanguage.googleapis.com";
const BLOCKED = ["gemini-2.0-flash", "gemini-2.0-flash-lite"]; // 신규 키에서 막힌 모델

export async function POST(req: Request) {
  try {
    const { apiKey } = await req.json();
    if (!apiKey) {
      return NextResponse.json({ success: false, error: "API 키가 없습니다." }, { status: 400 });
    }

    // v1beta → v1 순으로 모델 목록 조회
    for (const version of ["v1beta", "v1"]) {
      const res = await fetch(`${BASE}/${version}/models?key=${apiKey}`);
      if (!res.ok) continue;

      const json = await res.json();

      // generateContent 지원 모델만 + 신규키 차단 모델 제외
      const models: { id: string; displayName: string; version: string }[] = (json.models ?? [])
        .filter((m: { supportedGenerationMethods?: string[]; name: string }) =>
          m.supportedGenerationMethods?.includes("generateContent") &&
          !BLOCKED.includes(m.name.replace("models/", ""))
        )
        .map((m: { name: string; displayName?: string }) => ({
          id: m.name.replace("models/", ""),
          displayName: m.displayName ?? m.name.replace("models/", ""),
          version,
        }));

      if (models.length > 0) {
        return NextResponse.json({ success: true, models, apiVersion: version });
      }
    }

    return NextResponse.json({ success: false, error: "사용 가능한 모델이 없습니다." }, { status: 404 });

  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
