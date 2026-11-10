package no.pradhan.agentview.nativeapp.workspace

import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import no.pradhan.agentview.nativeapp.chat.s
import no.pradhan.agentview.nativeapp.net.AgentUsage
import no.pradhan.agentview.nativeapp.net.ChatEvent
import no.pradhan.agentview.nativeapp.net.READ_ONLY_SENT
import no.pradhan.agentview.nativeapp.net.ServerMessage
import no.pradhan.agentview.nativeapp.net.Writes
import no.pradhan.agentview.nativeapp.net.parseMessage
import no.pradhan.agentview.nativeapp.ops.DeployJob
import no.pradhan.agentview.nativeapp.ops.Findings
import no.pradhan.agentview.nativeapp.ops.McpRow
import no.pradhan.agentview.nativeapp.ops.McpServer
import no.pradhan.agentview.nativeapp.ops.agentGroups
import no.pradhan.agentview.nativeapp.ops.agentMeta
import no.pradhan.agentview.nativeapp.ops.agentRowMeta
import no.pradhan.agentview.nativeapp.ops.agentTrailing
import no.pradhan.agentview.nativeapp.ops.buildAgents
import no.pradhan.agentview.nativeapp.ops.deployBody
import no.pradhan.agentview.nativeapp.ops.deployWarning
import no.pradhan.agentview.nativeapp.ops.dismissBody
import no.pradhan.agentview.nativeapp.ops.elapsed
import no.pradhan.agentview.nativeapp.ops.envBadge
import no.pradhan.agentview.nativeapp.ops.envMeta
import no.pradhan.agentview.nativeapp.ops.findingFixPrompt
import no.pradhan.agentview.nativeapp.ops.findingKey
import no.pradhan.agentview.nativeapp.ops.mcpCalls
import no.pradhan.agentview.nativeapp.ops.mcpGroupBody
import no.pradhan.agentview.nativeapp.ops.mcpKey
import no.pradhan.agentview.nativeapp.ops.mcpLoggedInSince
import no.pradhan.agentview.nativeapp.ops.mcpMeta
import no.pradhan.agentview.nativeapp.ops.mcpSections
import no.pradhan.agentview.nativeapp.ops.mcpShortName
import no.pradhan.agentview.nativeapp.ops.mcpState
import no.pradhan.agentview.nativeapp.ops.mcpWithAccounts
import no.pradhan.agentview.nativeapp.ops.mergeMcp
import no.pradhan.agentview.nativeapp.ops.observeConfigBody
import no.pradhan.agentview.nativeapp.ops.observeDraft
import no.pradhan.agentview.nativeapp.ops.observeRepos
import no.pradhan.agentview.nativeapp.ops.panelNum
import no.pradhan.agentview.nativeapp.ops.parseConnectors
import no.pradhan.agentview.nativeapp.ops.parseDeploy
import no.pradhan.agentview.nativeapp.ops.parseDeployJob
import no.pradhan.agentview.nativeapp.ops.parseFindings
import no.pradhan.agentview.nativeapp.ops.parseMcp
import no.pradhan.agentview.nativeapp.ops.parseObserve
import no.pradhan.agentview.nativeapp.ops.reportText
import no.pradhan.agentview.nativeapp.ops.reviewPrPrompt
import no.pradhan.agentview.nativeapp.ops.sparkline
import no.pradhan.agentview.nativeapp.ops.tokensText
import no.pradhan.agentview.nativeapp.ui.BadgeTone
import no.pradhan.agentview.nativeapp.ui.DotState
import no.pradhan.agentview.nativeapp.ui.Status
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PagesLogicTest {
    @Test fun treeWalksExpandedFoldersAndHidesIgnored() {
        val dirs = mapOf(
            "" to parseDir("""[{"name":"src","dir":true},{"name":".git","dir":true,"hidden":true},{"name":"README.md"}]"""),
            "src" to listOf(DirEntry("main.kt")),
        )
        val (rows, missing) = treeRows(dirs, setOf("src", "docs"), showHidden = false)
        assertEquals(listOf("src", "src/main.kt", "README.md"), rows.map { it.path })
        assertEquals(listOf(0, 1, 0), rows.map { it.depth })
        assertTrue(missing.isEmpty())
        assertEquals(listOf("src", ".git", "README.md"), treeRows(dirs, emptySet(), true).first.map { it.path })
        assertEquals(listOf(".git"), treeRows(dirs, setOf(".git"), true).second)
    }

    @Test fun fileIconsFollowNameThenExtension() {
        assertEquals(FileHue.Green, fileHue("web/package.json"))
        assertEquals(FileHue.Purple, fileHue("Hub.kt"))
        assertEquals(FileHue.Gray, fileHue("notes"))
        assertEquals(FileHue.Blue, fileHue("README.md"))
        assertEquals("readme", fileTag("README.md"))
        assertEquals("log", fileTag("CHANGELOG"))
        assertEquals(FileHue.Blue, fileHue("CHANGELOG.md"))
        assertEquals("kt", fileTag("app/Hub.kt"))
        assertEquals("git", fileTag(".gitignore"))
        assertEquals("make", fileTag("Makefile"))
        assertEquals("json", fileTag("package.json"))
        val tags = mapOf("a.swift" to "swift", "a.svelte" to "svelte", "a.astro" to "astro", "a.proto" to "proto", "a.graphql" to "graphql", "a.plist" to "plist",
            ".env.local" to "env", "README" to "readme", "README.md" to "readme", "CHANGELOG" to "log", "Procfile" to "proc", "LICENSE" to "lic", "Dockerfile" to "docker",
            "a.tsx" to "tsx", "notes" to "file", "a.verylongext" to "file")
        tags.forEach { (n, t) -> assertEquals(n, t, fileTag(n)) }
        assertEquals(FileHue.Gray, fileHue(".env.local"))
        assertEquals(FileHue.Yellow, fileHue("LICENSE"))
        assertEquals("This file is outside the project folder", fileError("path outside project"))
        assertEquals(FileData("a", "b"), parseFile("""{"content":"a","original":"b"}"""))
    }

    @Test fun highlightsKeywordsStringsCommentsAndKeys() {
        val (spans, open) = highlightLine("val x = \"hi\" // done", Lang.CLike)
        assertEquals(listOf(Syn.Keyword, Syn.Str, Syn.Comment), spans.map { it.syn })
        assertFalse(open)
        val block = highlight("a /* one\ntwo */ fun", Lang.CLike)
        assertEquals(Syn.Comment, block[1][0].syn)
        assertEquals(Syn.Keyword, block[1][1].syn)
        assertEquals(listOf(Syn.Property, Syn.Num), highlightLine("""  "port": 80,""", Lang.Json).first.map { it.syn })
        assertEquals(listOf(Syn.Property, Syn.Str), highlightLine("name: 'x'", Lang.Yaml).first.map { it.syn })
        assertEquals(listOf(Syn.Keyword, Syn.Keyword), highlightLine("SELECT 1 x FROM t", Lang.Sql).first.filter { it.syn == Syn.Keyword }.map { it.syn })
        assertEquals(Lang.CLike, langOf("a/b.tsx"))
        assertEquals(Lang.Plain, langOf("notes.txt"))
    }

    @Test fun fileDiffKeepsHeadAndTailAndFoldsUnchangedRuns() {
        val a = (1..20).joinToString("\n") { "l$it" }
        val b = a.replace("l10", "ten")
        val d = fileDiff(a, b)
        assertEquals(21, d.size)
        assertEquals(listOf(DiffLine('-', "l10"), DiffLine('+', "ten")), d.filter { it.mark != ' ' })
        val folded = changesOnly(d)
        assertEquals(DiffLine('@', "6 unchanged lines"), folded.first())
        assertEquals(DiffLine('@', "7 unchanged lines"), folded.last())
        assertEquals(10, folded.size)
        assertTrue(fileDiff("same", "same").all { it.mark == ' ' })
    }

    @Test fun gitStatusAndBodies() {
        val s = parseGitStatus("""{"branch":"main","ahead":1,"behind":0,"files":[{"path":"a/b.kt","status":"M","staged":true},{"path":"new.txt","status":"?","staged":false}]}""")
        assertEquals("U", letterOf(s.files[1]))
        assertEquals("""{"paths":["a/b.kt","new.txt"]}""", pathsBody(s.files))
        assertEquals("""{"message":"Fix it"}""", commitBody("Fix it"))
        assertEquals("Discard changes in 2 files?", discardTitle(s.files))
        assertTrue(discardDetail(s.files).startsWith("Untracked files are deleted"))
    }

    @Test fun pullRequestsGroupAndSplitTheirDiff() {
        val prs = parsePulls("""[{"number":1,"title":"A","mine":true,"review":"APPROVED","checks":"success","updatedAt":"2026-11-07T10:00:00Z"},{"number":2,"title":"B","reviewRequested":true}]""")
        assertEquals(listOf(1, 1, 2), prGroups(prs).map { it.prs.size })
        assertEquals("Approved" to Status.Ok, reviewLabel("APPROVED"))
        val armed = parsePulls("""[{"number":3,"autoMerge":{"note":"Waiting for checks"}},{"number":4,"autoMerge":{"note":"x","error":"boom"}},{"number":5}]""")
        assertEquals(listOf(true, false, false), armed.map { it.autoMergeOn })
        assertEquals(listOf("Waiting for checks", "Merge failed · boom"), armed.take(2).map { it.autoMerge!!.line() })
        assertEquals("""{"on":true,"method":"squash"}""", autoMergeBody(true, "squash"))
        assertNull(reviewLabel("WHATEVER"))
        assertEquals(DotState.Ok, checkDot(prs[0].checks))
        val diff = "diff --git a/x.kt b/x.kt\nindex 1..2\n--- a/x.kt\n+++ b/x.kt\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/y.md b/y.md\n@@ -0,0 +1 @@\n+hi\n"
        val files = splitDiff(diff)
        assertEquals(listOf("x.kt", "y.md"), files.keys.toList())
        assertEquals("@@ -1 +1 @@\n-a\n+b\n", files["x.kt"])
        assertEquals(listOf('@', '-', '+', ' '), listOf("@@ x", "-a", "+b", " c").map { diffMark(it) })
        assertEquals(listOf(DiffLine('@', "@@ -1 +1 @@"), DiffLine('-', "a"), DiffLine('+', "b"), DiffLine(' ', ""), DiffLine(' ', "c")), patchLines("@@ -1 +1 @@\n-a\n+b\n\n c\n\n"))
        assertEquals("Not signed in to GitHub", ghProblem("gh: not logged in to any hosts")?.title)
        assertEquals("""{"event":"approve","body":"ok"}""", reviewBody("approve", "ok"))
        val t = isoMillis("2026-11-07T10:00:00Z")
        assertEquals("now", agoShort(t, t + 30_000))
        assertEquals("5m", agoShort(t, t + 5 * 60_000))
        assertEquals("3h ago", agoShort(t, t + 3 * 3_600_000, " ago"))
        assertEquals("2w", agoShort(t, t + 14 * 86_400_000L))
    }

    @Test fun observeSettingsAndPanels() {
        val info = parseObserve("""{"repo":"shop","config":null,"guess":{"grafana":{"lokiSelector":"{app=\"shop\"}"}},"repos":["x","example"],"file":"~/.agentview/observe.json","grafanaServer":true,"snowflake":{"account":"","user":"","hasSecret":false}}""")
        assertTrue(observeDraft(info).contains("\"lokiSelector\""))
        assertEquals("""{"repo":"shop","config":{"a":1}}""", observeConfigBody("shop", """{ "a": 1 }"""))
        assertEquals("""{"repo":"shop","config":null}""", observeConfigBody("shop", " "))
        assertTrue(runCatching { observeConfigBody("shop", "{bad") }.isFailure)
        assertEquals(listOf("a", "shop", "x"), observeRepos(listOf("shop", "a"), info))
        assertEquals("1,234", panelNum(1234.4))
        assertEquals("0.12", panelNum(0.1234))
        assertEquals("5", panelNum(5.0))
        assertEquals(listOf(0f, 1f, 0.5f), sparkline(listOf(listOf(0.0, 2.0), listOf(1.0, 4.0), listOf(2.0, 3.0))))
        assertEquals(listOf(0.5f), sparkline(listOf(listOf(0.0, 2.0))))
    }

    @Test fun deployRowsShowWhatRunsWhere() {
        val s = parseDeploy("""{"apps":["a"],"app":"a","repo":"o/r","serviceUrl":"v","head":{"sha":"abcdef123","branch":"main"},"envs":[
            {"name":"prod","label":"Production","deployed":{"id":1,"sha":"abcdef123","ref":"main","state":"success","at":"2026-11-07T10:00:00Z","by":"ann"},"latest":{"id":2,"state":"in_progress"}},
            {"name":"staging","label":"Staging","defaultBranchOnly":true}]}""")
        val now = isoMillis("2026-11-07T12:00:00Z")
        assertEquals("main · 2h ago by ann · HEAD", envMeta(s.envs[0], s, now))
        assertEquals("Nothing deployed", envMeta(s.envs[1], s, now))
        assertEquals("Deploying" to BadgeTone.Running, envBadge(s.envs[0]))
        assertNull(envBadge(s.envs[1]))
        assertEquals("This is a production environment.", deployWarning(s.envs[0]))
        assertEquals("Only the default branch deploys here.", deployWarning(s.envs[1]))
        assertEquals("""{"app":"a","env":"prod","ref":"main"}""", deployBody("a", "prod", "main"))
        assertEquals(DeployJob("j", listOf("x"), done = true, ok = true), parseDeployJob("""{"id":"j","lines":["x"],"done":true,"ok":true,"url":""}"""))
    }

    @Test fun mcpAddsOtherAccountsConnectors() {
        val accounts = parseConnectors("""{"main":[{"name":"claude.ai Slack","status":"connected"},{"name":"claude.ai Notion","status":"needs-auth"}],"work":[{"name":"claude.ai Linear","status":"connected"},{"name":"claude.ai Slack","status":"connected"}]}""")
        val rows = mergeMcp(emptyList(), listOf(McpServer("claude.ai Linear", "needs-auth", type = "claudeai"), McpServer("grafana", "connected")))
        val all = mcpWithAccounts(rows, "work", accounts)
        assertEquals(listOf("claude.ai Linear/work", "grafana/null", "claude.ai Slack/main", "claude.ai Notion/main"), all.map { "${it.name}/${it.account}" })
        assertFalse(all[2].live)
        assertEquals("needs-auth", all[3].status)
        val s = mcpSections(all, emptyMap())
        assertEquals(listOf("claude.ai Linear", "grafana"), s.work.map { it.name })
        assertEquals(listOf("claude.ai Notion", "claude.ai Slack"), s.personal.map { it.name })
        assertEquals(listOf("claude.ai Linear"), mcpLoggedInSince(listOf(McpServer("claude.ai Linear", "needs-auth", type = "claudeai")), "work", accounts))
        assertEquals(emptyList<String>(), mcpLoggedInSince(listOf(McpServer("claude.ai Linear", "needs-auth", type = "claudeai")), "main", accounts))
        assertTrue(mcpKey(all[0]) != mcpKey(McpRow(McpServer("claude.ai Linear"), account = "main")))
    }

    @Test fun findingsParseAndPrompt() {
        assertNull(parseFindings("null"))
        val r = parseFindings("""{"repo":"/r","target":"12","at":1,"findings":[{"file":"a.kt","line":4,"summary":"Off by one","failure":"x=0 crashes","verdict":"CONFIRMED"}]}""")!!
        val f = r.findings.single()
        assertEquals("a.kt:4:Off by one", findingKey(f))
        assertEquals("Fix this review finding in a.kt:4: Off by one (x=0 crashes)", findingFixPrompt(f))
        assertEquals("""{"target":"12","key":"a.kt:4:Off by one"}""", dismissBody("12", f))
        assertEquals("/code-review 12", reviewPrPrompt(12))
        val m = parseMessage("""{"type":"findings","review":{"repo":"/r","target":"local","at":2,"findings":[]}}""")
        assertEquals("local", (m as ServerMessage.Findings).review.target)
    }

    @Test fun mcpMergesLiveStateAndGroups() {
        val probed = parseMcp("""[{"name":"grafana_prod","status":"connected","scope":"user","ms":40,"tools":[{"name":"q","description":"query"}]},{"name":"slack","status":"needs-auth","scope":"user"}]""")
        val live = listOf(McpServer("grafana_prod", "failed", error = "boom"), McpServer("claude.ai Linear", "connected", type = "claudeai"))
        val rows = mergeMcp(probed, live)
        assertEquals(listOf("grafana_prod", "slack", "claude.ai Linear"), rows.map { it.name })
        assertEquals("user", rows[0].server.scope)
        assertEquals(1, rows[0].server.tools?.size)
        assertTrue(rows[0].live)
        assertEquals("OAuth via Claude" to BadgeTone.Quiet, mcpState(rows[1]))
        assertEquals("Failed" to BadgeTone.Failed, mcpState(rows[0]))
        val sections = mcpSections(rows.map { if (it.server.type == "claudeai") it.copy(account = "main") else it }, mapOf("slack" to "personal", "hide:grafana" to "hidden"))
        assertEquals(listOf<String>(), sections.work.map { it.name })
        assertEquals(listOf("claude.ai Linear", "slack"), sections.personal.map { it.name })
        assertEquals(listOf("grafana_prod"), sections.hidden.map { it.name })
        val events = listOf(
            ChatEvent("t1", "tool_use", name = "mcp__grafana_prod__q"), ChatEvent("r1", "tool_result", toolUseId = "t1", isError = true),
            ChatEvent("t2", "tool_use", name = "mcp__grafana_prod__q"), ChatEvent("t3", "tool_use", name = "Read"),
        )
        assertEquals(mapOf("grafana_prod" to (2 to 1)), mcpCalls(events))
        assertEquals("1 tool · 40 ms · 2 calls · 1 error", mcpMeta(McpRow(probed[0]), 2 to 1))
        assertEquals("Linear", mcpShortName("claude.ai Linear"))
        assertEquals("""{"service":"slack","group":"personal"}""", mcpGroupBody("slack", "personal"))
    }

    @Test fun agentsComeFromTheTranscriptWithTheirInfo() {
        val input = JsonObject(mapOf("description" to JsonPrimitive("Find bugs"), "prompt" to JsonPrimitive("look")))
        val events = listOf(
            ChatEvent("a1", "tool_use", name = "Agent", input = input, at = 1000),
            ChatEvent("s1", "tool_use", name = "Read", input = JsonObject(mapOf("file_path" to JsonPrimitive("x.kt"))), parent = "a1", at = 2000),
            ChatEvent("i1", "agent", toolUseId = "a1", status = "running", subagentType = "Explore", startedAt = 1000, progress = "Reading", usage = AgentUsage(12_345, 3)),
        )
        val a = buildAgents(events).single()
        assertEquals("Find bugs", a.description)
        assertEquals("Explore", a.type)
        assertEquals("running", a.status)
        assertEquals("Read x.kt", a.lastStep)
        assertEquals(2000, a.lastAt)
        assertEquals("running · 1 step · Reading", agentRowMeta(a))
        assertEquals("Explore · 4s · 12k tokens · 3 tool uses", agentMeta(a, 5000))
        val done = buildAgents(events + ChatEvent("r", "tool_result", toolUseId = "a1", text = "All good", at = 9000) + ChatEvent("i2", "agent", toolUseId = "a1", status = "done", endedAt = 9000)).single()
        assertEquals("done", done.status)
        assertEquals("All good", reportText(done))
        assertEquals("1m 5s", elapsed(65_000))
        assertEquals("1.5k tokens", tokensText(1500))
    }

    @Test fun workflowAgentsGroupAfterThePlainOnes() {
        fun use(id: String, at: Long) = ChatEvent(id, "tool_use", name = "Agent", input = JsonObject(mapOf("description" to JsonPrimitive(id))), at = at)
        val events = listOf(
            use("w1", 1000), ChatEvent("i1", "agent", toolUseId = "w1", status = "running", startedAt = 1000, group = "build", usage = AgentUsage(1500, 1)),
            use("p1", 2000),
        )
        val groups = agentGroups(buildAgents(events))
        assertEquals(listOf(null, "build"), groups.map { it.first })
        val w = groups[1].second.single()
        assertEquals("Running", agentRowMeta(w))
        assertEquals("4s · 1.5k tokens", agentTrailing(w, 5000))
    }

    @Test fun terminalScreenHandlesLineEditsAndColours() {
        val t = TermScreen()
        t.write("abc\r\nhello\rj")
        assertEquals(listOf("abc", "jello"), t.lines().map { it.text })
        t.write("\u001b[K\r\n\u001b[31mred\u001b[0m ok\u001b")
        t.write("[1mx\b\by")
        val lines = t.lines()
        assertEquals(listOf("abc", "j", "red oyx"), lines.map { it.text })
        assertEquals(listOf(TermRun(0, 3, 1)), lines[2].runs)
        t.write("\u001b]0;title\u0007\u001b[2J\u001b[Hnew")
        assertEquals("new", t.lines().last().text)
        t.write("\u001b[1;3Hx")
        assertEquals("nex", t.lines().last().text)
        t.reset()
        assertTrue(t.lines().isEmpty())
        assertEquals("""{"t":"i","d":"ls\r"}""", termInput("ls\r"))
        assertTrue(termGone(4404))
        assertEquals(10000L, termDelay(9))
        assertEquals("ws://localhost:7777", wsOrigin("http://localhost:7777"))
        assertEquals(listOf(TermTab("1", "zsh")), parseTerms("""[{"id":"1","name":"zsh"}]"""))
    }

    @Test fun chromeMessagesParse() {
        assertEquals(ChromeMsg.State("off", "nochrome", true), parseChrome("""{"t":"state","state":"off","reason":"nochrome","own":true}"""))
        assertEquals(ChromeMsg.Tabs(listOf(ChromeTab("1", "Home", "https://x")), "1"), parseChrome("""{"t":"tabs","tabs":[{"id":"1","title":"Home","url":"https://x"}],"current":"1","pinned":null}"""))
        assertEquals(ChromeMsg.Frame("AAA"), parseChrome("""{"t":"frame","data":"AAA","w":1,"h":1}"""))
        assertNull(parseChrome("""{"t":"editable","on":true}"""))
        assertNull(parseChrome("not json"))
    }

    @Test fun writesAreRefusedInAReadOnlyRun() = runTest {
        val notices = mutableListOf<String>()
        var readOnly = true
        val w = Writes(TestScope(testScheduler), { readOnly }, { notices += it })
        var ran = false
        var result: Boolean? = null
        w.run("x", { ran = true }) { result = it }
        assertFalse(ran)
        assertEquals(false, result)
        assertEquals(listOf(READ_ONLY_SENT), notices)
        readOnly = false
        w.run("Could not save", { error("") }) { result = it }
        advanceUntilIdle()
        assertEquals(false, result)
        assertEquals("Could not save", notices.last())
        w.run("x", { ran = true }) { result = it }
        advanceUntilIdle()
        assertTrue(ran)
        assertEquals(true, result)
    }
}

