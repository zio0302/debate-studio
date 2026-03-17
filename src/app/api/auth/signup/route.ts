// 회원가입 API - PostgreSQL 버전 (UUID 자동생성)
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";

const signupSchema = z.object({
  email: z.string().email("올바른 이메일 형식이 아닙니다."),
  password: z.string().min(6, "비밀번호는 최소 6자 이상이어야 합니다."),
  name: z.string().min(1).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = signupSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, data: null, error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { email, password, name } = parsed.data;

    // 중복 이메일 확인
    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) {
      return NextResponse.json(
        { success: false, data: null, error: "이미 사용 중인 이메일입니다." },
        { status: 409 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    // PostgreSQL: UUID는 DB가 defaultRandom()으로 자동 생성
    const [newUser] = await db.insert(users).values({
      email,
      password: hashedPassword,
      name: name ?? null,
    }).returning();

    return NextResponse.json(
      { success: true, data: { id: newUser.id, email: newUser.email, name: newUser.name }, error: null },
      { status: 201 }
    );
  } catch (err) {
    console.error("[API] 회원가입 오류:", err);
    return NextResponse.json(
      { success: false, data: null, error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
