import { describe, expect, it } from "bun:test";
import type { Forge } from "../../forge/contract.ts";
import {
	extractOwnerQuestions,
	formatOwnerQuestionsComment,
	postOwnerQuestions,
} from "./owner-questions.ts";

describe("extractOwnerQuestions", () => {
	it("returns the block after a plain heading line", () => {
		const body =
			"Did the work.\n\nQuestions for the owner:\n1. Name?\n2. Port?\n\nCo-Authored-By: X";
		expect(extractOwnerQuestions(body)).toBe("1. Name?\n2. Port?");
	});

	it("accepts a markdown heading and stops at the next heading", () => {
		const body = "## Questions for the owner\n- A?\n- B?\n\n## Run\nstuff";
		expect(extractOwnerQuestions(body)).toBe("- A?\n- B?");
	});

	it("is case-insensitive and handles CRLF", () => {
		expect(extractOwnerQuestions("questions FOR the owner:\r\n1. A?\r\n")).toBe("1. A?");
	});

	it("returns null when there is no block or it is empty", () => {
		expect(extractOwnerQuestions("No questions here.")).toBeNull();
		expect(extractOwnerQuestions("Questions for the owner:\n\nCo-Authored-By: X")).toBeNull();
	});
});

describe("postOwnerQuestions", () => {
	const repoRef = {} as never;
	const prRef = {} as never;

	it("posts the formatted comment", async () => {
		const calls: string[] = [];
		const forge = {
			commentOnPullRequest: async (_r: unknown, _p: unknown, body: string) => {
				calls.push(body);
				return { ok: true as const, value: undefined };
			},
		} as unknown as Forge;
		const posted = await postOwnerQuestions({
			runId: "run_1",
			forge,
			repoRef,
			prRef,
			prBody: "Questions for the owner:\n1. A?",
			fail: async () => {},
		});
		expect(posted).toBe(true);
		expect(calls).toEqual([formatOwnerQuestionsComment("run_1", "1. A?")]);
	});

	it("does nothing without the forge method or without a block", async () => {
		const noop = async () => {};
		const bare = {} as unknown as Forge;
		expect(
			await postOwnerQuestions({
				runId: "r",
				forge: bare,
				repoRef,
				prRef,
				prBody: "Questions for the owner:\n1. A?",
				fail: noop,
			}),
		).toBe(false);
		const withMethod = {
			commentOnPullRequest: async () => ({ ok: true as const, value: undefined }),
		} as unknown as Forge;
		expect(
			await postOwnerQuestions({
				runId: "r",
				forge: withMethod,
				repoRef,
				prRef,
				prBody: "nothing",
				fail: noop,
			}),
		).toBe(false);
	});

	it("reports a forge error through fail and returns false", async () => {
		const failed: unknown[] = [];
		const forge = {
			commentOnPullRequest: async () => ({
				ok: false as const,
				error: { kind: "network", detail: "boom" },
			}),
		} as unknown as Forge;
		const posted = await postOwnerQuestions({
			runId: "r",
			forge,
			repoRef,
			prRef,
			prBody: "Questions for the owner:\n1. A?",
			fail: async (_step, err) => {
				failed.push(err);
			},
		});
		expect(posted).toBe(false);
		expect(failed).toHaveLength(1);
	});
});
