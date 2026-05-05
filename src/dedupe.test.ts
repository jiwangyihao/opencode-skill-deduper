import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test, vi } from "vitest";
import { dedupeSkillMessages } from "./dedupe";
import { SkillDeduperPlugin } from "./index";

function tool(name: string, output: string) {
	return {
		type: "tool",
		tool: "skill",
		state: {
			input: { name },
			output,
		},
	};
}

function msg(parts: unknown[], info: Record<string, unknown> = {}) {
	return {
		info: { id: crypto.randomUUID(), ...info },
		parts,
	};
}

describe("dedupeSkillMessages", () => {
	test("keeps the newest OmO skill output and elides older copies", () => {
		const output = {
			messages: [
				msg([
					tool(
						"brainstorming",
						"## Skill: brainstorming\n\nold body".repeat(100),
					),
				]),
				msg([
					tool(
						"brainstorming",
						"## Skill: brainstorming\n\nnew body".repeat(100),
					),
				]),
			],
		};

		const result = dedupeSkillMessages(output);

		const old = output.messages[0]?.parts[0] as ReturnType<typeof tool>;
		const latest = output.messages[1]?.parts[0] as ReturnType<typeof tool>;

		expect(result.elided).toBe(1);
		expect(old.state.output).toContain("older copy elided");
		expect(old.state.output).not.toContain("old body");
		expect(latest.state.output).toContain("new body");
	});

	test("keeps single skill appearances unchanged", () => {
		const body = "## Skill: using-superpowers\n\nonly body".repeat(100);
		const output = { messages: [msg([tool("using-superpowers", body)])] };

		const result = dedupeSkillMessages(output);

		const only = output.messages[0]?.parts[0] as ReturnType<typeof tool>;
		expect(result.elided).toBe(0);
		expect(only.state.output).toBe(body);
	});

	test("elides older OpenCode native skill_content output", () => {
		const old =
			'<skill_content name="using-superpowers">\n# Skill: using-superpowers\n\nBase directory for this skill: C:/Users/34404/.config/opencode/skills/using-superpowers/\nold body'.repeat(
				80,
			);
		const latest =
			'<skill_content name="using-superpowers">\n# Skill: using-superpowers\n\nBase directory for this skill: C:/Users/34404/.config/opencode/skills/using-superpowers/\nnew body'.repeat(
				80,
			);
		const output = {
			messages: [
				msg([tool("using-superpowers", old)]),
				msg([tool("using-superpowers", latest)]),
			],
		};

		const result = dedupeSkillMessages(output);

		const first = output.messages[0]?.parts[0] as ReturnType<typeof tool>;
		const second = output.messages[1]?.parts[0] as ReturnType<typeof tool>;
		expect(result.elided).toBe(1);
		expect(first.state.output).toContain("older copy elided");
		expect(second.state.output).toContain("new body");
	});

	test("elides older slash-injected skill text when a newer tool load exists", () => {
		const slash = [
			"<skill-instruction>",
			"Base directory for this skill: C:/Users/34404/.config/opencode/skills/brainstorming/",
			"old slash body".repeat(100),
			"</skill-instruction>",
		].join("\n");
		const output = {
			messages: [
				msg([{ type: "text", text: slash }]),
				msg([
					tool(
						"brainstorming",
						"## Skill: brainstorming\n\nnew body".repeat(100),
					),
				]),
			],
		};

		const result = dedupeSkillMessages(output);

		const first = output.messages[0]?.parts[0] as { text: string };
		expect(result.elided).toBe(1);
		expect(first.text).toContain("older copy elided");
		expect(first.text).not.toContain("old slash body");
	});

	test("keeps user-authored slash prompts with pasted skill transcripts unchanged", () => {
		const userPrompt = [
			"## User",
			"/brainstorming 【TASK5】",
			"Please read the research plan and complete this task.",
			"## Assistant",
			"Tool Call: skill using-superpowers",
			"## Skill: using-superpowers",
			"Base directory for this skill: C:/Users/34404/.config/opencode/skills/using-superpowers/",
			"This pasted transcript is ordinary user-provided data. ".repeat(80),
		].join("\n\n");
		const output = {
			messages: [
				msg([{ type: "text", text: userPrompt }], { role: "user" }),
				msg([
					tool(
						"using-superpowers",
						"## Skill: using-superpowers\n\nnew body".repeat(100),
					),
				]),
			],
		};

		const result = dedupeSkillMessages(output);

		const first = output.messages[0]?.parts[0] as { text: string };
		expect(result.seen).toBe(1);
		expect(result.elided).toBe(0);
		expect(first.text).toBe(userPrompt);
	});

	test("returns per-skill statistics", () => {
		const output = {
			messages: [
				msg([
					tool("git-master", "## Skill: git-master\n\nold body".repeat(100)),
				]),
				msg([
					tool("git-master", "## Skill: git-master\n\nnew body".repeat(100)),
				]),
			],
		};

		const result = dedupeSkillMessages(output);

		expect(result.elided).toBe(1);
		expect(result.savedChars).toBeGreaterThan(0);
		expect(result.skills).toEqual([
			{ name: "git-master", elided: 1, savedChars: result.savedChars },
		]);
	});

	test("records statistics to a file without app log or stdout", async () => {
		const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
		const appLog = vi.fn();
		const logDir = await mkdtemp(join(tmpdir(), "skill-deduper-test-"));
		const previousLogDir = process.env.SKILL_DEDUPER_LOG_DIR;
		process.env.SKILL_DEDUPER_LOG_DIR = logDir;

		const hooks = await SkillDeduperPlugin({
			client: { app: { log: appLog } },
		} as never);
		const output = {
			messages: [
				msg([
					tool("brainstorming", "## Skill: brainstorming\n\nold".repeat(100)),
				]),
				msg([
					tool("brainstorming", "## Skill: brainstorming\n\nnew".repeat(100)),
				]),
			],
		};

		await hooks["experimental.chat.messages.transform"]?.(
			{} as never,
			output as never,
		);

		try {
			expect(info).not.toHaveBeenCalled();
			expect(appLog).not.toHaveBeenCalled();

			const logText = await readFile(
				join(logDir, "daily", `${new Date().toISOString().split("T")[0]}.log`),
				"utf8",
			);
			expect(logText).toContain("skill-deduper: elided duplicate skill content");
			expect(logText).toContain("brainstorming");
		} finally {
			if (previousLogDir === undefined) {
				delete process.env.SKILL_DEDUPER_LOG_DIR;
			} else {
				process.env.SKILL_DEDUPER_LOG_DIR = previousLogDir;
			}
			await rm(logDir, { force: true, recursive: true });
			info.mockRestore();
		}
	});

	test("shows a TUI notification without writing a session message", async () => {
		const appLog = vi.fn();
		const showToast = vi.fn();
		const sessionPrompt = vi.fn();
		const hooks = await SkillDeduperPlugin({
			client: {
				app: { log: appLog },
				tui: { showToast },
				session: { prompt: sessionPrompt },
			},
		} as never);
		const output = {
			messages: [
				msg(
					[
						tool(
							"brainstorming",
							"## Skill: brainstorming\n\nold".repeat(100),
						),
					],
					{ sessionID: "ses_skill_deduper" },
				),
				msg(
					[
						tool(
							"brainstorming",
							"## Skill: brainstorming\n\nnew".repeat(100),
						),
					],
					{ sessionID: "ses_skill_deduper" },
				),
			],
		};

		await hooks["experimental.chat.messages.transform"]?.(
			{} as never,
			output as never,
		);

		expect(showToast).toHaveBeenCalledOnce();
		expect(showToast).toHaveBeenCalledWith({
			body: {
				title: "Skill Deduper",
				message: expect.stringContaining("brainstorming"),
				variant: "info",
				duration: 5000,
			},
		});
		expect(sessionPrompt).not.toHaveBeenCalled();
	});
});