class ReviewDiffTest {
    @Test fun rowsNumberNewLinesAndRemovedLinesApart() {
        val rows = diffRows(fileDiff("a\nb\nc", "a\nB\nc\nd"), false)
        assertEquals(listOf(1, 2, 2, 3, 4), rows.map { it.no })
        assertEquals(listOf(' ', '-', '+', ' ', '+'), rows.map { it.line.mark })
    }

    @Test fun foldedRowsKeepTheirNumbers() {
        val a = (1..20).joinToString("\n") { "l$it" }
        val rows = diffRows(fileDiff(a, a.replace("l18", "x")), true)
        assertEquals('@', rows.first().line.mark)
        assertEquals(15, rows[1].no)
        assertEquals(listOf(1 to 1), listOf(diffCounts(rows.map { it.line })))
    }

    @Test fun aNewFileIsAllAdditions() {
        assertEquals(listOf('+', '+'), fileDiffLines("", "x\ny\n").map { it.mark })
        assertTrue(fileDiffLines("", "").isEmpty())
    }

    @Test fun commentQuotesTheLine() {
        assertEquals("a/b.kt:3\n> val x = 1\n\nwhy?", commentPrompt("a/b.kt", DiffRow(DiffLine('+', "val x = 1"), 3), " why? "))
        assertTrue(commentPrompt("f", DiffRow(DiffLine('-', "q"), 2), "c").startsWith("f:2 (removed line)"))
        assertEquals("one\n\ntwo", appendPrompt("one\n", "two"))
        assertEquals("two", appendPrompt(" ", "two"))
    }

    @Test fun revertBlockPutsBackOneChange() {
        val original = "a\nb\nc\nd\ne\n"
        val content = "a\nB\nc\nd\nE\n"
        val lines = fileDiff(original, content)
        val second = lines.first { it.mark == '+' && it.text == "E" }
        assertEquals(1, blockOf(lines, second))
        assertEquals(-1, blockOf(lines, lines.first { it.text == "c" }))
        assertEquals("a\nB\nc\nd\ne\n", revertBlock(lines, 1))
        assertEquals("a\nb\nc\nd\nE\n", revertBlock(lines, 0))
    }
}
