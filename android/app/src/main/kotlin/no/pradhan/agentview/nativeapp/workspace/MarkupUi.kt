package no.pradhan.agentview.nativeapp.workspace

import android.graphics.Bitmap
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.lifecycle.viewModelScope
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import no.pradhan.agentview.nativeapp.app.Hub
import no.pradhan.agentview.nativeapp.app.attach
import no.pradhan.agentview.nativeapp.chat.attachMark
import no.pradhan.agentview.nativeapp.ui.Button
import no.pradhan.agentview.nativeapp.ui.ButtonSize
import no.pradhan.agentview.nativeapp.ui.Hairline
import no.pradhan.agentview.nativeapp.ui.IconBtn
import no.pradhan.agentview.nativeapp.ui.Menu
import no.pradhan.agentview.nativeapp.ui.MenuItem
import no.pradhan.agentview.nativeapp.ui.TextDialog
import no.pradhan.agentview.nativeapp.ui.Tokens
import no.pradhan.agentview.nativeapp.ui.av
import java.io.ByteArrayOutputStream
import androidx.compose.foundation.layout.Column

enum class MarkTool(val icon: String, val label: String) { Pen("edit", "Pen"), Box("primitive-square", "Box"), Text("text-size", "Text") }

// Markup state for the browser frame (web workspace/Markup.tsx): the marks so far, the one being drawn and the tool.
class MarkupState {
    var tool by mutableStateOf(MarkTool.Pen)
    var colour by mutableStateOf("Clay")
    var marks by mutableStateOf(listOf<Mark>())
    var draft by mutableStateOf<Mark?>(null)
    var textAt by mutableStateOf<Pair<Float, Float>?>(null)
}

private fun paint(op: MarkOp) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = android.graphics.Color.parseColor(op.color)
    when (op) {
        is MarkOp.Text -> textSize = op.size.toFloat()
        is MarkOp.Pen -> { style = Paint.Style.STROKE; strokeWidth = op.width.toFloat(); strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
        is MarkOp.Box -> { style = Paint.Style.STROKE; strokeWidth = op.width.toFloat() }
    }
}

private fun drawOp(c: android.graphics.Canvas, op: MarkOp) {
    val p = paint(op)
    when (op) {
        is MarkOp.Pen -> c.drawPath(Path().apply { moveTo(op.pts[0].toFloat(), op.pts[1].toFloat()); for (i in 2 until op.pts.size step 2) lineTo(op.pts[i].toFloat(), op.pts[i + 1].toFloat()) }, p)
        is MarkOp.Box -> c.drawRoundRect(RectF(op.x.toFloat(), op.y.toFloat(), (op.x + op.w).toFloat(), (op.y + op.h).toFloat()), op.width.toFloat(), op.width.toFloat(), p)
        is MarkOp.Text -> c.drawText(op.text, op.x.toFloat(), (op.y - p.ascent()).toFloat(), p)
    }
}

// The frame with the marks drawn on it, as PNG bytes at the frame's own size.
fun markedPng(frame: ImageBitmap, marks: List<Mark>): ByteArray {
    val bmp = frame.asAndroidBitmap().copy(Bitmap.Config.ARGB_8888, true)
    val c = android.graphics.Canvas(bmp)
    markOps(marks, bmp.width, bmp.height).forEach { drawOp(c, it) }
    return ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
}

// The layer over the frame: draws the marks and, while markup is on, takes the touches instead of Chrome.
@Composable
fun BoxScope.MarkupLayer(s: MarkupState, frame: ImageBitmap) {
    Canvas(Modifier.matchParentSize().pointerInput(s.tool, s.colour) {
        fun at(x: Float, y: Float) = (x / size.width).coerceIn(0f, 1f) to (y / size.height).coerceIn(0f, 1f)
        awaitEachGesture {
            val down = awaitFirstDown()
            down.consume()
            val (x, y) = at(down.position.x, down.position.y)
            if (s.tool == MarkTool.Text) { s.textAt = x to y; return@awaitEachGesture }
            s.draft = if (s.tool == MarkTool.Pen) Mark.Pen(s.colour, listOf(x, y)) else Mark.Box(s.colour, x, y, x, y)
            while (true) {
                val c = awaitPointerEvent().changes.firstOrNull { it.id == down.id } ?: break
                c.consume()
                if (!c.pressed) break
                val (px, py) = at(c.position.x, c.position.y)
                s.draft = when (val d = s.draft) {
                    is Mark.Pen -> d.copy(pts = d.pts + px + py)
                    is Mark.Box -> d.copy(x1 = px, y1 = py)
                    else -> d
                }
            }
            s.draft?.takeIf { markOps(listOf(it), frame.width, frame.height).isNotEmpty() }?.let { s.marks = s.marks + it }
            s.draft = null
        }
    }) {
        val ops = markOps(s.marks + listOfNotNull(s.draft), frame.width, frame.height)
        scale(size.width / frame.width, pivot = androidx.compose.ui.geometry.Offset.Zero) {
            drawIntoCanvas { c -> ops.forEach { drawOp(c.nativeCanvas, it) } }
        }
    }
    s.textAt?.let { (x, y) ->
        TextDialog("Text on the page", "", "Add", { t -> if (t.isNotBlank()) s.marks = s.marks + Mark.Text(s.colour, x, y, t); s.textAt = null }, { s.textAt = null })
    }
}

// Pen, box, text, colour, undo, clear, Add to chat and close, like Claude.app's markup toolbar.
@Composable
fun MarkupBar(hub: Hub, s: MarkupState, frame: ImageBitmap?, onClose: () -> Unit) {
    var colours by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().background(av.raised)) {
        Hairline()
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = Tokens.sp4), verticalAlignment = Alignment.CenterVertically) {
            MarkTool.entries.forEach { t -> IconBtn(t.icon, t.label, { s.tool = t }, on = s.tool == t) }
            Box {
                Box(Modifier.size(Tokens.touch).clickable(onClickLabel = "Colour: ${s.colour}") { colours = true }, contentAlignment = Alignment.Center) {
                    Box(Modifier.size(Tokens.iconLg).background(Color(android.graphics.Color.parseColor(markHex(s.colour))), CircleShape).border(Dp.Hairline, av.border, CircleShape))
                }
                Menu(colours, { colours = false }) {
                    MARK_COLOURS.forEach { (name, _) -> MenuItem(name, "", { s.colour = name; colours = false }, checked = name == s.colour) }
                }
            }
            IconBtn("discard", "Undo", { s.marks = s.marks.dropLast(1) }, enabled = s.marks.isNotEmpty())
            IconBtn("trash", "Clear marks", { s.marks = emptyList() }, enabled = s.marks.isNotEmpty())
            Button("Add to chat", {
                val f = frame ?: return@Button
                val marks = s.marks
                hub.viewModelScope.launch {
                    val bytes = withContext(Dispatchers.Default) { markedPng(f, marks) }
                    val path = hub.attach("browser-markup.png", "image/png", bytes) ?: return@launch
                    hub.attachToDraft(hub.pageChat, attachMark("image/png", path))
                    hub.notice.value = "Added the marked-up page to the prompt"
                    s.marks = emptyList()
                }
            }, size = ButtonSize.Sm, enabled = frame != null && !hub.readOnly)
            IconBtn("close", "Close markup", onClose)
        }
    }
}
