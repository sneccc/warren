/**
 * Owner questions in a PR comment.
 *
 * An agent cannot post a PR comment: the PR does not exist until reap opens
 * it, and the sandbox holds no forge credential. The agent instead writes a
 * "Questions for the owner" block in its commit message body. Warren puts
 * that body in the PR description ("Agent notes"). After the PR opens, reap
 * lifts the block out of the description and posts it as a PR comment, so the
 * owner can answer in the PR thread.
 */

import type { Forge, PullRequestRef, RepoRef } from "../../forge/contract.ts";

const HEADING = /^(?:#{1,6}\s*)?questions for the owner\s*:?\s*$/i;
const STOP = /^(?:#{1,6}\s|co-authored-by:)/i;

/**
 * Pull the "Questions for the owner" block out of a PR body. The block starts
 * at a line that reads `Questions for the owner:` (a markdown heading marker
 * is optional) and ends at the next heading, a `Co-Authored-By:` trailer, or
 * the end of the text. Returns null when there is no block or it is empty.
 */
export function extractOwnerQuestions(body: string): string | null {
	const lines = body.replace(/\r\n/g, "\n").split("\n");
	const start = lines.findIndex((line) => HEADING.test(line.trim()));
	if (start < 0) return null;
	const block: string[] = [];
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (STOP.test(line.trim())) break;
		block.push(line);
	}
	const text = block.join("\n").trim();
	return text === "" ? null : text;
}

/** The comment text Warren posts for one run. */
export function formatOwnerQuestionsComment(runId: string, questions: string): string {
	return `**Questions from the agent** (Warren run \`${runId}\`)\n\n${questions}\n\nAnswer in a reply on this PR.`;
}

export interface PostOwnerQuestionsInput {
	readonly runId: string;
	readonly forge: Forge;
	readonly repoRef: RepoRef;
	readonly prRef: PullRequestRef;
	readonly prBody: string;
	readonly fail: (step: "pr_open", err: unknown) => Promise<void>;
}

/**
 * Best-effort: post the questions block as a PR comment. Returns true when a
 * comment was posted. A forge without `commentOnPullRequest`, a body without
 * a block, or a forge error all return false and never throw.
 */
export async function postOwnerQuestions(input: PostOwnerQuestionsInput): Promise<boolean> {
	const comment = input.forge.commentOnPullRequest;
	if (comment === undefined) return false;
	const questions = extractOwnerQuestions(input.prBody);
	if (questions === null) return false;
	try {
		const result = await comment.call(
			input.forge,
			input.repoRef,
			input.prRef,
			formatOwnerQuestionsComment(input.runId, questions),
		);
		if (!result.ok) {
			await input.fail("pr_open", new Error(`owner questions comment: ${result.error.detail}`));
			return false;
		}
		return true;
	} catch (err) {
		await input.fail("pr_open", err);
		return false;
	}
}
