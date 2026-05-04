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

const MIN_ELIDE_CHARS = 1024

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

export function logDedupeStats(result: SkillDedupeResult): void {
  if (result.elided === 0) return

  console.info(
    "[skill-deduper] elided duplicate skill content",
    JSON.stringify({
      elided: result.elided,
      savedChars: result.savedChars,
      skills: result.skills,
    }),
  )
}
