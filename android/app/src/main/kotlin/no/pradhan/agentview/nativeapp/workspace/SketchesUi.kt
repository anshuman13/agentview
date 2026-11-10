package no.pradhan.agentview.nativeapp.workspace

import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.serialization.builtins.ListSerializer
import no.pradhan.agentview.nativeapp.app.DeepLink
import no.pradhan.agentview.nativeapp.net.Hub
import no.pradhan.agentview.nativeapp.net.READ_ONLY_SENT
import no.pradhan.agentview.nativeapp.net.enc
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.net.read
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Group
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.ListRow
import no.pradhan.agentview.nativeapp.ui.Loading
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Tokens

private const val FOLD = 5

private fun parseSketches(body: String): List<SketchFile> = protocolJson.decodeFromString(ListSerializer(SketchFile.serializer()), body)

// Sketches (web/src/workspace/Sketches.tsx): the mockups the agent wrote with /sketch, and a frame that shows one.
@Composable
fun SketchesScreen(hub: Hub, onBack: () -> Unit) {
    val chat = hub.store.state.collectAsState().value.shownId
    val (load, reload) = rememberLoad(chat) { parseSketches(hub.read("/api/sketches")) }
    var open by rememberSaveable(chat) { mutableStateOf<String?>(null) }
    var want by remember { mutableStateOf<String?>(null) }
    val slug by hub.sketchSlug.collectAsState()
    LaunchedEffect(slug) { slug?.let { want = it; hub.sketchSlug.value = null } }
    val sketches = load.data
    LaunchedEffect(want, load.busy) {
        val w = want ?: return@LaunchedEffect
        if (!load.busy) { open = w.takeIf { sketchOpenable(it, sketches.orEmpty().map { s -> s.name }) }; want = null }
    }
    val file = sketches?.firstOrNull { it.name == open }
    if (file != null) { SketchView(hub, file, onBack = { open = null }); return }
    var all by rememberSaveable(chat) { mutableStateOf(false) }
    val now = System.currentTimeMillis()
    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, "Sketches", onBack) { IconBtn("refresh", "Refresh", reload) }
        PageBody {
            when {
                sketches == null && load.error.isNotEmpty() -> EmptyState("Could not load sketches", load.error, icon = "paintcan")
                sketches == null -> Loading("Loading sketches")
                sketches.isEmpty() -> EmptyState("No sketches yet", "Mockups the agent writes with /sketch show here", icon = "paintcan", action = { Button("New sketch", { newSketch(hub) }, size = ButtonSize.Sm) })
                else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    SectionHeader("Sketches", sketches.size.toString())
                    Group {
                        sketches.take(if (all) sketches.size else FOLD).forEachIndexed { i, s ->
                            if (i > 0) Hairline()
                            ListRow(sketchTitle(s.name), agoShort(s.mtime.toLong(), now, " ago"), onClick = { open = s.name })
                        }
                    }
                    if (!all && sketches.size > FOLD) Button("Show all ${sketches.size}", { all = true }, Modifier.padding(horizontal = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                    Spacer(Modifier.padding(bottom = Tokens.sp16))
                }
            }
        }
    }
}

private fun newSketch(hub: Hub) {
    if (hub.readOnly) { hub.notice.value = READ_ONLY_SENT; return }
    hub.setDraft(hub.pageChat, "/sketch ")
    hub.link.value = DeepLink(chat = hub.pageChat)
}

@Composable
private fun SketchView(hub: Hub, file: SketchFile, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    val st by hub.store.state.collectAsState()
    val cwd = st.session?.cwd?.ifEmpty { null } ?: st.live.firstOrNull { it.id == st.shownId }?.cwd.orEmpty()
    val clip = LocalClipboardManager.current
    val (load) = rememberLoad(file.path, hub.pageChat) { parseFile(hub.read("/api/file?path=${enc(file.path)}")) }
    var desktop by rememberSaveable { mutableStateOf(false) }
    var dark by rememberSaveable { mutableStateOf<Boolean?>(null) }
    val dark0 = when (hub.theme.collectAsState().value) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
    val isDark = dark ?: dark0
    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, sketchTitle(file.name), onBack) {
            MoreButton { close -> MenuItem("Copy path", "copy", { close(); clip.setText(AnnotatedString("$cwd/${file.path}")) }) }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp3), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
            Chip("Phone", { desktop = false }, on = !desktop)
            Chip("Desktop", { desktop = true }, on = desktop)
            Spacer(Modifier.weight(1f))
            Chip("Light", { dark = false }, on = !isDark)
            Chip("Dark", { dark = true }, on = isDark)
        }
        val f = load.data
        Box(Modifier.fillMaxSize()) {
            when {
                f == null && load.error.isEmpty() -> Loading("Loading sketch")
                f == null || f.binary || f.error != null -> SketchProblem("It may have moved. Go back to the list")
                f.content.length > MAX_SKETCH -> SketchProblem("Too large to show")
                else -> SketchFrame(sketchPage(f.content, if (isDark) "dark" else "light", desktop), desktop)
            }
        }
    }
}

@Composable
private fun SketchProblem(hint: String) = EmptyState("Could not load the sketch", hint, icon = "paintcan")

private fun WebSettings.asSketch() = object : SketchSettings {
    override var javaScript by this@asSketch::javaScriptEnabled
    override var blockNetwork by this@asSketch::blockNetworkLoads
    override var fileAccess by this@asSketch::allowFileAccess
    override var contentAccess by this@asSketch::allowContentAccess
}

// No scripts, no network, no files and no link taps: the sketch is a picture of its own page.
@Composable
private fun SketchFrame(page: String, desktop: Boolean) {
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            WebView(ctx).apply {
                lockSketch(settings.asSketch())
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
                }
            }
        },
        update = { web ->
            val key = "$desktop\n$page"
            if (web.tag != key) {
                web.tag = key
                web.settings.useWideViewPort = desktop
                web.settings.loadWithOverviewMode = desktop
                web.loadDataWithBaseURL(null, page, "text/html", "utf-8", null)
            }
        },
        onRelease = { it.destroy() },
    )
}
