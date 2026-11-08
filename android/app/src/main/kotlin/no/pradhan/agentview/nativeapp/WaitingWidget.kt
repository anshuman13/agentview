package no.pradhan.agentview.nativeapp

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Column
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.color.ColorProvider
import kotlinx.serialization.encodeToString

// The waiting chats the ongoing notification lists, kept where the widget can read them without the app running.
object WaitingStore {
    private const val KEY = "waiting"

    fun write(context: Context, snap: WaitingSnapshot) {
        context.getSharedPreferences("agentview", 0).edit().putString(KEY, protocolJson.encodeToString(snap)).apply()
    }

    fun read(context: Context): WaitingSnapshot =
        context.getSharedPreferences("agentview", 0).getString(KEY, null)?.let { runCatching { protocolJson.decodeFromString<WaitingSnapshot>(it) }.getOrNull() } ?: WaitingSnapshot()
}

private fun pick(pair: (AvColors) -> Color) = ColorProvider(day = pair(LightColors), night = pair(DarkColors))

class WaitingWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent {
            WaitingContent(context, WaitingStore.read(context))
        }
    }
}

@Composable
private fun WaitingContent(context: Context, snap: WaitingSnapshot) {
    val open = Intent(Intent.ACTION_VIEW, Uri.parse(sessionsLink), context, MainActivity::class.java)
    Column(GlanceModifier.fillMaxSize().background(pick { it.surface }).cornerRadius(Tokens.radiusSheet).padding(Tokens.sp5).clickable(actionStartActivity(open))) {
        Text(
            if (snap.total == 0) "Nothing waiting" else "Needs you · ${snap.total}",
            style = TextStyle(color = pick { it.fg }, fontSize = Tokens.fsHeadline, fontWeight = FontWeight.Bold),
        )
        snap.lines.forEach { line ->
            val chat = Intent(Intent.ACTION_VIEW, Uri.parse(chatLink(line.chatId)), context, MainActivity::class.java)
            Text(
                line.text(),
                modifier = GlanceModifier.fillMaxWidth().padding(top = Tokens.sp3).clickable(actionStartActivity(chat)),
                style = TextStyle(color = pick { it.fgMuted }, fontSize = Tokens.fsSubheadline),
                maxLines = 1,
            )
        }
    }
}

class WaitingWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = WaitingWidget()
}
