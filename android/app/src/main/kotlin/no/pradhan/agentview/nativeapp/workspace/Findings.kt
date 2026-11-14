package no.pradhan.agentview.nativeapp.workspace

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import no.pradhan.agentview.nativeapp.net.protocolJson

// What /code-review reported for a PR number or the working tree ("local") of one repo (shared/protocol.ts ReviewFindings).
@Serializable data class Finding(val file: String = "", val line: Int = 0, val summary: String = "", val failure: String? = null, val category: String? = null, val verdict: String? = null)
@Serializable data class ReviewFindings(val repo: String = "", val target: String = "", val at: Long = 0, val findings: List<Finding> = emptyList())

// Web ops/Findings.tsx prompts.
const val REVIEW_LOCAL = "/code-review"
const val DRAFT_PROMPT = "Propose a commit subject for the staged changes in this repo. Read them with `git diff --cached`. Reply with one imperative subject line under 50 characters, no trailing period, no body and nothing else."

fun reviewPrPrompt(number: Int) = "/code-review $number"

fun parseFindings(body: String): ReviewFindings? = if (body.isBlank() || body.trim() == "null") null else protocolJson.decodeFromString(ReviewFindings.serializer(), body)

fun findingKey(f: Finding) = "${f.file}:${f.line}:${f.summary.take(60)}"

fun findingFixPrompt(f: Finding) = "Fix this review finding in ${f.file}:${f.line}: ${f.summary}" + (f.failure?.let { " ($it)" } ?: "")

fun dismissBody(target: String, f: Finding) = buildJsonObject { put("target", target); put("key", findingKey(f)) }.toString()
