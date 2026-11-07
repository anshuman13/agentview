package no.pradhan.agentview.nativeapp

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue

// Findings (web/src/ops/Findings.tsx): what /code-review reported, most severe first; a row opens the file.
@Composable
fun Findings(hub: Hub, target: String, onOpen: ((Finding) -> Unit)? = null) {
    val st by hub.store.state.collectAsState()
    val cwd = st.session?.cwd
    val all by hub.findings.collectAsState()
    LaunchedEffect(target, cwd) { runCatching { parseFindings(hub.read("/api/findings?target=${enc(target)}")) }.onSuccess { hub.setFindings(target, it) } }
    val review = all[target] ?: return
    SectionHeader("Findings", review.findings.size.toString())
    Group {
        if (review.findings.isEmpty()) EmptyState("No findings")
        review.findings.forEachIndexed { i, f ->
            if (i > 0) Hairline(lead = true)
            ListRow(
                f.summary, "${f.file}:${f.line}", lines = 3,
                leading = { StatusDot(if (f.verdict == "CONFIRMED") DotState.Bad else DotState.Warn) },
                trailing = {
                    Button("Fix", { hub.askClaude(findingFixPrompt(f)) }, size = ButtonSize.Sm)
                    MoreButton { close ->
                        MenuItem("Dismiss", { close(); hub.write("/api/findings/dismiss", dismissBody(target, f), "Could not dismiss the finding", ::parseFindings) { r -> if (r != null) hub.setFindings(target, r) } })
                    }
                },
                onClick = onOpen?.let { { it(f) } },
            )
        }
    }
}
