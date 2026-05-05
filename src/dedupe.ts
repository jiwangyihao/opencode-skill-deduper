import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

type MutablePart = Record<string, unknown>

type MessageWithParts = {
  parts?: unknown[]
}

type MessagesTransformOutput = {
  messages?: MessageWithParts[]
}

type TextAccessor = {
  part: MutablePart
  field: "text" | "content" | "output" | "state.output"
  text: string
  set: (value: string) => void
}

type SkillOccurrence = {
  key: string
  name: string
  accessor: TextAccessor
  order: number
}

export type SkillElideStat = {
  name: string
  elided: number
  savedChars: number
}

export type SkillDedupeResult = {
  seen: number
  elided: number
  savedChars: number
  skills: SkillElideStat[]
}

export type SkillDedupeLogRecord = {
  service: "skill-deduper"
  level: "info"
  message: "elided duplicate skill content"
  extra: {
    elided: number
    savedChars: number
    skills: SkillElideStat[]
  }
}

export type SkillDedupeRecorder = (
  record: SkillDedupeLogRecord,
) => void | Promise<void>

const MIN_ELIDE_CHARS = 1024

function getDedupeLogDir(): string {
  const configured = process.env.SKILL_DEDUPER_LOG_DIR?.trim()
  if (configured) return configured

  const configHome = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config")
  return join(configHome, "opencode", "logs", "skill-deduper")
}

function formatDedupeLogRecord(record: SkillDedupeLogRecord): string {
  const timestamp = new Date().toISOString()
  return `${timestamp} ${record.level.toUpperCase().padEnd(5)} skill-deduper: ${record.message} | ${JSON.stringify(record.extra)}\n`
}

function getNestedRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null
  return value as Record<string, unknown>
}

function getTextAccessors(part: MutablePart): TextAccessor[] {
  const accessors: TextAccessor[] = []

  if (typeof part.text === "string") {
    accessors.push({
      part,
      field: "text",
      text: part.text,
      set: (value) => {
        part.text = value
      },
    })
  }

  if (typeof part.content === "string") {
    accessors.push({
      part,
      field: "content",
      text: part.content,
      set: (value) => {
        part.content = value
      },
    })
  }

  if (typeof part.output === "string") {
    accessors.push({
      part,
      field: "output",
      text: part.output,
      set: (value) => {
        part.output = value
      },
    })
  }

  const state = getNestedRecord(part.state)
  if (state && typeof state.output === "string") {
    accessors.push({
      part,
      field: "state.output",
      text: state.output,
      set: (value) => {
        state.output = value
      },
    })
  }

  return accessors
}

function extractSkillNameFromPart(part: MutablePart): string | null {
  const state = getNestedRecord(part.state)
  const input = getNestedRecord(state?.input)
  const name = input?.name
  return typeof name === "string" && name.trim() ? name.trim() : null
}

