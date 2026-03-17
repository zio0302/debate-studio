// 세션 생성/목록 API - PostgreSQL 버전
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/prisma";
import { projects, sessions } from "@/lib/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const createSessionSchema = z.object({
  title: z.string().min(1).max(200),
  rawInput: z.string().min(10).max(10000),
  additionalConstraints: z.string().max(2000).optional(),
  rounds: z.number().int().min(1).max(4).default(2),
  outputTone: z.enum(["concise", "standard", "detailed"]).default("standard"),
});

export async function GET(_req: NextRequest, { params }: Params) {
  const authSession = await auth();
  if (!authSession?.user?.id) {
    return NextResponse.json({ success: false, data: null, error: "로그인이 필요합니다." }, { status: 401 });
  }
  const { id: projectId } = await params;
  const [project] = await db.select().from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, authSession.user.id), isNull(projects.deletedAt)))
    .limit(1);
  if (!project) return NextResponse.json({ success: false, data: null, error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });

  const sessionList = await db.select().from(sessions)
    .where(eq(sessions.projectId, projectId))
    .orderBy(desc(sessions.createdAt));

  return NextResponse.json({ success: true, data: sessionList, error: null });
}

export async function POST(req: NextRequest, { params }: Params) {
  const authSession = await auth();
  if (!authSession?.user?.id) {
    return NextResponse.json({ success: false, data: null, error: "로그인이 필요합니다." }, { status: 401 });
  }
  const { id: projectId } = await params;
  const [project] = await db.select().from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, authSession.user.id), isNull(projects.deletedAt)))
    .limit(1);
  if (!project) return NextResponse.json({ success: false, data: null, error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });

  try {
    const body = await req.json();
    const parsed = createSessionSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ success: false, data: null, error: parsed.error.errors[0].message }, { status: 400 });

    // PostgreSQL: UUID 자동생성, .returning()으로 값 반환
    const [newSession] = await db.insert(sessions).values({
      projectId,
      userId: authSession.user.id,
      title: parsed.data.title,
      rawInput: parsed.data.rawInput,
      additionalConstraints: parsed.data.additionalConstraints ?? null,
      rounds: parsed.data.rounds,
      outputTone: parsed.data.outputTone,
      status: "pending",
    }).returning();

    return NextResponse.json({ success: true, data: newSession, error: null }, { status: 201 });
  } catch (err) {
    console.error("[API] 세션 생성 오류:", err);
    return NextResponse.json({ success: false, data: null, error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
