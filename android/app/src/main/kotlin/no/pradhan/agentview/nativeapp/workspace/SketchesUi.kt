package no.pradhan.agentview.nativeapp.workspace

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import no.pradhan.agentview.nativeapp.app.deleteSketch
import no.pradhan.agentview.nativeapp.app.renameSketch
import no.pradhan.agentview.nativeapp.ui.ConfirmDialog
import no.pradhan.agentview.nativeapp.ui.SearchField
import no.pradhan.agentview.nativeapp.ui.TextDialog
import android.view.MotionEvent
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.EnterExitState
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.ScrollState
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
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.viewinterop.AndroidView
import kotlin.math.abs
import kotlinx.serialization.builtins.ListSerializer
import no.pradhan.agentview.nativeapp.app.DeepLink
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.net.READ_ONLY_SENT
import no.pradhan.agentview.nativeapp.net.protocolJson
import no.pradhan.agentview.nativeapp.app.readFile
import no.pradhan.agentview.nativeapp.app.sketches
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.ButtonVariant
import no.pradhan.agentview.nativeapp.ui.Chip
import no.pradhan.agentview.nativeapp.ui.EmptyState
import no.pradhan.agentview.nativeapp.ui.Card
import no.pradhan.agentview.nativeapp.ui.CardGrid
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.Loading
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.MoreButton
import no.pradhan.agentview.nativeapp.ui.SectionHeader
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.select
import no.pradhan.agentview.nativeapp.ui.rememberLoad
import no.pradhan.agentview.nativeapp.ui.agoShort
import no.pradhan.agentview.nativeapp.ui.motionOff
import no.pradhan.agentview.nativeapp.ui.av

private const val FOLD = 5

internal fun parseSketches(body: String): List<SketchFile> = protocolJson.decodeFromString(ListSerializer(SketchFile.serializer()), body)

// Sketches (web/src/workspace/Sketches.tsx): the mockups the agent wrote with /sketch, and a frame that shows one.
@Composable
fun SketchesScreen(hub: Hub, onBack: () -> Unit) {
    val chat by hub.store.state.select { it.shownId }
    val (load, reload) = rememberLoad(chat) { hub.sketches() }
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
    var all by rememberSaveable(chat) { mutableStateOf(false) }
    var query by rememberSaveable(chat) { mutableStateOf("") }
    val still = motionOff()
    val scroll = rememberScrollState()
    // The list stays composed under the open sketch, so its thumbnail WebViews are not destroyed (which restarted the
    // renderer and left the sketch blank and headerless for a second). Zoom in on open and out on back (web: the sk-zoom
    // view transition), instant at animator scale 0.
    Box(Modifier.fillMaxSize()) {
        Box(if (file != null) Modifier.fillMaxSize().clearAndSetSemantics {} else Modifier.fillMaxSize()) {
            SketchList(hub, sketches, scroll, load.error, reload, all, { all = true }, query, { query = it }, onBack) { open = it }
        }
        AnimatedContent(file, Modifier.fillMaxSize(), transitionSpec = {
            if (still) EnterTransition.None togetherWith ExitTransition.None
            else if (targetState != null) {
                (scaleIn(tween(Tokens.motionDuration, easing = Tokens.motionEaseIn), 0.92f) + fadeIn(tween(Tokens.motionDuration, easing = Tokens.motionEaseIn))) togetherWith ExitTransition.None
            } else {
                EnterTransition.None togetherWith (scaleOut(tween(Tokens.motionDuration, easing = Tokens.motionEaseOut), 0.92f) + fadeOut(tween(Tokens.motionDuration, easing = Tokens.motionEaseOut)))
            }.apply { targetContentZIndex = if (targetState != null) 1f else -1f }
        }, label = "sketch") { shown ->
            if (shown != null) Box(Modifier.fillMaxSize().background(av.bg).clickable(indication = null, interactionSource = null) {}) {
                // A WebView ignores the Compose fade and scale, so the frame joins once the zoom has settled.
                SketchView(hub, shown, ready = transition.currentState == EnterExitState.Visible, onBack = { open = null })
            }
        }
    }
}