function extractSkillNameFromText(text: string): string | null {
  const trimmed = text.trimStart()
  const skillContentMatch = trimmed.match(
    /^<skill_content\s+name=["']([^"']+)["']/i,
  )
  if (skillContentMatch?.[1]?.trim()) return skillContentMatch[1].trim()

  const omoHeadingMatch = trimmed.match(/^## Skill:\s*([^\r\n]+)/)
  if (omoHeadingMatch?.[1]?.trim()) return omoHeadingMatch[1].trim()

  const nativeHeadingMatch = trimmed.match(/^# Skill:\s*([^\r\n]+)/)
  if (nativeHeadingMatch?.[1]?.trim()) return nativeHeadingMatch[1].trim()

  const baseDirectoryMatch = trimmed.match(
    /Base directory for this skill:\s*[^\r\n]*[\\/]skills[\\/]([^\\/\r\n]+)[\\/]?/i,
  )
  if (baseDirectoryMatch?.[1]?.trim()) return baseDirectoryMatch[1].trim()

  return null
}

function looksLikeFullSkillText(text: string): boolean {
  const trimmed = text.trimStart()
  return (
    trimmed.startsWith("## Skill:") ||
    trimmed.startsWith("# Skill:") ||
    /^<skill_content\b/i.test(trimmed) ||
    /^<skill-instruction>/i.test(trimmed) ||
    /^Base directory for this skill:/i.test(trimmed)
  )
}

function normalizeSkillKey(name: string): string {
  return name.trim().toLowerCase()
}

function makeElidedSkillText(skillName: string, originalChars: number): string {
  return `[skill-deduper] Skill ${skillName} was reloaded later; older copy elided (${originalChars} chars).`
}

export function dedupeSkillMessages(output: MessagesTransformOutput): SkillDedupeResult {
  const occurrences: SkillOccurrence[] = []
  const latestOrderBySkill = new Map<string, number>()
  let order = 0

  for (const message of output.messages ?? []) {
    for (const candidatePart of message.parts ?? []) {
      const part = getNestedRecord(candidatePart)
      if (!part) continue

      const partSkillName = extractSkillNameFromPart(part)

      for (const accessor of getTextAccessors(part)) {
        if (!looksLikeFullSkillText(accessor.text)) continue

        const skillName = extractSkillNameFromText(accessor.text) ?? partSkillName
        if (!skillName) continue

        const occurrence: SkillOccurrence = {
          key: normalizeSkillKey(skillName),
          name: skillName,
          accessor,
          order,
        }

        occurrences.push(occurrence)
        latestOrderBySkill.set(occurrence.key, occurrence.order)
        order += 1
      }
    }
  }

  let elided = 0
  let savedChars = 0
  const statsBySkill = new Map<string, SkillElideStat>()

  for (const occurrence of occurrences) {
    if (latestOrderBySkill.get(occurrence.key) === occurrence.order) continue
    if (occurrence.accessor.text.length < MIN_ELIDE_CHARS) continue

    const elidedText = makeElidedSkillText(
      occurrence.name,
      occurrence.accessor.text.length,
    )
    const savedForOccurrence = Math.max(
      0,
      occurrence.accessor.text.length - elidedText.length,
    )

    occurrence.accessor.set(elidedText)
    elided += 1
    savedChars += savedForOccurrence

    const stat = statsBySkill.get(occurrence.key) ?? {
      name: occurrence.name,
      elided: 0,
      savedChars: 0,
    }
    stat.elided += 1
    stat.savedChars += savedForOccurrence
    statsBySkill.set(occurrence.key, stat)
  }

  return {
    seen: occurrences.length,
    elided,
    savedChars,
    skills: [...statsBySkill.values()],
  }
}

export function createDedupeLogRecord(
  result: SkillDedupeResult,
): SkillDedupeLogRecord | null {
  if (result.elided === 0) return null

  return {
    service: "skill-deduper",
    level: "info",
    message: "elided duplicate skill content",
    extra: {
      elided: result.elided,
      savedChars: result.savedChars,
      skills: result.skills,
    },
  }
}

export function createDedupeNotificationMessage(
  result: SkillDedupeResult,
): string | null {
  if (result.elided === 0) return null

  const skillLines = result.skills.map(
    (skill) =>
      `- ${skill.name}: ${skill.elided} elided, ${skill.savedChars} chars saved`,
  )

  return [
    "[skill-deduper] Elided duplicate skill content before this request.",
    "",
    `Elided blocks: ${result.elided}`,
    `Saved characters: ${result.savedChars}`,
    "Skills:",
    ...skillLines,
  ].join("\n")
}

export async function recordDedupeStats(
  result: SkillDedupeResult,
  recorder: SkillDedupeRecorder,
): Promise<void> {
  const record = createDedupeLogRecord(result)
  if (!record) return

  await recorder(record)
}

export async function writeDedupeLogRecord(
  record: SkillDedupeLogRecord,
  logDir = getDedupeLogDir(),
): Promise<void> {
  const dailyLogDir = join(logDir, "daily")
  await mkdir(dailyLogDir, { recursive: true })
  const logFile = join(dailyLogDir, `${new Date().toISOString().split("T")[0]}.log`)
  await writeFile(logFile, formatDedupeLogRecord(record), { flag: "a" })
}

export async function logDedupeStatsToFile(
  result: SkillDedupeResult,
): Promise<void> {
  await recordDedupeStats(result, writeDedupeLogRecord)
}

export function logDedupeStats(
  result: SkillDedupeResult,
  recorder?: SkillDedupeRecorder,
): void | Promise<void> {
  if (!recorder) return

  return recordDedupeStats(result, recorder)
}
