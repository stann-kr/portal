import { eq, getTableColumns, sql } from "drizzle-orm";
import { createDb, type DrizzleDb } from "@/db/client";
import { profiles } from "@/db/schema";
import type { UserRole } from "@/types/user";

export type ActiveProfile = {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
};

export type ActiveLoginProfile = ActiveProfile & {
  passwordHash: string | null;
};

type ProfileRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ProfileRecord {
  return typeof value === "object" && value !== null;
}

/**
 * DB profile row를 애플리케이션의 active account 계약으로 좁힌다.
 *
 * 현재 계정 폐기는 profile hard-delete로 표현한다. 이후 status 컬럼이 도입되면
 * password hash만 제외한 동적 column projection이 새 필드를 함께 반환하며,
 * ACTIVE 이외 값은 이 경계에서 fail-closed 된다.
 */
export function parseActiveProfile(row: unknown): ActiveProfile | null {
  if (!isRecord(row)) return null;

  const id = row.id;
  const email = row.email;
  const displayName = row.displayName;
  const role = row.role;
  const accountStatus = row.accountStatus ?? row.account_status;

  if (
    typeof id !== "string" ||
    id.length === 0 ||
    typeof email !== "string" ||
    email.length === 0 ||
    (displayName !== null && typeof displayName !== "string") ||
    (role !== "admin" && role !== "student")
  ) {
    return null;
  }

  if (accountStatus !== undefined && accountStatus !== "ACTIVE") {
    return null;
  }

  return { id, email, displayName, role };
}

export function parseActiveLoginProfile(
  row: unknown,
): ActiveLoginProfile | null {
  const profile = parseActiveProfile(row);
  if (!profile || !isRecord(row)) return null;
  const passwordHash = row.passwordHash;
  if (passwordHash !== null && typeof passwordHash !== "string") return null;
  return { ...profile, passwordHash };
}

const { passwordHash: sensitivePasswordHashColumn, ...activeProfileColumns } =
  getTableColumns(profiles);
void sensitivePasswordHashColumn;

export async function findActiveProfileById(
  profileId: string,
  db: DrizzleDb = createDb(),
): Promise<ActiveProfile | null> {
  if (!profileId) return null;
  const [row] = await db
    .select(activeProfileColumns)
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1);
  return parseActiveProfile(row);
}

export async function findActiveProfileByEmail(
  email: string,
  db: DrizzleDb = createDb(),
): Promise<ActiveLoginProfile | null> {
  const normalized = email.trim();
  if (!normalized) return null;
  const [row] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.email, normalized))
    .limit(1);
  if (row) return parseActiveLoginProfile(row);

  // 대소문자만 다르게 입력한 경우는 그런 계정이 정확히 하나일 때만 같은 계정으로 본다.
  const caseInsensitiveRows = await db
    .select()
    .from(profiles)
    .where(sql`lower(${profiles.email}) = ${normalized.toLowerCase()}`)
    .limit(2);
  return caseInsensitiveRows.length === 1
    ? parseActiveLoginProfile(caseInsensitiveRows[0])
    : null;
}