@Composable
private fun SketchList(hub: Hub, sketches: List<SketchFile>?, scroll: ScrollState, error: String, reload: () -> Unit, all: Boolean, showAll: () -> Unit, query: String, onQuery: (String) -> Unit, onBack: () -> Unit, onOpen: (String) -> Unit) {
    val now = System.currentTimeMillis()
    var renaming by remember { mutableStateOf<SketchFile?>(null) }
    var deleting by remember { mutableStateOf<SketchFile?>(null) }
    val download = rememberSketchDownload(hub)
    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, "Sketches", onBack) { IconBtn("refresh", "Refresh", reload) }
        PageBody {
            when {
                sketches == null && error.isNotEmpty() -> EmptyState("Could not load sketches", error, icon = "paintcan", action = { Button("Retry", reload, size = ButtonSize.Sm) })
                sketches == null -> Loading("Loading sketches…")
                sketches.isEmpty() -> EmptyState("No sketches yet. Ask for one with /\u2060sketch <what>", icon = "paintcan", action = { Button("New sketch", { newSketch(hub) }, size = ButtonSize.Sm) })
                else -> Column(Modifier.fillMaxSize().verticalScroll(scroll)) {
                    val shown = if (query.isBlank()) sketches else sketches.filter { sketchMatches(it.name, query) }
                    SectionHeader("Sketches", if (query.isBlank()) sketches.size.toString() else "${shown.size} of ${sketches.size}")
                    if (sketches.size > SKETCH_SEARCH_MIN) SearchField(query, onQuery, "Search sketches")
                    if (shown.isEmpty()) EmptyState("No sketches match", icon = "search", action = { Button("Clear search", { onQuery("") }, size = ButtonSize.Sm) })
                    CardGrid(shown.take(if (all || query.isNotBlank()) shown.size else FOLD), Modifier.padding(horizontal = Tokens.listPad)) { s ->
                        Card(sketchTitle(s.name), meta = agoShort(s.mtime.toLong(), now, " ago"), onClick = { onOpen(s.name) }, cover = { SketchThumb(hub, s) { onOpen(s.name) } }, menu = {
                            MoreButton("More for ${sketchTitle(s.name)}") { close ->
                                MenuItem("Rename", "edit", { close(); renaming = s })
                                MenuItem("Download", "desktop-download", { close(); download(s) })
                                MenuItem("Delete", "trash", { close(); deleting = s }, danger = true)
                            }
                        })
                    }
                    if (!all && query.isBlank() && shown.size > FOLD) Button("Show all ${shown.size}", showAll, Modifier.padding(horizontal = Tokens.listPad), variant = ButtonVariant.Plain, size = ButtonSize.Sm)
                    Spacer(Modifier.padding(bottom = Tokens.sp16))
                }
            }
        }
    }
    renaming?.let { s ->
        TextDialog("Rename sketch", sketchTitle(s.name), "Rename", { to ->
            when (sketchRename(to)) {
                null -> hub.notice.value = "Not a valid sketch name"
                s.name -> Unit
                else -> hub.renameSketch(s.name, to) { if (it) reload() }
            }
        }, { renaming = null }, maxLength = 120, detail = "The file in .claude/sketches gets the new name.")
    }
    deleting?.let { s ->
        ConfirmDialog("Delete ${sketchTitle(s.name)}?", "The file is removed from .claude/sketches. This cannot be undone.", "Delete", { hub.deleteSketch(s.name) { if (it) reload() } }, onDismiss = { deleting = null })
    }
}

// Download asks where to save the file (system picker), then writes the sketch's HTML there.
@Composable
private fun rememberSketchDownload(hub: Hub): (SketchFile) -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf<SketchFile?>(null) }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/html")) { uri: Uri? ->
        val file = pending ?: return@rememberLauncherForActivityResult
        pending = null
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val ok = runCatching {
                val f = hub.readFile(file.path)
                check(!f.binary && f.error == null) { f.error ?: "not text" }
                withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri)?.use { it.write(f.content.toByteArray()) } ?: error("no file") }
            }.isSuccess
            hub.notice.value = if (ok) "Saved ${file.name}" else "Not downloaded"
        }
    }
    return { file -> pending = file; save.launch(file.name) }
}

private fun newSketch(hub: Hub) {
    if (hub.readOnly) { hub.notice.value = READ_ONLY_SENT; return }
    hub.setDraft(hub.pageChat, "/sketch ")
    hub.link.value = DeepLink(chat = hub.pageChat)
}

