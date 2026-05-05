import { createHash } from "node:crypto"
import { mkdir, open, readdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

type MutablePart = Record<string, unknown>

type MessageWithParts = {
	info?: Record<string, unknown>
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
	id: string
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

export type SkillElideEvent = {
	id: string
	name: string
	savedChars: number
}

export type SkillDedupeResult = {
	seen: number
	elided: number
	savedChars: number
	skills: SkillElideStat[]
	elisions: SkillElideEvent[]
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
const NOTIFIED_ELISIONS_DIR = "notified-elisions"

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

function getNotifiedElisionsDir(logDir = getDedupeLogDir()): string {
	return join(logDir, NOTIFIED_ELISIONS_DIR)
}

function getNotifiedElisionFile(id: string, logDir = getDedupeLogDir()): string {
	const filename = createHash("sha256").update(id).digest("hex")
	return join(getNotifiedElisionsDir(logDir), `${filename}.json`)
}

function getStableId(value: Record<string, unknown> | null): string | null {
	if (!value) return null

	for (const key of ["id", "messageID", "callID", "sessionID"]) {
		const candidate = value[key]
		if (typeof candidate === "string" && candidate.trim()) return candidate.trim()
	}

	return null
}

function hashText(text: string): string {
	let hash = 2166136261
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index)
		hash = Math.imul(hash, 16777619)
	}
	return (hash >>> 0).toString(36)
}

function makeElisionId(
	message: MessageWithParts,
	part: MutablePart,
	skillKey: string,
	field: TextAccessor["field"],
	text: string,
	order: number,
): string {
	const state = getNestedRecord(part.state)
	const stableId =
		getStableId(part) ??
		getStableId(state) ??
		getStableId(getNestedRecord(message.info))

	if (stableId) return `${skillKey}:${field}:${stableId}`
	return `${skillKey}:${field}:text-${hashText(text)}:${order}`
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
				id: makeElisionId(
					message,
					part,
					normalizeSkillKey(skillName),
					accessor.field,
					accessor.text,
					order,
				),
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
	const elisions: SkillElideEvent[] = []

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
	elisions.push({
		id: occurrence.id,
		name: occurrence.name,
		savedChars: savedForOccurrence,
	})

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
		elisions,
	}
}

export function filterDedupeResultElisions(
	result: SkillDedupeResult,
	includeElision: (elision: SkillElideEvent) => boolean,
): SkillDedupeResult {
	if (result.elided === 0) return result

	const elisions = result.elisions.filter(includeElision)
	if (elisions.length === result.elisions.length) return result

	const statsBySkill = new Map<string, SkillElideStat>()
	let savedChars = 0

	for (const elision of elisions) {
		savedChars += elision.savedChars
		const key = normalizeSkillKey(elision.name)
		const stat = statsBySkill.get(key) ?? {
			name: elision.name,
			elided: 0,
			savedChars: 0,
		}
		stat.elided += 1
		stat.savedChars += elision.savedChars
		statsBySkill.set(key, stat)
	}

	return {
		seen: result.seen,
		elided: elisions.length,
		savedChars,
		skills: [...statsBySkill.values()],
		elisions,
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

export async function loadNotifiedElisionIds(
	logDir = getDedupeLogDir(),
): Promise<Set<string>> {
	try {
		const markerDir = getNotifiedElisionsDir(logDir)
		const files = await readdir(markerDir)
		const ids = await Promise.all(
			files
				.filter((file) => file.endsWith(".json"))
				.map(async (file) => {
					try {
						const text = await readFile(join(markerDir, file), "utf8")
						const value: unknown = JSON.parse(text)
						const id = getNestedRecord(value)?.id
						return typeof id === "string" && id.trim() ? id.trim() : null
					} catch {
						return null
					}
				}),
		)
		return new Set(ids.filter((id): id is string => id !== null))
	} catch {
		return new Set()
	}
}

export async function saveNotifiedElisionIds(
	ids: Set<string>,
	logDir = getDedupeLogDir(),
): Promise<void> {
	await mkdir(getNotifiedElisionsDir(logDir), { recursive: true })
	await Promise.all(
		[...ids].map(async (id) => {
			await writeFile(
				getNotifiedElisionFile(id, logDir),
				JSON.stringify({ id }),
				{ flag: "w" },
			)
		}),
	)
}

export async function claimNewElisionIds(
	elisions: SkillElideEvent[],
	logDir = getDedupeLogDir(),
): Promise<Set<string>> {
	const claimed = new Set<string>()
	if (elisions.length === 0) return claimed

	await mkdir(getNotifiedElisionsDir(logDir), { recursive: true })
	await Promise.all(
		elisions.map(async (elision) => {
			try {
				const marker = await open(getNotifiedElisionFile(elision.id, logDir), "wx")
				try {
					await marker.writeFile(JSON.stringify({ id: elision.id }), "utf8")
					claimed.add(elision.id)
				} finally {
					await marker.close()
				}
			} catch {
				// An existing marker or an inability to claim means no repeat side effect.
			}
		}),
	)

	return claimed
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
