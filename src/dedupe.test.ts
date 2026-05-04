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

function msg(parts: unknown[]) {
	return {
		info: { id: crypto.randomUUID() },
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

	test("logs statistics from the plugin hook", async () => {
		const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
		const hooks = await SkillDeduperPlugin({} as never);
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

		expect(info.mock.calls.join("\n")).toContain("skill-deduper");
		expect(info.mock.calls.join("\n")).toContain("brainstorming");
		expect(info.mock.calls.join("\n")).toContain("savedChars");
		info.mockRestore();
	});
});