// The card cover: the sketch at desktop width in a script-free WebView, created once the card is on screen. The overlay takes the taps.
@Composable
private fun SketchThumb(hub: Hub, file: SketchFile, onClick: () -> Unit) {
    var seen by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxSize().onGloballyPositioned { if (!seen && it.boundsInWindow().height > 0f) seen = true }) {
        if (seen) {
            val (load) = rememberLoad(file.path, file.mtime) { hub.readFile(file.path) }
            val f = load.data
            val dark = when (hub.theme.collectAsState().value) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
            if (f != null && !f.binary && f.error == null && f.content.length <= MAX_SKETCH) {
                SketchFrame(remember(f.content, dark) { sketchPage(f.content, if (dark) "dark" else "light", true) }, true, Modifier.fillMaxSize())
            }
        }
        Box(Modifier.matchParentSize().clearAndSetSemantics {}.clickable(indication = null, interactionSource = null, onClick = onClick))
    }
}

@Composable
private fun SketchView(hub: Hub, file: SketchFile, ready: Boolean, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    val cwd by hub.store.state.select { st -> shownCwd(st).orEmpty() }
    val (load, reload) = rememberLoad(file.path, hub.pageChat) { hub.readFile(file.path) }
    var desktop by rememberSaveable { mutableStateOf(false) }
    var dark by rememberSaveable { mutableStateOf<Boolean?>(null) }
    val dark0 = when (hub.theme.collectAsState().value) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
    val isDark = dark ?: dark0
    Column(Modifier.fillMaxSize()) {
        WorkspaceHeader(hub, sketchTitle(file.name), onBack) {
            MoreButton { close -> CopyPathItems(hub, file.path, cwd, close) }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = Tokens.listPad, vertical = Tokens.sp3), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.sp2)) {
            DeviceChips(desktop) { desktop = it }
            Spacer(Modifier.weight(1f))
            Chip("Light", { dark = false }, on = !isDark)
            Chip("Dark", { dark = true }, on = isDark)
        }
        val f = load.data
        Box(Modifier.fillMaxSize()) {
            when {
                f == null && load.error.isEmpty() -> Loading("Loading the sketch…")
                f == null -> EmptyState("Could not load the sketch", load.error, icon = "paintcan", action = { Button("Retry", reload, size = ButtonSize.Sm) })
                f.binary || f.error != null -> SketchProblem("It may have moved. Go back to the list")
                !ready -> Unit
                else -> SketchPreview(f.content, isDark, desktop)
            }
        }
    }
}

@Composable
internal fun DeviceChips(desktop: Boolean, onDesktop: (Boolean) -> Unit) {
    Chip("Phone", { onDesktop(false) }, on = !desktop)
    Chip("Desktop", { onDesktop(true) }, on = desktop)
}

// The sketch as a page in the chosen theme and width, or a problem when it is too large to load.
@Composable
internal fun SketchPreview(html: String, dark: Boolean, desktop: Boolean, modifier: Modifier = Modifier.fillMaxSize()) {
    if (html.length > MAX_SKETCH) Box(modifier) { SketchProblem("Too large to show") }
    else SketchFrame(remember(html, dark, desktop) { sketchPage(html, if (dark) "dark" else "light", desktop) }, desktop, modifier)
}

@Composable
private fun SketchProblem(hint: String) = EmptyState("Could not show the sketch", hint, icon = "paintcan")

private fun WebSettings.asSketch() = object : SketchSettings {
    override var javaScript by this@asSketch::javaScriptEnabled
    override var blockNetwork by this@asSketch::blockNetworkLoads
    override var fileAccess by this@asSketch::allowFileAccess
    override var contentAccess by this@asSketch::allowContentAccess
}

// No scripts, no network, no files and no link taps: the sketch is a picture of its own page.
@Composable
internal fun SketchFrame(page: String, desktop: Boolean, modifier: Modifier = Modifier.fillMaxSize()) {
    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            WebView(ctx).apply {
                lockSketch(settings.asSketch())
                visibility = android.view.View.INVISIBLE
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
                    override fun onPageFinished(view: WebView, url: String?) { view.visibility = android.view.View.VISIBLE }
                }
                // Inside a scrolling sheet a drag scrolls the sketch where the page has room that way, else the sheet.
                var downX = 0f
                var downY = 0f
                setOnTouchListener { v, e ->
                    when (e.actionMasked) {
                        MotionEvent.ACTION_DOWN -> { downX = e.x; downY = e.y }
                        MotionEvent.ACTION_MOVE -> {
                            val dx = e.x - downX
                            val dy = e.y - downY
                            val room = if (abs(dy) >= abs(dx)) v.canScrollVertically(if (dy < 0) 1 else -1) else v.canScrollHorizontally(if (dx < 0) 1 else -1)
                            if (room) v.parent?.requestDisallowInterceptTouchEvent(true)
                        }
                    }
                    false
                }
            }
        },
        update = { web ->
            val key = desktop to page
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
